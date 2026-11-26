// Import notes from other apps: reads the files picked for an app. A .zip is
// opened (Notion sometimes puts .zip files inside its .zip); an export that is
// clearly another app's is read as what it is, and the preview says so.

import { readZip } from "../zip";
import { NOTE_APP_NAMES, plural, type NoteApp, type ParsedNotes } from "./core";
import { isEnex, parseEnex } from "./evernote";
import { isKeepExport, parseKeepFiles } from "./keep";
import { isNoteFile, parseMarkdownFiles, text, type ExportFile } from "./markdownFiles";
import { isNotionExport, parseNotionFiles } from "./notion";

export * from "./core";

/** Largest import (all files together). Evernote exports carry their pictures inside, so they can be big. */
export const MAX_NOTES_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 20_000;

export const NOTE_APP_FILES: Record<NoteApp, { accept: string; hint: string }> = {
  notion: { accept: ".zip,.md,.html,.csv", hint: "Settings → Export all workspace content (or a page's ⋯ → Export) → “Markdown & CSV”, with “Include subpages”. Pick the .zip it downloads." },
  evernote: { accept: ".enex", hint: "Select notes or a notebook → Export → ENEX format (.enex). You can pick several .enex files." },
  keep: { accept: ".zip,.json", hint: "takeout.google.com → choose only Keep → export. Pick the .zip it downloads." },
  markdown: { accept: ".zip,.md,.markdown,.txt", hint: "Obsidian, Bear, Logseq or any folder of .md files: zip the folder, or pick several files. Pictures in the .zip come along." },
};

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Every file in what was picked, with .zip files (and .zip files inside them) opened. */
export async function expandFiles(picked: { name: string; bytes: Uint8Array }[]): Promise<ExportFile[]> {
  const out: ExportFile[] = [];
  let total = 0;
  const add = async (path: string, bytes: Uint8Array, depth: number) => {
    total += bytes.length;
    if (total > MAX_NOTES_IMPORT_BYTES) throw new Error("This export is too large to import at once (over 200 MB). Export fewer notes at a time.");
    if (isZip(bytes) && depth < 3) {
      const entries = await readZip(bytes, () => true, MAX_FILES);
      for (const e of entries) await add(e.name, e.bytes, depth + 1);
    } else if (out.length < MAX_FILES) out.push({ path, bytes });
  };
  for (const f of picked) await add(f.name, f.bytes, 0);
  return out;
}

function noted(parsed: ParsedNotes, picked: NoteApp): ParsedNotes {
  if (parsed.app === picked) return parsed;
  return { ...parsed, info: [`This is a ${NOTE_APP_NAMES[parsed.app]} export, so it was read as one.`, ...parsed.info] };
}

/** What kind of export these files are, whatever was picked. */
function detect(files: ExportFile[]): NoteApp | null {
  if (files.some((f) => /\.enex$/i.test(f.path) || (/\.xml$/i.test(f.path) && isEnex(text(f))))) return "evernote";
  if (isKeepExport(files)) return "keep";
  if (isNotionExport(files.map((f) => f.path))) return "notion";
  return null;
}

export async function readNoteFiles(app: NoteApp, picked: { name: string; bytes: Uint8Array }[]): Promise<ParsedNotes> {
  const files = await expandFiles(picked);
  if (!files.length) throw new Error("These files are empty.");
  const kind = detect(files) ?? app;
  let parsed: ParsedNotes;
  switch (kind) {
    case "evernote":
      parsed = parseEnex(files.filter((f) => /\.(enex|xml)$/i.test(f.path)).map((f) => ({ name: f.path, text: text(f) })));
      break;
    case "keep":
      parsed = parseKeepFiles(files);
      break;
    case "notion":
      parsed = parseNotionFiles(files);
      break;
    default:
      parsed = parseMarkdownFiles(files);
  }
  if (!parsed.notes.length) {
    const hasNotes = files.some((f) => isNoteFile(f.path) || /\.(enex|json|html?)$/i.test(f.path));
    throw new Error(hasNotes ? `No notes found in ${plural(files.length, "file")}.` : `There are no notes in this ${picked.length === 1 && isZip(picked[0].bytes) ? ".zip" : "selection"}. Pick the export from ${NOTE_APP_NAMES[app]}.`);
  }
  return noted(parsed, app);
}
