// Saving a notes import. Writes straight to storage (like the to-do import), so
// open ProdLi tabs and sync pick the notes up. Undo: ./undo.ts.

import { storageGet, storageSet } from "../storage";
import { buildNotes, type ImageToDataUrl, type ParsedNotes } from "./core";
import type { NotesImportOutcome } from "./undo";
import type { Note } from "../../types";

export { undoNotesImport, type NotesImportOutcome } from "./undo";

export async function applyNotesImport(parsed: ParsedNotes, opts: { includeArchived: boolean; toDataUrl: ImageToDataUrl; now?: Date }): Promise<NotesImportOutcome> {
  const existing = await storageGet<Note[]>("notes", []);
  const built = await buildNotes(parsed, { existing, ...opts });
  if (built.notes.length) {
    // Read again: pictures take a while, and a note may have been edited meanwhile.
    const now = await storageGet<Note[]>("notes", []);
    await storageSet("notes", [...built.notes, ...now]);
  }
  return { added: built.notes.length, skipped: built.skipped, tooLarge: built.tooLarge, picturesDropped: built.picturesDropped, undo: { noteIds: built.notes.map((n) => n.id) } };
}
