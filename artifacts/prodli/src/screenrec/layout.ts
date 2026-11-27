// Screen recorder: where the camera bubble goes, and recording options. Pure.

export type BubbleSize = "small" | "medium" | "large";
export type BubbleCorner = "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type BubbleShape = "circle" | "rounded";

export interface BubbleLayout {
  size: BubbleSize;
  corner: BubbleCorner;
  shape: BubbleShape;
  /** Hidden for a moment (the bubble button in the controls). */
  visible: boolean;
}

export type RecordMode = "screen-camera" | "screen" | "camera";

export const BUBBLE_FRACTION: Record<BubbleSize, number> = { small: 0.17, medium: 0.24, large: 0.33 };

/** The bubble's square in a frame of this size: a fraction of the shorter side, inset from the corner. */
export function bubbleRect(width: number, height: number, layout: Pick<BubbleLayout, "size" | "corner">): { x: number; y: number; size: number } {
  const size = Math.round(Math.min(width, height) * BUBBLE_FRACTION[layout.size]);
  const margin = Math.round(Math.min(width, height) * 0.035);
  const x = layout.corner.endsWith("left") ? margin : width - margin - size;
  const y = layout.corner.startsWith("top") ? margin : height - margin - size;
  return { x, y, size };
}

/** Video bitrate for a frame size: enough for sharp text in screen recordings, without huge files. */
export function videoBitrate(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 2560 * 1440) return 6_000_000;
  if (pixels >= 1920 * 1080) return 4_000_000;
  if (pixels >= 1280 * 720) return 2_500_000;
  return 1_500_000;
}

/** The best format Chrome can record here. */
export function pickMimeType(isSupported: (t: string) => boolean): string {
  for (const t of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (isSupported(t)) return t;
  return "video/webm";
}

/** Longest recording (the file stays on the device until it's shared). */
export const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
