// Import from other apps: reads a file for the app the user picked. A file
// that is clearly another app's export (a TickTick backup picked as Todoist,
// say) is read as what it is, and the preview says so.

import { APP_NAMES, type ImportApp, type ParsedImport } from "./core";
import { isTodoistCsv, parseTodoistFiles, parseTodoistZip } from "./todoist";
import { isTickTickCsv, parseTickTickCsv } from "./ticktick";
import { isGoogleTasksJson, parseGoogleTasksJson, parseGoogleTasksZip } from "./googleTasks";
import { readCsvTable, type CsvTable } from "./genericCsv";
import { parseMarkdownTasks } from "./markdown";

export * from "./core";

/** Largest file we read (a Todoist backup or Takeout .zip is usually far smaller). */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export const APP_FILES: Record<ImportApp, { accept: string; hint: string }> = {
  todoist: { accept: ".csv,.zip", hint: "A project exported as CSV (project ⋯ → Export as a template → CSV file), or a backup .zip from Settings → Backups." },
  ticktick: { accept: ".csv", hint: "Settings → Account → Backup & Restore → Generate backup. Pick the .csv it downloads." },
  google: { accept: ".json,.zip", hint: "takeout.google.com → choose only Tasks → export. Pick Tasks.json, or the whole .zip." },
  csv: { accept: ".csv,.tsv,.txt", hint: "Any spreadsheet saved as CSV with a header row. You'll choose which column is the title, date and so on." },
  markdown: { accept: ".md,.markdown,.txt", hint: "Lines like “- [ ] task” or “- [x] done”, bullets or plain lines. Headings become lists." },
};

export type ReadResult = { kind: "parsed"; parsed: ParsedImport } | { kind: "table"; table: CsvTable };

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function noted(parsed: ParsedImport, picked: ImportApp): ParsedImport {
  if (parsed.app === picked) return parsed;
  return { ...parsed, info: [`This file is a ${APP_NAMES[parsed.app]} export, so it was read as one.`, ...parsed.info] };
}

export async function readImportFile(app: ImportApp, name: string, bytes: Uint8Array, now = new Date()): Promise<ReadResult> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("This file is too large (over 30 MB).");
  if (isZip(bytes)) {
    if (app === "google") return { kind: "parsed", parsed: await parseGoogleTasksZip(bytes) };
    if (app === "todoist") return { kind: "parsed", parsed: await parseTodoistZip(bytes, now) };
    // A zip picked for another app: try both readers before giving up.
    try {
      return { kind: "parsed", parsed: noted(await parseTodoistZip(bytes, now), app) };
    } catch {
      try {
        return { kind: "parsed", parsed: noted(await parseGoogleTasksZip(bytes), app) };
      } catch {
        throw new Error(`This .zip isn't a ${APP_NAMES[app]} export.`);
      }
    }
  }
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  if (!text.trim()) throw new Error("This file is empty.");
  // Clear matches first, whatever was picked.
  if (isGoogleTasksJson(text)) return { kind: "parsed", parsed: noted(parseGoogleTasksJson(text), app) };
  if (app !== "markdown" || /\.(csv|tsv)$/i.test(name)) {
    if (isTodoistCsv(text)) return { kind: "parsed", parsed: noted(parseTodoistFiles([{ name, text }], now), app) };
    if (isTickTickCsv(text)) return { kind: "parsed", parsed: noted(parseTickTickCsv(text), app) };
  }
  switch (app) {
    case "todoist":
      return { kind: "parsed", parsed: parseTodoistFiles([{ name, text }], now) };
    case "ticktick":
      return { kind: "parsed", parsed: parseTickTickCsv(text) };
    case "google":
      return { kind: "parsed", parsed: parseGoogleTasksJson(text) };
    case "csv":
      return { kind: "table", table: readCsvTable(text) };
    case "markdown":
      return { kind: "parsed", parsed: parseMarkdownTasks(text, now) };
  }
}
