// Opening an Ask ProdLi source (UI only: kept out of lib/ask.ts so the
// background script, which runs scheduled prompts, doesn't load page code).

import { storageSet } from "./storage";
import { openSection } from "../sections/registry";
import type { AskSource } from "./ask";

/** Opens a source: a note in Notes, or a meeting in Meetings. */
export async function openSource(src: AskSource): Promise<void> {
  if (src.kind === "note") {
    await storageSet("activeNoteId", src.id);
    openSection("editor");
  } else {
    await storageSet(OPEN_MEETING_KEY, src.id);
    openSection("meetings");
  }
  // Already on that page: it switches right away.
  window.dispatchEvent(new CustomEvent(OPEN_ITEM_EVENT, { detail: src }));
}
export const OPEN_ITEM_EVENT = "prodli-open-item";

/** Meetings opens this meeting next time it loads (from Ask ProdLi sources). */
export const OPEN_MEETING_KEY = "openMeetingId";
