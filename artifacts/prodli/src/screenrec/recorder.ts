// Screen recorder: the recording itself. Screen (a tab, a window or the whole
// screen, picked in Chrome's own dialog; no extension permission needed), the
// camera as a bubble, the microphone and the tab's or computer's sound.
//
// The bubble is drawn into the video by a worker (compositor.worker.ts) when
// recording a tab or a window. When recording the whole screen, the floating
// bubble window (Document Picture-in-Picture) is on the screen and so in the
// video already, like Loom's. Pieces are saved to IndexedDB as they come
// (the meeting recorder's chunk store), so a closed tab doesn't lose them.

import { appendAudioChunk, deleteMeetingAudio, finalizeAudio, getAudio, putAudio } from "../recorder/db";
import { pickMimeType, videoBitrate, type BubbleLayout, type RecordMode } from "./layout";
import { withDuration } from "./webmDuration";

export interface RecordOptions {
  mode: RecordMode;
  /** null: no microphone. */
  micId: string | null;
  cameraId?: string;
  layout: BubbleLayout;
}

export interface Finished {
  id: string;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  width: number;
  height: number;
  hasSound: boolean;
}

export class RecordError extends Error {
  constructor(
    message: string,
    readonly cancelled = false,
  ) {
    super(message);
  }
}

type Processor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
type Generator = new (init: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

export class ScreenRecording {
  readonly id = `mtg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  startedAt = new Date();
  camera: MediaStream | null = null;
  displaySurface: string | undefined;
  /** The bubble is drawn into the video (tab or window); false for the whole screen or no camera. */
  composited = false;
  onEnded: (() => void) | null = null;

  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private worker: Worker | null = null;
  private audio: AudioContext | null = null;
  private outTrack: MediaStreamTrack | null = null;
  private seq = 0;
  private saving: Promise<void> = Promise.resolve();
  private runMs = 0;
  private runFrom = 0;
  private mimeType = "video/webm";
  private size = { width: 1280, height: 720 };
  private hasSound = false;

  /** Asks for the camera and microphone. Call before start so the bubble can show right away. */
  async openDevices(opts: RecordOptions): Promise<void> {
    if (opts.mode !== "screen" && !this.camera) {
      this.camera = await navigator.mediaDevices.getUserMedia({ video: { ...(opts.cameraId ? { deviceId: { exact: opts.cameraId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }).catch(() => {
        throw new RecordError("ProdLi couldn't open your camera. Check Chrome's camera permission for ProdLi, or record without the camera.");
      });
    }
    if (opts.micId !== null && !this.mic) {
      this.mic = await navigator.mediaDevices
        .getUserMedia({ audio: { ...(opts.micId ? { deviceId: { exact: opts.micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .catch(() => {
          throw new RecordError("ProdLi couldn't open your microphone. Check Chrome's microphone permission for ProdLi, or record without sound.");
        });
    }
  }

  /** The shared tab's or window's name, when Chrome gives one (a good default title). */
  get sourceLabel(): string {
    const label = this.display?.getVideoTracks()[0]?.label ?? "";
    return /^(screen|window|web-contents-media-stream):/.test(label) ? "" : label;
  }

  /** Opens Chrome's "choose what to share" dialog (screen modes). */
  async pickScreen(): Promise<void> {
    try {
      this.display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
        // Not the recorder's own tab; let people switch what they share; offer the computer's sound.
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      throw new RecordError((err as Error)?.name === "NotAllowedError" ? "Recording was cancelled." : "Chrome couldn't share your screen.", (err as Error)?.name === "NotAllowedError");
    }
    const track = this.display.getVideoTracks()[0];
    this.displaySurface = (track.getSettings() as { displaySurface?: string }).displaySurface;
    // Chrome's "Stop sharing" bar ends the recording.
    track.addEventListener("ended", () => this.onEnded?.());
  }

  /** Starts recording (after the countdown). */
  start(opts: RecordOptions): void {
    const screenTrack = this.display?.getVideoTracks()[0] ?? null;
    const cameraTrack = this.camera?.getVideoTracks()[0] ?? null;
    let video: MediaStreamTrack | null = opts.mode === "camera" ? cameraTrack : screenTrack;
    const g = globalThis as { MediaStreamTrackProcessor?: Processor; MediaStreamTrackGenerator?: Generator };
    // Test builds can force drawing the bubble (Chrome's fake screen counts as the whole screen).
    const forceComposite = import.meta.env.VITE_E2E === "1" && !!(globalThis as { __prodliForceComposite?: boolean }).__prodliForceComposite;
    if (opts.mode === "screen-camera" && screenTrack && cameraTrack && (this.displaySurface !== "monitor" || forceComposite) && g.MediaStreamTrackProcessor && g.MediaStreamTrackGenerator) {
      const out = new g.MediaStreamTrackGenerator({ kind: "video" });
      const screen = new g.MediaStreamTrackProcessor({ track: screenTrack }).readable;
      const camera = new g.MediaStreamTrackProcessor({ track: cameraTrack.clone() }).readable;
      this.worker = new Worker(new URL("./compositor.worker.ts", import.meta.url), { type: "module" });
      this.worker.postMessage({ type: "start", screen, camera, out: out.writable, layout: opts.layout, fps: 30 }, [screen, camera, out.writable] as unknown as Transferable[]);
      this.outTrack = out;
      video = out;
      this.composited = true;
    }
    if (!video) throw new RecordError("There's nothing to record.");
    const settings = (screenTrack ?? cameraTrack)?.getSettings();
    this.size = { width: settings?.width ?? 1280, height: settings?.height ?? 720 };

    // Sound: the microphone and the shared tab's (or computer's) sound, mixed.
    const sources = [this.mic, this.display].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    const tracks: MediaStreamTrack[] = [video];
    if (sources.length) {
      this.audio = new AudioContext();
      const dest = this.audio.createMediaStreamDestination();
      for (const s of sources) this.audio.createMediaStreamSource(s).connect(dest);
      tracks.push(dest.stream.getAudioTracks()[0]);
      this.hasSound = true;
    }
    this.mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: this.mimeType, videoBitsPerSecond: videoBitrate(this.size.width, this.size.height), audioBitsPerSecond: 128_000 });
    this.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const seq = this.seq++;
      this.saving = this.saving.then(() => appendAudioChunk(this.id, seq, e.data)).catch(() => undefined);
    };
    this.recorder.start(2000);
    this.startedAt = new Date();
    this.runFrom = performance.now();
  }

  /** The microphone, for the level meter. */
  get micStream(): MediaStream | null {
    return this.mic;
  }

  get elapsedMs(): number {
    return this.runMs + (this.recorder?.state === "recording" ? performance.now() - this.runFrom : 0);
  }
  get paused(): boolean {
    return this.recorder?.state === "paused";
  }

  pause(): void {
    if (this.recorder?.state !== "recording") return;
    this.recorder.pause();
    this.runMs += performance.now() - this.runFrom;
  }
  resume(): void {
    if (this.recorder?.state !== "paused") return;
    this.recorder.resume();
    this.runFrom = performance.now();
  }

  setLayout(layout: BubbleLayout): void {
    this.worker?.postMessage({ type: "layout", layout });
  }

  /** Stops and returns the finished video (with its length written in, so it can be seeked). */
  async stop(): Promise<Finished> {
    const durationMs = Math.round(this.elapsedMs);
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.release();
    await this.saving;
    if (!(await finalizeAudio(this.id, this.mimeType.split(";")[0]))) throw new RecordError("Nothing was recorded.");
    const raw = (await getAudio(this.id))!;
    const blob = await withDuration(raw, durationMs);
    if (blob !== raw) await putAudio(this.id, blob);
    return { id: this.id, blob, durationMs, mimeType: blob.type, ...this.size, hasSound: this.hasSound };
  }

  /** Stops everything without saving. */
  async cancel(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.release();
    await this.saving;
    await deleteMeetingAudio(this.id).catch(() => undefined);
  }

  /** Lets go of the camera, microphone and screen. */
  release(): void {
    this.worker?.postMessage({ type: "stop" });
    setTimeout(() => this.worker?.terminate(), 500);
    for (const s of [this.display, this.camera, this.mic]) s?.getTracks().forEach((t) => t.stop());
    this.outTrack?.stop();
    void this.audio?.close().catch(() => undefined);
  }
}
