// Screenshot to ProdLi (extension): the pure parts, kept apart so they can be
// unit-tested and loaded by the background without page code. Coordinates are
// always in the screenshot's own pixels; the annotator scales them for display.

import { escapeHtml, noteHtml } from "./capture";
import { fitsInNote } from "./noteImages";

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

export type Tool = "crop" | "rect" | "arrow" | "highlight";
export type Annotation = { kind: "rect"; x: number; y: number; w: number; h: number } | { kind: "highlight"; x: number; y: number; w: number; h: number } | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

export const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: "crop", label: "Crop", icon: "✂️", key: "c" },
  { id: "rect", label: "Box", icon: "▭", key: "r" },
  { id: "arrow", label: "Arrow", icon: "↗", key: "a" },
  { id: "highlight", label: "Highlight", icon: "🖍", key: "h" },
];

/** Smallest crop, in screenshot pixels. Smaller drags are treated as a click. */
export const MIN_CROP = 16;
/** Shorter drags than this don't add a shape. */
export const MIN_SHAPE = 4;
export const MARK_COLOR = "#E11D48";
export const HIGHLIGHT_COLOR = "rgba(255, 215, 0, 0.45)";
/** chrome.storage.session key for the capture on its way to the annotator. */
export const PENDING_KEY = "screenshotPending";
/** Same cap as the server (prodli-api/src/ocr.ts MAX_OCR_DATA_URL). */
export const MAX_OCR_DATA_URL = 1_500_000;
/** Message from the Quick add window to the background. */
export const SCREENSHOT_MESSAGE = "prodli-screenshot";

export interface PendingShot {
  id: string;
  dataUrl: string;
  title: string;
  url: string;
  at: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The whole picture as a crop. */
export const fullRect = (size: Size): Rect => ({ x: 0, y: 0, w: size.w, h: size.h });

/** A rectangle inside the picture (whole pixels, at least 1×1). */
export function clampRect(r: Rect, size: Size): Rect {
  const x = clamp(Math.round(r.x), 0, Math.max(0, size.w - 1));
  const y = clamp(Math.round(r.y), 0, Math.max(0, size.h - 1));
  const w = clamp(Math.round(r.w), 1, size.w - x);
  const h = clamp(Math.round(r.h), 1, size.h - y);
  return { x, y, w, h };
}

/** The rectangle between two corners, dragged any direction, kept inside the picture. */
export function rectFromPoints(a: Point, b: Point, size: Size): Rect {
  const x1 = clamp(Math.min(a.x, b.x), 0, size.w);
  const y1 = clamp(Math.min(a.y, b.y), 0, size.h);
  const x2 = clamp(Math.max(a.x, b.x), 0, size.w);
  const y2 = clamp(Math.max(a.y, b.y), 0, size.h);
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

/** How much to shrink the picture to fit `avail` (never enlarged). */
export function fitScale(size: Size, avail: Size): number {
  if (size.w <= 0 || size.h <= 0 || avail.w <= 0 || avail.h <= 0) return 1;
  return Math.min(1, avail.w / size.w, avail.h / size.h);
}

/** A mouse position on the shown picture → screenshot pixels. */
export function toImagePoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, size: Size): Point {
  const sx = box.width > 0 ? size.w / box.width : 1;
  const sy = box.height > 0 ? size.h / box.height : 1;
  return { x: clamp((clientX - box.left) * sx, 0, size.w), y: clamp((clientY - box.top) * sy, 0, size.h) };
}

/**
 * Arrow keys on the picture: move the box by `step`; with Shift, change its
 * size (→/↓ bigger, ←/↑ smaller). Stays inside `bounds` and at least `min` big.
 */
export function nudgeRect(r: Rect, key: string, resize: boolean, step: number, bounds: Rect, min = 1): Rect | null {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  if (!dx && !dy) return null;
  if (resize) {
    const w = clamp(r.w + dx, min, bounds.x + bounds.w - r.x);
    const h = clamp(r.h + dy, min, bounds.y + bounds.h - r.y);
    return { ...r, w, h };
  }
  const x = clamp(r.x + dx, bounds.x, bounds.x + bounds.w - r.w);
  const y = clamp(r.y + dy, bounds.y, bounds.y + bounds.h - r.h);
  return { ...r, x, y };
}

/** A box in the middle of `area`, a third of its size: where the keyboard starts drawing. */
export function startBox(area: Rect): Rect {
  const w = Math.max(1, Math.round(area.w / 3));
  const h = Math.max(1, Math.round(area.h / 3));
  return { x: area.x + Math.round((area.w - w) / 2), y: area.y + Math.round((area.h - h) / 2), w, h };
}

/** The shape a drag makes with a drawing tool, or null when the drag was too short. */
export function shapeFromDrag(tool: Exclude<Tool, "crop">, a: Point, b: Point, size: Size): Annotation | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SHAPE) return null;
  if (tool === "arrow") {
    const end = { x: clamp(b.x, 0, size.w), y: clamp(b.y, 0, size.h) };
    return { kind: "arrow", x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(end.x), y2: Math.round(end.y) };
  }
  const r = rectFromPoints(a, b, size);
  return r.w >= 1 && r.h >= 1 ? { kind: tool, ...r } : null;
}

/** The shape the keyboard box makes (an arrow goes from its top-left to its bottom-right corner). */
export function shapeFromBox(tool: Exclude<Tool, "crop">, r: Rect): Annotation {
  return tool === "arrow" ? { kind: "arrow", x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h } : { kind: tool, ...r };
}

/** Line width that reads well at the crop's size (3–14 px). */
export function strokeWidth(crop: Size): number {
  return clamp(Math.round(Math.max(crop.w, crop.h) / 250), 3, 14);
}

/** The two outer points of an arrowhead at (x2, y2), `size` long, 28° either side. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [Point, Point] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = (28 * Math.PI) / 180;
  return [
    { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) },
    { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) },
  ];
}

/** The parts of a canvas context the drawing needs (tests pass a recorder). */
export type Draw2D = Pick<
  CanvasRenderingContext2D,
  "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "stroke" | "fill" | "strokeRect" | "fillRect" | "lineWidth" | "strokeStyle" | "fillStyle" | "lineCap" | "lineJoin" | "globalCompositeOperation"
>;

/** Draws the shapes in screenshot pixels (the caller sets any scale or crop offset). */
export function drawAnnotations(ctx: Draw2D, shapes: Annotation[], lineWidth: number): void {
  for (const s of shapes) {
    ctx.save();
    if (s.kind === "highlight") {
      // Multiply keeps the text under the highlight readable, like a marker.
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = HIGHLIGHT_COLOR;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (s.kind === "rect") {
      ctx.strokeStyle = MARK_COLOR;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    } else {
      const head = arrowHead(s.x1, s.y1, s.x2, s.y2, lineWidth * 4);
      ctx.strokeStyle = MARK_COLOR;
      ctx.fillStyle = MARK_COLOR;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(head[0].x, head[0].y);
      ctx.lineTo(head[1].x, head[1].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Is any part of the shape inside the crop? (Shapes outside it are left out of the saved picture.) */
export function touchesCrop(s: Annotation, crop: Rect): boolean {
  const box = s.kind === "arrow" ? { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) } : s;
  return box.x <= crop.x + crop.w && box.x + box.w >= crop.x && box.y <= crop.y + crop.h && box.y + box.h >= crop.y;
}

/** The note's title: "Screenshot: page title", or "Screenshot" with the date. */
export function screenshotTitle(pageTitle: string, now = new Date()): string {
  const t = pageTitle.replace(/\s+/g, " ").trim();
  if (t) return `Screenshot: ${t}`.slice(0, 120);
  return `Screenshot ${now.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** The note's HTML: the picture (as the NoteImage node saves it), then the text and the source link. */
export function screenshotNoteHtml(input: { src: string; title: string; text?: string; url?: string }): string {
  const alt = escapeHtml(input.title ? `Screenshot of ${input.title.replace(/^Screenshot:\s*/, "")}` : "Screenshot");
  const figure = `<figure data-type="note-image"><img src="${escapeHtml(input.src)}" alt="${alt}"></figure>`;
  const rest = noteHtml({ title: input.title.replace(/^Screenshot:\s*/, ""), text: input.text, url: input.url });
  return figure + rest;
}

/** Can this picture go in a new note (with its text)? Uses the notes' 1.3 MB picture limit. */
export function screenshotFits(dataUrl: string, text = ""): boolean {
  return fitsInNote(text.length + 200, dataUrl.length);
}

/** Can this picture be sent for "Pull out the text"? (WebP or PNG data: URL under the server's cap.) */
export function isOcrImage(dataUrl: string): boolean {
  return dataUrl.length <= MAX_OCR_DATA_URL && /^data:image\/(webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl);
}

/** Pages Chrome never lets extensions capture. */
export function blockedPage(url: string | undefined): boolean {
  if (!url) return false;
  return /^(chrome|chrome-untrusted|edge|brave|about|view-source|devtools|chrome-search):/i.test(url) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(url);
}

/** What to tell the user when a capture fails. */
export function captureErrorMessage(url: string | undefined): string {
  if (blockedPage(url)) return "Chrome doesn't let extensions take screenshots of its own pages (chrome://, new tab, settings) or the Chrome Web Store. Open a regular web page and try again.";
  if (url?.startsWith("file:")) return "ProdLi can't take screenshots of files on your computer unless you allow file access for ProdLi in chrome://extensions.";
  return "ProdLi couldn't take a screenshot of this page. Click on the page, then try again.";
}
