// Any CSV (Trello, Asana, Notion, a spreadsheet): the user picks which column
// is the title, and optionally the due date, priority, list, done, notes and
// labels. We guess from the header names first.

import { detectDelimiter, parseCsv } from "./csv";
import { parseDateText } from "./dates";
import type { ImportTask, ParsedImport, Priority } from "./core";

export const CSV_FIELDS = ["title", "due", "priority", "list", "done", "notes", "labels"] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
/** Field → column index (-1 = not used). */
export type CsvMapping = Record<CsvField, number>;

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  title: "Title",
  due: "Due date",
  priority: "Priority",
  list: "List",
  done: "Done",
  notes: "Notes",
  labels: "Labels",
};

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function readCsvTable(text: string): CsvTable {
  const rows = parseCsv(text, detectDelimiter(text)).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new Error("This CSV needs a header row and at least one task.");
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (rows[0][i] ?? "").trim() || `Column ${i + 1}`);
  return { headers, rows: rows.slice(1) };
}

const GUESS: [CsvField, RegExp][] = [
  ["title", /^(title|task|task name|name|content|subject|to-?do|item|summary|card name)$/i],
  ["due", /due|deadline|^date$|end date/i],
  ["priority", /prio|importance|urgency/i],
  ["list", /^(list|list name|project|folder|category|board|group|section|area)$/i],
  ["done", /^(done|completed?|status|checked|is completed|state|closed)$/i],
  ["notes", /note|desc|detail|comment|body|content/i],
  ["labels", /label|tag/i],
];

export function guessMapping(headers: string[]): CsvMapping {
  const m = Object.fromEntries(CSV_FIELDS.map((f) => [f, -1])) as CsvMapping;
  const used = new Set<number>();
  for (const [field, re] of GUESS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h.trim()));
    if (i >= 0) {
      m[field] = i;
      used.add(i);
    }
  }
  if (m.title < 0) m.title = headers.findIndex((_, i) => !used.has(i));
  return m;
}

/** "High", "urgent", "p1", "1", "!!!" → high … ; 1–4 read like Todoist (1 highest, 4 none). */
export function parsePriority(raw: string): Priority | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (/^(high|highest|urgent|critical|important|h|p1|1|!!!|★★★)$/.test(s)) return "high";
  if (/^(medium|med|normal|moderate|m|p2|2|!!|★★)$/.test(s)) return "medium";
  if (/^(low|lowest|minor|l|p3|3|!|★)$/.test(s)) return "low";
  return undefined;
}

export function parseDone(raw: string): boolean {
  return /^(true|yes|y|1|x|done|complete|completed|closed|finished|resolved|✓|✔|☑)$/i.test(raw.trim());
}

export function parseGenericRows(table: CsvTable, mapping: CsvMapping, now = new Date()): ParsedImport {
  if (mapping.title < 0) throw new Error("Pick the column that has the task titles.");
  const get = (r: string[], f: CsvField) => (mapping[f] >= 0 ? (r[mapping[f]] ?? "").trim() : "");
  const tasks: ImportTask[] = [];
  for (const r of table.rows) {
    const title = get(r, "title");
    if (!title) continue;
    const t: ImportTask = { title, completed: parseDone(get(r, "done")) };
    const list = get(r, "list");
    if (list) t.list = list;
    const p = parsePriority(get(r, "priority"));
    if (p) t.priority = p;
    const d = parseDateText(get(r, "due"), now);
    if (d.dueDate) t.dueDate = d.dueDate;
    if (d.dueTime) t.dueTime = d.dueTime;
    if (d.repeat) t.repeat = d.repeat;
    if (d.unmappedRepeat) t.repeatNote = d.unmappedRepeat;
    if (d.unparsed) t.dateNote = d.unparsed;
    const notes = get(r, "notes");
    if (notes) t.notes = [notes];
    const labels = get(r, "labels")
      .split(/[,;|]|\s+(?=[#@])/)
      .map((x) => x.trim().replace(/^[#@]/, ""))
      .filter(Boolean);
    if (labels.length) t.labels = labels;
    tasks.push(t);
  }
  const unused = table.headers.filter((_, i) => !Object.values(mapping).includes(i));
  return { app: "csv", tasks, dropped: unused.length ? [`Columns not picked: ${unused.slice(0, 6).join(", ")}${unused.length > 6 ? "…" : ""}`] : [], info: [] };
}
