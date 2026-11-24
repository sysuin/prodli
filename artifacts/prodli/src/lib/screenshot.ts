// Screenshot to ProdLi (extension): saving and "Pull out the text". The
// picture is saved inside a note (WebP, like pasted pictures: noteImages.ts);
// a to-do gets a link to that note. The picture goes to ProdLi's server
// (/api/ai/ocr, then Anthropic) only when the user clicks "Pull out the text",
// and isn't stored there. Server: artifacts/prodli-api/src/ocr.ts.

import { addNote, addTask } from "./capture";
import { accountRequest, accountsEnabled, AccountError, getProdliAccount } from "./prodliAccount";
import { syncOnce } from "./prodliSync";
import { isOcrImage, screenshotFits, screenshotNoteHtml } from "./screenshotCore";
import type { Note, Todo } from "../types";

export class ScreenshotError extends Error {}

const OCR_MESSAGES: Record<string, string> = {
  write_quota_exceeded: "You've used this month's AI writing help. It resets on the 1st, or get more with ProdLi Pro (👤 Account).",
  ai_unavailable: "Pulling out text isn't available right now. Try again in a little while.",
  ai_busy: "ProdLi's AI is busy right now. Try again in a minute.",
  ai_failed: "Something went wrong. Try again.",
  ai_refused: "ProdLi can't read the text in this picture.",
  ai_truncated: "There's too much text in this picture. Crop a smaller part.",
  too_large: "That picture is too big. Crop a smaller part.",
  bad_request: "That picture can't be read.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

type OcrStub = (image: string) => Promise<{ text: string }>;

/** The text in a (cropped) screenshot, through the user's ProdLi account. Throws ScreenshotError with a message to show. */
export async function extractText(image: string): Promise<string> {
  if (!isOcrImage(image)) throw new ScreenshotError(OCR_MESSAGES.too_large);
  // Test builds only: the end-to-end tests stand in for the server.
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliOcrStub?: OcrStub }).__prodliOcrStub;
    if (stub) return (await stub(image)).text.trim();
  }
  if (!accountsEnabled()) throw new ScreenshotError("Pulling out text isn't available in this copy of ProdLi.");
  if (!(await getProdliAccount())) throw new ScreenshotError("Sign in to your ProdLi account (👤, free) to pull out the text.");
  try {
    const r = await accountRequest<{ text: string }>("/api/ai/ocr", { method: "POST", body: JSON.stringify({ image }) }, OCR_MESSAGES);
    return r.text.trim();
  } catch (err) {
    throw new ScreenshotError(err instanceof AccountError ? err.message : OCR_MESSAGES.ai_failed);
  }
}

export interface SaveInput {
  /** The cropped, annotated picture as a WebP data: URL (noteImages.ts sizes). */
  image: string;
  title: string;
  /** Text pulled out of the picture (optional). */
  text?: string;
  url?: string;
}

/** Saves the screenshot as a note, or as a to-do linked to that note. */
export async function saveScreenshot(as: "note" | "todo", input: SaveInput): Promise<{ note: Note; todo?: Todo }> {
  if (!screenshotFits(input.image, input.text)) throw new ScreenshotError("This screenshot is too big for a note. Crop a smaller part.");
  const note = await addNote({ title: input.title, url: input.url, html: screenshotNoteHtml({ src: input.image, title: input.title, text: input.text, url: input.url }) });
  const todo = as === "todo" ? await addTask({ title: input.title, url: input.url, noteId: note.id }) : undefined;
  if (accountsEnabled()) void syncOnce({ onlyIfLocalChanges: true }).catch(() => {});
  return { note, todo };
}
