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
import { storageGet } from "../lib/storage";
import { VOCABULARY_STORAGE_KEY, type TranscriptEntry } from "./types";
import { encodeWav, RATE, Resampler, Segmenter, toEntries, type Piece, type PieceResult } from "./audioPieces";
export { AUDIO_SPEAKER, encodeWav, RATE, Resampler, Segmenter, toEntries, type AudioEntry, type Piece, type PieceResult } from "./audioPieces";

const CONCURRENCY = 4;

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


export const SIGN_IN_FOR_TRANSCRIPTION = "Sign in to your ProdLi account (👤, free) to transcribe audio with AI.";

const MESSAGES: Record<string, string> = {
  transcribe_quota_exceeded: "You've used this month's audio transcription minutes. They reset on the 1st, or get more with ProdLi Pro (👤 Account).",
  ai_unavailable: "Audio transcription isn't available right now. Try again later.",
  ai_busy: "Audio transcription is busy right now. Try again in a minute.",
  too_large: "Part of the audio couldn't be sent. Try again.",
  bad_request: "Part of the audio couldn't be read. Try again.",
};

type Stub = (wav: Uint8Array, startMs: number, vocabulary: string[]) => Promise<PieceResult>;

async function sendPiece(wav: Uint8Array, startMs: number, vocabulary: string[]): Promise<PieceResult> {
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliTranscribeStub?: Stub }).__prodliTranscribeStub;
    if (stub) return stub(wav, startMs, vocabulary);
  }
  const headers: Record<string, string> = { "Content-Type": "audio/wav" };
  // Names and terms as a spelling hint for Whisper (Setup → word list).
  if (vocabulary.length) headers["X-ProdLi-Vocabulary"] = encodeURIComponent(vocabulary.slice(0, 40).join(",")).slice(0, 1500);
  return accountRequest<PieceResult>("/api/ai/transcribe", { method: "POST", headers, body: wav as BodyInit }, MESSAGES);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (err: unknown) => err instanceof AccountError && (err.status === 0 || err.status === 502 || err.status === 503 || /reach ProdLi/.test(err.message));

/** Sends one piece to ProdLi's AI, retrying brief network problems. (Also used by the background for Zoom/Teams recordings.) */
export async function sendWithRetry(wav: Uint8Array, startMs: number, vocabulary: string[], signal?: AbortSignal): Promise<PieceResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendPiece(wav, startMs, vocabulary);
    } catch (err) {
      if (signal?.aborted || attempt >= 2 || !retryable(err)) throw err;
      await sleep(attempt === 0 ? 1500 : 4000);
    }
  }
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
  {
    signal,
    onProgress,
    send,
  }: {
    signal?: AbortSignal;
    onProgress?: (p: TranscribeProgress) => void;
    /** Sends a piece somewhere else (the offscreen recorder hands pieces to the background, which has the account). */
    send?: (wav: Uint8Array, startMs: number) => Promise<PieceResult>;
  } = {},
): Promise<{ entries: TranscriptEntry[]; languages: string[]; usage?: PieceResult["usage"] }> {
  const stubbed = import.meta.env.VITE_E2E === "1" && !!(globalThis as { __prodliTranscribeStub?: Stub }).__prodliTranscribeStub;
  if (!stubbed && !send) {
    if (!accountsEnabled()) throw new TranscribeError("Audio transcription isn't available in this copy of ProdLi.");
    if (!(await getProdliAccount())) throw new TranscribeError(SIGN_IN_FOR_TRANSCRIPTION);
  }
  const vocabulary = send ? [] : await storageGet<string[]>(VOCABULARY_STORAGE_KEY, []);
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
        const wav = encodeWav(piece.samples);
        const result = send ? await send(wav, piece.startMs) : await sendWithRetry(wav, piece.startMs, vocabulary, signal);
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
