// Undo for a notes import, apart from ./apply.ts so App can offer it without loading the readers.

import { storageGet, storageSet } from "../storage";
import { recordDeletions } from "../tombstones";
import type { Note } from "../../types";

export interface NotesImportOutcome {
  added: number;
  skipped: number;
  tooLarge: number;
  picturesDropped: number;
  undo: { noteIds: string[] };
}

/** Removes exactly the notes an import added, and records the deletions so sync doesn't bring them back. */
export async function undoNotesImport(u: { noteIds: string[] }): Promise<void> {
  const ids = new Set(u.noteIds);
  const notes = await storageGet<Note[]>("notes", []);
  await storageSet(
    "notes",
    notes.filter((n) => !ids.has(n.id)),
  );
  await recordDeletions("notes", u.noteIds);
}
