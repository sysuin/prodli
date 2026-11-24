// "Transcribe audio with AI": a transcript from the meeting's own recording, for
// calls where people switch languages (Meet's captions follow one language).
//
// Whisper picks one language per request and translates anything else into it,
// so the recording is cut at pauses into short pieces (about one speaker turn,
// at most 25 s) and each piece is sent on its own (/api/ai/transcribe, Whisper
// on Cloudflare Workers AI). Silence is skipped: it costs minutes and makes
// Whisper invent text.
//
// Recordings are WebM/Opus. They're read packet by packet (a small WebM reader
// below) and decoded with WebCodecs in batches, so long meetings never sit in
// memory as raw audio. Uploaded files (Meetings → ⬆ Upload recording) get the
// same treatment where the format allows (recorder/mediaFormats.ts): WAV is read
// directly, MP4/M4A/MOV's AAC goes through WebCodecs, MP3 is decoded in pieces.
// Anything else falls back to decodeAudioData on the whole file.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "../lib/prodliAccount";
import { storageGet } from "../lib/storage";
import { VOCABULARY_STORAGE_KEY, type TranscriptEntry } from "./types";
import { encodeWav, RATE, Resampler, Segmenter, toEntries, type Piece, type PieceResult } from "./audioPieces";
import { findFrameStart, readMp4Audio, readWavInfo, sniffFormat, wavToMono, type Mp4Audio, type ReadAt, type WavInfo } from "./mediaFormats";
export { AUDIO_SPEAKER, encodeWav, RATE, Resampler, Segmenter, toEntries, type AudioEntry, type Piece, type PieceResult } from "./audioPieces";

const CONCURRENCY = 4;

export class TranscribeError extends Error {}

// ── WebM (Matroska) reader: just enough to get the Opus packets out ───────────

const EBML = {
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
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

interface WebmTrack {
  number: number;
  type: number;
  codec: string;
  codecPrivate?: Uint8Array;
  channels: number;
  sampleRate: number;
}
const newTrack = (): WebmTrack => ({ number: 0, type: 0, codec: "", channels: 1, sampleRate: 48_000 });
const audioTrack = (tracks: WebmTrack[]) => tracks.find((t) => t.type === 2 || t.codec.startsWith("A_")) ?? null;

/** The audio track and its packets, or null if this isn't a WebM file we can read. (Video files: just the audio track.) */
export function parseWebm(bytes: Uint8Array): WebmAudio | null {
  const tracks: WebmTrack[] = [];
  const track = () => tracks[tracks.length - 1] ?? (tracks[0] = newTrack());
  let audio: WebmTrack | null | undefined;
  const frames: Uint8Array[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const id = vint(bytes, pos, true);
    if (!id) break;
    const size = vint(bytes, pos + id.length, false);
    if (!size) break;
    const start = pos + id.length + size.length;
    if (id.value === EBML.TrackEntry) tracks.push(newTrack());
    if (CONTAINERS.has(id.value)) {
      pos = start;
      continue;
    }
    if (size.unknown) break;
    const end = start + size.value;
    if (end > bytes.length) break; // cut off at the end (e.g. a crash while recording)
    const data = bytes.subarray(start, end);
    switch (id.value) {
      case EBML.TrackNumber:
        track().number = uint(data);
        break;
      case EBML.TrackType:
        track().type = uint(data);
        break;
      case EBML.CodecID:
        track().codec = new TextDecoder().decode(data);
        break;
      case EBML.CodecPrivate:
        track().codecPrivate = data;
        break;
      case EBML.Channels:
        track().channels = uint(data) || 1;
        break;
      case EBML.SamplingFrequency: {
        const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
        track().sampleRate = Math.round(data.length === 4 ? v.getFloat32(0) : v.getFloat64(0)) || 48_000;
        break;
      }
      case EBML.SimpleBlock:
      case EBML.Block: {
        audio ??= audioTrack(tracks);
        const num = vint(data, 0, false);
        if (!num || !audio) break;
        if (tracks.length > 1 && num.value !== audio.number) break; // another track (video)
        const flags = data[num.length + 2];
        if (flags & 0x06) return null; // laced blocks: not written by Chrome; let the fallback handle it
        frames.push(data.subarray(num.length + 3));
        break;
      }
    }
    pos = end;
  }
  audio ??= audioTrack(tracks);
  return audio?.codec && frames.length ? { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.channels, codecPrivate: audio.codecPrivate, frames } : null;
}

// ── Decoding ──────────────────────────────────────────────────────────────────

const BATCH_FRAMES = 1500; // ~30 s of Opus packets (~35 s of AAC) per decode batch
const FRAMED_CHUNK = 4 * 1024 * 1024; // MP3/AAC: decoded 4 MB (~4 min) at a time

const readerFor =
  (blob: Blob): ReadAt =>
  async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

const supported = async (config: AudioDecoderConfig) =>
  typeof AudioDecoder !== "undefined" && (await AudioDecoder.isConfigSupported(config).then((r) => !!r.supported, () => false));

/** Decodes a whole (short) file, or a piece of one, at 16 kHz with the browser's decoder. */
async function* decodeWhole(buffer: ArrayBuffer): AsyncGenerator<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const audio = await ctx.decodeAudioData(buffer);
  const ch = audio.numberOfChannels;
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < ch; c++) audio.getChannelData(c).forEach((x, i) => (mono[i] += x / ch));
  for (let i = 0; i < mono.length; i += RATE * 30) yield mono.subarray(i, i + RATE * 30);
}

/** Packets → 16 kHz mono audio with WebCodecs, a batch at a time. */
async function* decodePackets(config: AudioDecoderConfig, batches: AsyncIterable<Uint8Array[]> | Iterable<Uint8Array[]>, packetUs: number): AsyncGenerator<Float32Array> {
  let resampler: Resampler | null = null;
  let rate = config.sampleRate;
  let decoded: Float32Array[] = [];
  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      rate = data.sampleRate || rate; // HE-AAC can come out at twice the file's rate
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
  decoder.configure(config);
  let count = 0;
  try {
    for await (const batch of batches) {
      for (const data of batch) decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(count++ * packetUs), data }));
      await decoder.flush();
      if (failure) throw failure;
      const parts = decoded;
      decoded = [];
      const joined = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
      let at = 0;
      for (const a of parts) {
        joined.set(a, at);
        at += a.length;
      }
      resampler ??= new Resampler(rate);
      yield resampler.push(joined);
    }
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}

function* inBatches(frames: Uint8Array[]): Generator<Uint8Array[]> {
  for (let i = 0; i < frames.length; i += BATCH_FRAMES) yield frames.slice(i, i + BATCH_FRAMES);
}

/** An MP4's audio packets, read from the file a batch at a time (adjacent packets in one read). */
async function* mp4Batches(read: ReadAt, mp4: Mp4Audio): AsyncGenerator<Uint8Array[]> {
  const n = mp4.sizes.length;
  for (let i = 0; i < n; i += BATCH_FRAMES) {
    const batch: Uint8Array[] = [];
    const end = Math.min(n, i + BATCH_FRAMES);
    let j = i;
    while (j < end) {
      const runStart = mp4.offsets[j];
      let runEnd = runStart + mp4.sizes[j];
      let k = j + 1;
      while (k < end && mp4.offsets[k] === runEnd) runEnd += mp4.sizes[k++];
      const bytes = await read(runStart, runEnd - runStart);
      for (let at = 0; j < k; j++) {
        batch.push(bytes.subarray(at, at + mp4.sizes[j]));
        at += mp4.sizes[j];
      }
    }
    yield batch;
  }
}

/** PCM WAV, read 30 s at a time. */
async function* wavStream(read: ReadAt, info: WavInfo): AsyncGenerator<Float32Array> {
  const resampler = new Resampler(info.sampleRate);
  const step = info.blockAlign * info.sampleRate * 30;
  for (let at = 0; at < info.dataLength; at += step) {
    const bytes = await read(info.dataOffset + at, Math.min(step, info.dataLength - at));
    if (!bytes.length) break;
    yield resampler.push(wavToMono(bytes, info));
  }
}

/** MP3 / ADTS AAC: cut at frame starts into 4 MB pieces that each decode on their own. */
async function* framedStream(read: ReadAt, size: number, kind: "mp3" | "aac"): AsyncGenerator<Float32Array> {
  let samplesPerByte = 0;
  for (let pos = 0; pos < size; ) {
    const bytes = await read(pos, FRAMED_CHUNK + 65_536);
    if (!bytes.length) break;
    let cut = bytes.length;
    if (pos + bytes.length < size) {
      const at = findFrameStart(bytes, FRAMED_CHUNK, kind);
      cut = at > 0 ? at : FRAMED_CHUNK;
    }
    let got = 0;
    try {
      for await (const chunk of decodeWhole(bytes.slice(0, cut).buffer)) {
        got += chunk.length;
        yield chunk;
      }
      if (got) samplesPerByte = got / cut;
    } catch (err) {
      if (!pos || !samplesPerByte) throw err;
      // A damaged piece in the middle: keep the timing with silence.
      yield new Float32Array(Math.round(cut * samplesPerByte));
    }
    pos += cut;
  }
}

/** 16 kHz mono audio from a recording or an uploaded file, in batches (long files never sit in memory as raw audio). */
export async function* decodeTo16k(blob: Blob, mimeType: string | null): AsyncGenerator<Float32Array> {
  const read = readerFor(blob);
  const format = sniffFormat(await read(0, 65_536));
  if (format === "webm" || (format === "unknown" && /webm/i.test(mimeType ?? blob.type))) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const webm = parseWebm(bytes);
    if (webm?.codec === "A_OPUS" && (await supported({ codec: "opus", sampleRate: webm.sampleRate, numberOfChannels: webm.channels }))) {
      const config = { codec: "opus", sampleRate: webm.sampleRate, numberOfChannels: webm.channels, ...(webm.codecPrivate ? { description: webm.codecPrivate } : {}) };
      yield* decodePackets(config, inBatches(webm.frames), 20_000);
      return;
    }
    // Fallback: decode it all at once (fine for short or unusual recordings).
    yield* decodeWhole(bytes.buffer);
    return;
  }
  if (format === "wav") {
    const info = await readWavInfo(read, blob.size);
    if (info) {
      yield* wavStream(read, info);
      return;
    }
  }
  if (format === "mp4") {
    const mp4 = await readMp4Audio(read, blob.size);
    if (mp4 && mp4.codec !== "mp3") {
      const config: AudioDecoderConfig = { codec: mp4.codec, sampleRate: mp4.sampleRate, numberOfChannels: mp4.channels, ...(mp4.description ? { description: mp4.description } : {}) };
      if (await supported(config)) {
        yield* decodePackets(config, mp4Batches(read, mp4), (1024 / mp4.sampleRate) * 1e6);
        return;
      }
    }
  }
  if (format === "mp3" || format === "aac") {
    yield* framedStream(read, blob.size, format);
    return;
  }
  yield* decodeWhole(await blob.arrayBuffer());
}

/** Pieces of speech, cut at pauses, as they are decoded. */
export async function* speechPieces(blob: Blob, mimeType: string | null): AsyncGenerator<Piece> {
  const seg = new Segmenter();
  for await (const chunk of decodeTo16k(blob, mimeType)) yield* seg.push(chunk);
  yield* seg.flush();
}

// ── Sending ───────────────────────────────────────────────────────────────────


export const SIGN_IN_FOR_TRANSCRIPTION = "Sign in to your ProdLi account (👤, free) to transcribe audio with AI.";

export const TRANSCRIBE_QUOTA_MESSAGE = "You've used this month's audio transcription minutes. They reset on the 1st, or get more with ProdLi Pro (👤 Account).";

const MESSAGES: Record<string, string> = {
  transcribe_quota_exceeded: TRANSCRIBE_QUOTA_MESSAGE,
  ai_unavailable: "Audio transcription isn't available right now. Try again later.",
  ai_busy: "Audio transcription is busy right now. Try again in a minute.",
  too_large: "Part of the audio couldn't be sent. Try again.",
  bad_request: "Part of the audio couldn't be read. Try again.",
};

type Stub = (wav: Uint8Array, startMs: number, vocabulary: string[], language?: string) => Promise<PieceResult>;

/** `language`: an ISO 639-1 code for Whisper (dictation, Settings → Language); undefined = Whisper detects it. */
async function sendPiece(wav: Uint8Array, startMs: number, vocabulary: string[], language?: string): Promise<PieceResult> {
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliTranscribeStub?: Stub }).__prodliTranscribeStub;
    if (stub) return stub(wav, startMs, vocabulary, language);
  }
  const headers: Record<string, string> = { "Content-Type": "audio/wav" };
  // Names and terms as a spelling hint for Whisper (Setup → word list).
  if (vocabulary.length) headers["X-ProdLi-Vocabulary"] = encodeURIComponent(vocabulary.slice(0, 40).join(",")).slice(0, 1500);
  const path = language ? `/api/ai/transcribe?language=${encodeURIComponent(language)}` : "/api/ai/transcribe";
  return accountRequest<PieceResult>(path, { method: "POST", headers, body: wav as BodyInit }, MESSAGES);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (err: unknown) => err instanceof AccountError && (err.status === 0 || err.status === 502 || err.status === 503 || /reach ProdLi/.test(err.message));

/** Sends one piece to ProdLi's AI, retrying brief network problems. (Also used by the background for Zoom/Teams recordings.) */
export async function sendWithRetry(wav: Uint8Array, startMs: number, vocabulary: string[], signal?: AbortSignal, language?: string): Promise<PieceResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendPiece(wav, startMs, vocabulary, language);
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
