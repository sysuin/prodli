// Voice dictation: records the microphone as 16 kHz audio and hands back pieces
// cut at pauses while the user is still talking, so each piece can be
// transcribed straight away and the text is ready moments after they stop.
// Runs in the extension's offscreen document (dictation into any website).

import { encodeWav, Resampler, Segmenter, type Piece } from "../recorder/audioPieces";

export interface CapturedPiece {
  seq: number;
  startMs: number;
  wav: Uint8Array;
}

export class DictationCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private resampler: Resampler | null = null;
  private segmenter = new Segmenter();
  private seq = 0;
  private startedAt = 0;
  private lastLevelAt = 0;
  private peak = 0;

  constructor(
    private onPiece: (p: CapturedPiece) => void,
    private onLevel: (level: number) => void,
  ) {}

  /** Starts the microphone. Throws a DOMException (NotAllowedError…) if it's blocked. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    this.resampler = new Resampler(this.ctx.sampleRate);
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor keeps this to one file (an AudioWorklet needs its own module).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.feed(e.inputBuffer.getChannelData(0));
    source.connect(this.node);
    // A muted output keeps the processor running in Chrome.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.startedAt = performance.now();
  }

  private feed(input: Float32Array) {
    if (!this.resampler) return;
    let peak = 0;
    for (let i = 0; i < input.length; i += 8) peak = Math.max(peak, Math.abs(input[i]));
    this.peak = Math.max(this.peak, peak);
    const now = performance.now();
    if (now - this.lastLevelAt > 90) {
      this.onLevel(Math.min(1, this.peak * 2.5));
      this.peak = 0;
      this.lastLevelAt = now;
    }
    this.emit(this.segmenter.push(this.resampler.push(input)));
  }

  private emit(pieces: Piece[]) {
    for (const p of pieces) this.onPiece({ seq: this.seq++, startMs: p.startMs, wav: encodeWav(p.samples) });
  }

  /** Stops, sends the last piece, and returns how long the user spoke (ms) and how many pieces there were. */
  stop(): { ms: number; pieces: number } {
    const ms = this.startedAt ? Math.round(performance.now() - this.startedAt) : 0;
    if (this.resampler) this.emit(this.segmenter.flush());
    this.release();
    return { ms, pieces: this.seq };
  }

  cancel(): void {
    this.release();
  }

  private release() {
    this.node?.disconnect();
    if (this.node) this.node.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.resampler = null;
  }
}
