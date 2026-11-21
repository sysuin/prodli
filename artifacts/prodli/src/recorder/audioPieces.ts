// Pure audio helpers for AI transcription, shared by the extension and the
// phone app (artifacts/prodli-mobile): resampling to 16 kHz mono, cutting the
// audio into pieces at pauses, WAV encoding, and turning Whisper's results
// into transcript lines. No browser, Chrome or network APIs here.

export const RATE = 16_000;
const FRAME = RATE / 50; // 20 ms
const MAX_PIECE_FRAMES = 25 * 50; // 25 s
export const AUDIO_SPEAKER = "Speaker";

/** What /api/ai/transcribe returns for one piece. */
export interface PieceResult {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string | null;
  usage?: { usedSeconds: number; limitSeconds: number };
}

/** A transcript line (the shape of TranscriptEntry in ./types). */
export interface AudioEntry {
  id: string;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  source?: "device" | "audio";
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

/** Transcript lines from the pieces' results (times are from the start of the recording). */
export function toEntries(results: { startMs: number; durationMs: number; result: PieceResult }[]): AudioEntry[] {
  const entries: AudioEntry[] = [];
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
