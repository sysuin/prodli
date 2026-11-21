// Note templates and the daily note (pure logic: noteTemplatesCore.ts).

import { storageGet, storageSet } from "./storage";
import { buildDailyNote } from "./noteTemplatesCore";
import type { DayRecord, Note, Todo } from "../types";
export * from "./noteTemplatesCore";

/** Today's daily note: the existing one's id, or a new note to add (reads tasks and focus from storage). */
export async function prepareDailyNote(notes: Note[], now = new Date()): Promise<{ id: string; note?: Note }> {
  const [todos, days] = await Promise.all([storageGet<Todo[]>("todos", []), storageGet<DayRecord[]>("days", [])]);
  return buildDailyNote(notes, todos, days, now);
}

/** Asks Notes to open today's daily note (works whether or not Notes is open yet). */
export const DAILY_NOTE_EVENT = "prodli-daily-note";
export const PENDING_DAILY_KEY = "pendingDailyNote";
export async function requestDailyNote(): Promise<void> {
  await storageSet(PENDING_DAILY_KEY, true);
  window.dispatchEvent(new CustomEvent(DAILY_NOTE_EVENT));
}

