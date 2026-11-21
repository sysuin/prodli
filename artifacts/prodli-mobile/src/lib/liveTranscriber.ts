// Live transcription of a recording on the phone. Microphone audio (16-bit PCM
// at whatever rate the phone delivers) is turned into 16 kHz mono, cut into
// pieces at pauses — the extension's own Resampler and Segmenter — and each
// piece is sent to ProdLi's AI (Whisper) while recording continues. Silence
// is never sent. Pure logic: the network call is passed in, so it's tested
// without a phone or a server.
import { encodeWav, generateId, RATE, Resampler, Segmenter, toEntries, type AudioEntry, type Piece, type PieceResult } from "../shared";

export type SendPiece = (wav: Uint8Array, startMs: number) => Promise<PieceResult>;

export interface TranscriberState {
  entries: AudioEntry[];
  /** Pieces waiting to be sent or being sent. */
  pending: number;
  /** Pieces that couldn't be transcribed (after retries). */
  failed: number;
  /** The last error, for the screen. */
  error: string | null;
  /** Seconds of sound sent so far. */
  sentSeconds: number;
}

/** 16-bit little-endian PCM (interleaved if stereo) → mono floats in [-1, 1]. */
export function int16ToMonoFloat(data: ArrayBuffer, channels = 1): Float32Array {
  const view = new DataView(data);
  const frames = Math.floor(data.byteLength / 2 / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += view.getInt16((i * channels + c) * 2, true);
    out[i] = sum / channels / 0x8000;
  }
  return out;
}

export class LiveTranscriber {
  private resampler: Resampler | null = null;
  private rate = RATE;
  private segmenter = new Segmenter();
  private results: { startMs: number; durationMs: number; result: PieceResult }[] = [];
  private queue: Piece[] = [];
  private active = 0;
  private idle: (() => void)[] = [];
  private state: TranscriberState = { entries: [], pending: 0, failed: 0, error: null, sentSeconds: 0 };

  constructor(
    private readonly send: SendPiece,
    private readonly onChange: (s: TranscriberState) => void = () => {},
    private readonly opts: { concurrency?: number; retries?: number; retryDelayMs?: number; isRetryable?: (err: unknown) => boolean } = {},
  ) {}

  get snapshot(): TranscriberState {
    return this.state;
  }

  /** Audio from the microphone. */
  push(pcm: ArrayBuffer, sampleRate: number, channels = 1): void {
    const mono = int16ToMonoFloat(pcm, channels);
    if (sampleRate !== this.rate || (!this.resampler && sampleRate !== RATE)) {
      this.rate = sampleRate;
      this.resampler = sampleRate === RATE ? null : new Resampler(sampleRate);
    }
    const at16k = this.resampler ? this.resampler.push(mono) : mono;
    for (const piece of this.segmenter.push(at16k)) this.enqueue(piece);
  }

  /** The recording ended: sends what's left and waits for every piece. */
  async finish(): Promise<TranscriberState> {
    for (const piece of this.segmenter.flush()) this.enqueue(piece);
    if (this.active || this.queue.length) await new Promise<void>((r) => this.idle.push(r));
    return this.state;
  }

  private enqueue(piece: Piece) {
    this.queue.push(piece);
    this.update({ pending: this.queue.length + this.active });
    this.pump();
  }

  private pump() {
    const limit = this.opts.concurrency ?? 2;
    while (this.active < limit && this.queue.length) {
      const piece = this.queue.shift()!;
      this.active++;
      void this.transcribe(piece).finally(() => {
        this.active--;
        this.update({ pending: this.queue.length + this.active });
        if (this.queue.length) this.pump();
        else if (!this.active) for (const r of this.idle.splice(0)) r();
      });
    }
  }

  private async transcribe(piece: Piece) {
    const durationMs = Math.round((piece.samples.length / RATE) * 1000);
    const wav = encodeWav(piece.samples);
    const retries = this.opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.send(wav, piece.startMs);
        this.results.push({ startMs: piece.startMs, durationMs, result });
        this.update({ entries: toEntries(this.results), sentSeconds: this.state.sentSeconds + durationMs / 1000, error: null });
        return;
      } catch (err) {
        const again = attempt < retries && (this.opts.isRetryable?.(err) ?? true);
        if (!again) {
          this.update({ failed: this.state.failed + 1, error: err instanceof Error ? err.message : String(err) });
          return;
        }
        await new Promise((r) => setTimeout(r, (this.opts.retryDelayMs ?? 1500) * (attempt + 1)));
      }
    }
  }

  private update(patch: Partial<TranscriberState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}

/** A finished in-person recording as a ProdLi meeting (the extension's shape, platform "in-person"). */
export function inPersonMeeting(input: { title: string; startedAt: number; endedAt: number; entries: AudioEntry[]; failed: number; languages?: string[] }) {
  const now = new Date(input.endedAt).toISOString();
  const durationSec = Math.max(0, Math.round((input.endedAt - input.startedAt) / 1000));
  const notice = !input.entries.length ? "Nothing was transcribed — no speech was heard, or transcription failed." : input.failed ? `${input.failed} part${input.failed > 1 ? "s" : ""} of the recording couldn't be transcribed.` : null;
  return {
    id: generateId(),
    platform: "in-person",
    title: input.title.trim() || `In-person meeting, ${new Date(input.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    meetingCode: null,
    url: "",
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: now,
    durationSec,
    status: "ready" as const,
    transcript: input.entries,
    summary: null,
    error: null,
    notice,
    hasAudio: false,
    micIncluded: true,
    transcriptSource: "audio",
    ...(input.languages?.length ? { audioLanguages: input.languages } : {}),
    audioMimeType: null,
    updatedAt: now,
  };
}
