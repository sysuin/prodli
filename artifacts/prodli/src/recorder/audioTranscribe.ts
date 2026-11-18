// "Transcribe audio with AI": a transcript from the meeting's own recording, for
// calls where people switch languages (Meet's captions follow one language).
//
// Whisper picks one language per request and translates anything else into it,
// so the recording is cut at pauses into short pieces (about one speaker turn,
// at most 25 s) and each piece is sent on its own (/api/ai/transcribe, Whisper
// on Cloudflare Workers AI). Silence is skipped: it costs minutes and makes
// Whisper invent text.
//
// The recording is WebM/Opus. It's read packet by packet (a small WebM reader
// below) and decoded with WebCodecs in batches, so long meetings never sit in
// memory as raw audio. Other formats fall back to decodeAudioData.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "../lib/prodliAccount";
import type { TranscriptEntry } from "./types";

export const RATE = 16_000;
const FRAME = RATE / 50; // 20 ms
const MAX_PIECE_FRAMES = 25 * 50; // 25 s
const CONCURRENCY = 4;
export const AUDIO_SPEAKER = "Speaker";

export class TranscribeError extends Error {}

// ── WebM (Matroska) reader: just enough to get the Opus packets out ───────────

const EBML = {
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  BlockGroup: 0xa0,
  SimpleBlock: 0xa3,
  Block: 0xa1,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Channels: 0x9f,
  SamplingFrequency: 0xb5,
};
// Containers we step into rather than over (sizes may be "unknown" in recordings).
const CONTAINERS = new Set([EBML.Segment, EBML.Cluster, EBML.Tracks, EBML.TrackEntry, EBML.Audio, EBML.BlockGroup]);

export interface WebmAudio {
  codec: string;
  sampleRate: number;
  channels: number;
  codecPrivate?: Uint8Array;
  frames: Uint8Array[];
}

function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i];
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const uint = (b: Uint8Array) => b.reduce((n, x) => n * 256 + x, 0);

/** The audio track and its packets, or null if this isn't a WebM file we can read. */
export function parseWebm(bytes: Uint8Array): WebmAudio | null {
  const out: WebmAudio = { codec: "", sampleRate: 48_000, channels: 1, frames: [] };
  let pos = 0;
  while (pos < bytes.length) {
    const id = vint(bytes, pos, true);
    if (!id) break;
    const size = vint(bytes, pos + id.length, false);
    if (!size) break;
    const start = pos + id.length + size.length;
    if (CONTAINERS.has(id.value)) {
      pos = start;
      continue;
    }
    if (size.unknown) break;
    const end = start + size.value;
    if (end > bytes.length) break; // cut off at the end (e.g. a crash while recording)
    const data = bytes.subarray(start, end);
    switch (id.value) {
      case EBML.CodecID:
        out.codec = new TextDecoder().decode(data);
        break;
      case EBML.CodecPrivate:
        out.codecPrivate = data;
        break;
      case EBML.Channels:
        out.channels = uint(data) || 1;
        break;
      case EBML.SamplingFrequency: {
        const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
        out.sampleRate = Math.round(data.length === 4 ? v.getFloat32(0) : v.getFloat64(0)) || 48_000;
        break;
      }
      case EBML.SimpleBlock:
      case EBML.Block: {
        const track = vint(data, 0, false);
        if (!track) break;
        const flags = data[track.length + 2];
        if (flags & 0x06) return null; // laced blocks: not written by Chrome; let the fallback handle it
        out.frames.push(data.subarray(track.length + 3));
        break;
      }
    }
    pos = end;
  }
  return out.codec && out.frames.length ? out : null;
}

// ── Resampling to 16 kHz mono ─────────────────────────────────────────────────

/** Streams audio from `from` Hz to 16 kHz by averaging (a simple low-pass that's fine for speech). */
export class Resampler {
  private ratio: number;
  private pos = 0; // position of the next output sample, in input samples (relative to `carry`)
  private carry = new Float32Array(0);
  constructor(from: number) {
    this.ratio = from / RATE;
  }
  push(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry);
    buf.set(input, this.carry.length);
    const out: number[] = [];
    while (this.pos + this.ratio <= buf.length) {
      const a = Math.floor(this.pos);
      const b = Math.max(a + 1, Math.floor(this.pos + this.ratio));
      let sum = 0;
      for (let i = a; i < b; i++) sum += buf[i];
      out.push(sum / (b - a));
      this.pos += this.ratio;
    }
    const keep = Math.floor(this.pos);
    this.carry = buf.slice(keep);
    this.pos -= keep;
    return Float32Array.from(out);
  }
}

// ── Cutting at pauses ─────────────────────────────────────────────────────────

export interface Piece {
  startMs: number;
  samples: Float32Array;
}

const rms = (f: Float32Array) => {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / f.length);
};

/**
 * Collects 16 kHz audio and hands back pieces cut at pauses: after 0.5 s of quiet
 * once a piece is 4 s long, after 1 s of quiet once it's 1.5 s long, and at the
 * quietest moment of the last 5 s when it reaches 25 s. Pieces with less than
 * 0.3 s of sound are dropped.
 */
export class Segmenter {
  private frames: { audio: Float32Array; loud: boolean; level: number }[] = [];
  private firstFrame = 0; // index (in 20 ms frames) of frames[0] in the recording
  private loudCount = 0; // loud frames in `frames`
  private pending = new Float32Array(0);
  private speechLevel = 0.02;
  private quietRun = 0;

  push(samples: Float32Array): Piece[] {
    const pieces: Piece[] = [];
    const buf = new Float32Array(this.pending.length + samples.length);
    buf.set(this.pending);
    buf.set(samples, this.pending.length);
    let at = 0;
    for (; at + FRAME <= buf.length; at += FRAME) {
      const audio = buf.slice(at, at + FRAME);
      const level = rms(audio);
      const loud = level >= Math.max(0.003, 0.15 * this.speechLevel);
      if (loud) this.speechLevel = 0.995 * this.speechLevel + 0.005 * level;
      this.add({ audio, loud, level }, pieces);
    }
    this.pending = buf.slice(at);
    return pieces;
  }

  /** Whatever is left at the end of the recording. */
  flush(): Piece[] {
    const pieces: Piece[] = [];
    this.emit(this.frames.length, pieces);
    return pieces;
  }

  private add(frame: { audio: Float32Array; loud: boolean; level: number }, pieces: Piece[]) {
    this.quietRun = frame.loud ? 0 : this.quietRun + 1;
    this.frames.push(frame);
    if (frame.loud) this.loudCount++;
    // Nothing said yet: keep only a short lead-in so silence doesn't pile up.
    if (this.loudCount === 0) {
      if (this.frames.length > 10) {
        const extra = this.frames.length - 10;
        this.frames.splice(0, extra);
        this.firstFrame += extra;
      }
      return;
    }
    const len = this.frames.length;
    if ((this.quietRun >= 25 && len >= 200) || (this.quietRun >= 50 && len >= 75) || this.quietRun >= 150) {
      // Keep 0.2 s of the pause on this piece; the rest of it starts the next one.
      this.emit(len - this.quietRun + 10, pieces);
      return;
    }
    if (len >= MAX_PIECE_FRAMES) {
      let cut = len - 1;
      for (let i = len - 250; i < len; i++) if (this.frames[i].level < this.frames[cut].level) cut = i;
      this.emit(cut + 1, pieces);
    }
  }

  private emit(count: number, pieces: Piece[]) {
    const taken = this.frames.splice(0, Math.max(0, Math.min(count, this.frames.length)));
    const startFrame = this.firstFrame;
    this.firstFrame += taken.length;
    const takenLoud = taken.filter((f) => f.loud).length;
    this.loudCount -= takenLoud;
    this.quietRun = 0;
    for (let i = this.frames.length - 1; i >= 0 && !this.frames[i].loud; i--) this.quietRun++;
    if (takenLoud < 15) return; // too little sound to be speech
    const samples = new Float32Array(taken.length * FRAME);
    taken.forEach((f, i) => samples.set(f.audio, i * FRAME));
    pieces.push({ startMs: startFrame * 20, samples });
  }
}

// ── WAV ───────────────────────────────────────────────────────────────────────

/** 16 kHz mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const b = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(b.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return b;
}

// ── Decoding ──────────────────────────────────────────────────────────────────

const BATCH_FRAMES = 1500; // ~30 s of Opus packets per decode batch

/** 16 kHz mono audio from the recording, in batches. */
export async function* decodeTo16k(blob: Blob, mimeType: string | null): AsyncGenerator<Float32Array> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const webm = /webm/i.test(mimeType ?? blob.type) ? parseWebm(bytes) : null;
  const canDecode =
    webm?.codec === "A_OPUS" &&
    typeof AudioDecoder !== "undefined" &&
    (await AudioDecoder.isConfigSupported({ codec: "opus", sampleRate: webm.sampleRate, numberOfChannels: webm.channels }).then((r) => !!r.supported, () => false));
  if (!webm || !canDecode) {
    // Fallback: decode it all at once at 16 kHz (fine for short or unusual recordings).
    const ctx = new OfflineAudioContext(1, 1, RATE);
    const audio = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const ch = audio.numberOfChannels;
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < ch; c++) audio.getChannelData(c).forEach((x, i) => (mono[i] += x / ch));
    for (let i = 0; i < mono.length; i += RATE * 30) yield mono.subarray(i, i + RATE * 30);
    return;
  }
  const resampler = new Resampler(webm.sampleRate);
  let decoded: Float32Array[] = [];
  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      const n = data.numberOfFrames;
      const mono = new Float32Array(n);
      const plane = new Float32Array(n);
      for (let c = 0; c < data.numberOfChannels; c++) {
        data.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        for (let i = 0; i < n; i++) mono[i] += plane[i] / data.numberOfChannels;
      }
      data.close();
      decoded.push(mono);
    },
    error: (e) => (failure = e),
  });
  decoder.configure({ codec: "opus", sampleRate: webm.sampleRate, numberOfChannels: webm.channels, ...(webm.codecPrivate ? { description: webm.codecPrivate } : {}) });
  try {
    for (let i = 0; i < webm.frames.length; i += BATCH_FRAMES) {
      webm.frames.slice(i, i + BATCH_FRAMES).forEach((data, j) => decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: (i + j) * 20_000, data })));
      await decoder.flush();
      if (failure) throw failure;
      const batch = decoded;
      decoded = [];
      const total = batch.reduce((n, a) => n + a.length, 0);
      const joined = new Float32Array(total);
      let at = 0;
      for (const a of batch) {
        joined.set(a, at);
        at += a.length;
      }
      yield resampler.push(joined);
    }
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}

/** Pieces of speech, cut at pauses, as they are decoded. */
export async function* speechPieces(blob: Blob, mimeType: string | null): AsyncGenerator<Piece> {
  const seg = new Segmenter();
  for await (const chunk of decodeTo16k(blob, mimeType)) yield* seg.push(chunk);
  yield* seg.flush();
}

// ── Sending ───────────────────────────────────────────────────────────────────

export interface PieceResult {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string | null;
  usage?: { usedSeconds: number; limitSeconds: number };
}

export const SIGN_IN_FOR_TRANSCRIPTION = "Sign in to your ProdLi account (👤, free) to transcribe audio with AI.";

const MESSAGES: Record<string, string> = {
  transcribe_quota_exceeded: "You've used this month's audio transcription minutes. They reset on the 1st, or get more with ProdLi Pro (👤 Account).",
  ai_unavailable: "Audio transcription isn't available right now. Try again later.",
  ai_busy: "Audio transcription is busy right now. Try again in a minute.",
  too_large: "Part of the audio couldn't be sent. Try again.",
  bad_request: "Part of the audio couldn't be read. Try again.",
};

type Stub = (wav: Uint8Array, startMs: number) => Promise<PieceResult>;

async function sendPiece(wav: Uint8Array, startMs: number): Promise<PieceResult> {
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliTranscribeStub?: Stub }).__prodliTranscribeStub;
    if (stub) return stub(wav, startMs);
  }
  return accountRequest<PieceResult>("/api/ai/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as BodyInit }, MESSAGES);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (err: unknown) => err instanceof AccountError && (err.status === 0 || err.status === 502 || err.status === 503 || /reach ProdLi/.test(err.message));

async function sendWithRetry(wav: Uint8Array, startMs: number, signal?: AbortSignal): Promise<PieceResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendPiece(wav, startMs);
    } catch (err) {
      if (signal?.aborted || attempt >= 2 || !retryable(err)) throw err;
      await sleep(attempt === 0 ? 1500 : 4000);
    }
  }
}

/** Transcript lines from the pieces' results (times are from the start of the recording). */
export function toEntries(results: { startMs: number; durationMs: number; result: PieceResult }[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const { startMs, durationMs, result } of [...results].sort((a, b) => a.startMs - b.startMs)) {
    const segs = result.segments.length ? result.segments : result.text.trim() ? [{ start: 0, end: durationMs / 1000, text: result.text }] : [];
    for (const s of segs) {
      const text = s.text.trim();
      if (!text) continue;
      const begin = startMs + Math.round(s.start * 1000);
      entries.push({ id: `ai-${begin}-${entries.length}`, speaker: AUDIO_SPEAKER, text, startMs: begin, endMs: startMs + Math.round(Math.max(s.end, s.start) * 1000), source: "audio" });
    }
  }
  return entries;
}

export interface TranscribeProgress {
  /** How far into the recording the finished pieces reach. */
  doneMs: number;
  pieces: number;
}

/**
 * Transcribes a meeting's recording. Throws TranscribeError with a message to show;
 * an AbortSignal stops it (nothing is saved then).
 */
export async function transcribeRecording(
  blob: Blob,
  mimeType: string | null,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void } = {},
): Promise<{ entries: TranscriptEntry[]; languages: string[]; usage?: PieceResult["usage"] }> {
  const stubbed = import.meta.env.VITE_E2E === "1" && !!(globalThis as { __prodliTranscribeStub?: Stub }).__prodliTranscribeStub;
  if (!stubbed) {
    if (!accountsEnabled()) throw new TranscribeError("Audio transcription isn't available in this copy of ProdLi.");
    if (!(await getProdliAccount())) throw new TranscribeError(SIGN_IN_FOR_TRANSCRIPTION);
  }
  const results: { startMs: number; durationMs: number; result: PieceResult }[] = [];
  let usage: PieceResult["usage"];
  let doneMs = 0;
  let source: AsyncGenerator<Piece>;
  try {
    source = speechPieces(blob, mimeType);
  } catch {
    throw new TranscribeError("This recording couldn't be read.");
  }
  let stop: unknown = null;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted || stop) return;
      let next: IteratorResult<Piece>;
      try {
        next = await source.next();
      } catch {
        stop ??= new TranscribeError("This recording couldn't be read.");
        return;
      }
      if (next.done) return;
      const piece = next.value;
      const durationMs = Math.round((piece.samples.length / RATE) * 1000);
      try {
        const result = await sendWithRetry(encodeWav(piece.samples), piece.startMs, signal);
        results.push({ startMs: piece.startMs, durationMs, result });
        if (result.usage && (!usage || result.usage.usedSeconds > usage.usedSeconds)) usage = result.usage;
        doneMs = Math.max(doneMs, piece.startMs + durationMs);
        onProgress?.({ doneMs, pieces: results.length });
      } catch (err) {
        stop ??= err;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await source.return(undefined).catch(() => {});
  if (signal?.aborted) throw new TranscribeError("Stopped.");
  if (stop) throw stop instanceof TranscribeError ? stop : new TranscribeError(stop instanceof AccountError ? stop.message : "Something went wrong. Try again.");
  const entries = toEntries(results);
  if (!entries.length) throw new TranscribeError("No speech was found in the recording.");
  const counts = new Map<string, number>();
  for (const r of results) if (r.result.language) counts.set(r.result.language, (counts.get(r.result.language) ?? 0) + r.durationMs);
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return { entries, languages, usage };
}
