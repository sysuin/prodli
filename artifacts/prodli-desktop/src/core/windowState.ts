// Remembering where the main window was, and putting it back somewhere visible
// (a monitor may have been unplugged since).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Partial<Rect> {
  maximized?: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 820 };
export const MIN_SIZE = { width: 900, height: 600 };

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Bounds to open the window with, given what was saved and the displays' work
 * areas now. Keeps the saved place if enough of it (a 100×100 corner) is on a
 * display; otherwise centres it on the primary display, shrunk to fit.
 */
export function restoreBounds(saved: WindowState | null | undefined, workAreas: Rect[]): Partial<Rect> & { width: number; height: number } {
  const primary = workAreas[0] ?? { x: 0, y: 0, ...DEFAULT_SIZE };
  const fit = (w: number, h: number) => ({ width: Math.max(MIN_SIZE.width, Math.min(w, primary.width)), height: Math.max(MIN_SIZE.height, Math.min(h, primary.height)) });
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (saved && ok(saved.x) && ok(saved.y) && ok(saved.width) && ok(saved.height) && saved.width >= 200 && saved.height >= 200) {
    const rect = { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(saved.width), height: Math.round(saved.height) };
    const visible = workAreas.some((a) => overlap({ x: rect.x, y: rect.y, width: Math.min(rect.width, 100), height: Math.min(rect.height, 100) }, a) >= 100 * 100 * 0.5);
    if (visible) return { ...rect, width: Math.max(MIN_SIZE.width, rect.width), height: Math.max(MIN_SIZE.height, rect.height) };
  }
  const usable = (n: unknown, min: number, fallback: number) => (ok(n) && n >= min ? n : fallback);
  const size = fit(usable(saved?.width, MIN_SIZE.width, DEFAULT_SIZE.width), usable(saved?.height, MIN_SIZE.height, DEFAULT_SIZE.height));
  return { ...size, x: Math.round(primary.x + (primary.width - size.width) / 2), y: Math.round(primary.y + (primary.height - size.height) / 2) };
}
