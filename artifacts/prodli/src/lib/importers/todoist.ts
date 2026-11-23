// Todoist: a project's CSV export (project ⋯ → Export as a template → CSV),
// or a backup .zip (Settings → Backups), which is one such CSV per project.
//
// Columns: TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, AUTHOR, RESPONSIBLE,
// DATE, DATE_LANG, TIMEZONE, DURATION, DURATION_UNIT, DEADLINE, DEADLINE_LANG.
// TYPE is "task", "section", "note" (a comment on the task above) or "meta".
//
// Priority: Todoist's CSV help says 1 = p1 (highest, red) … 4 = p4 (lowest,
// no flag) — the reverse of its API, where 4 = p1. We read the CSV order:
// p1 → high, p2 → medium, p3 → low, p4 → none. Most tasks in a real project
// have no priority, so if most tasks say 1 the file must use the API order;
// then 4 is read as highest instead (and the preview says so).
//
// Projects become lists (the Inbox project → ProdLi's Inbox), sections become
// labels, INDENT 2+ becomes a subtask of the task above it (deeper levels
// flatten into the same top task), @labels in the name become labels, the
// description and comments become note subtasks, DURATION (minutes) becomes
// the time estimate. Recurring dates are mapped where ProdLi's repeat can say
// the same thing; otherwise the rule is kept as a note on the task.

import { cell, findHeaderRow, parseCsv, rowsToObjects } from "./csv";
import { parseDateText } from "./dates";
import { splitLabels, type ImportTask, type ParsedImport, type Priority } from "./core";
import { readZip } from "../zip";

/** "Work [2203306141].csv" → "Work". */
export function projectNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.csv$/i, "").replace(/\s*\[\d+\]\s*$/, "").replace(/\s*\(\d+\)\s*$/, "").trim() || "Todoist";
}

export function isTodoistCsv(text: string): boolean {
  return findHeaderRow(parseCsv(text.slice(0, 2000), ","), ["TYPE", "CONTENT", "PRIORITY"], 3) >= 0;
}

interface Raw {
  type: string;
  content: string;
  description: string;
  priority: number | null;
  indent: number;
  responsible: string;
  date: string;
  dateLang: string;
  deadline: string;
  duration: number;
  durationUnit: string;
}

function readRows(text: string): Raw[] {
  const rows = parseCsv(text, ",");
  const h = findHeaderRow(rows, ["TYPE", "CONTENT"], 5);
  if (h < 0) throw new Error("This doesn't look like a Todoist CSV export (no TYPE and CONTENT columns).");
  return rowsToObjects(rows, h).map((r) => {
    const p = parseInt(cell(r, "PRIORITY"), 10);
    return {
      type: cell(r, "TYPE").toLowerCase(),
      content: cell(r, "CONTENT"),
      description: cell(r, "DESCRIPTION"),
      priority: p >= 1 && p <= 4 ? p : null,
      indent: Math.max(1, parseInt(cell(r, "INDENT"), 10) || 1),
      responsible: cell(r, "RESPONSIBLE"),
      date: cell(r, "DATE"),
      dateLang: cell(r, "DATE_LANG"),
      deadline: cell(r, "DEADLINE"),
      duration: parseFloat(cell(r, "DURATION")) || 0,
      durationUnit: cell(r, "DURATION_UNIT").toLowerCase(),
    };
  });
}

/** True when the priorities look like Todoist's API order (4 = p1). */
export function looksReversed(priorities: (number | null)[]): boolean {
  const ps = priorities.filter((p): p is number => p !== null);
  if (ps.length < 4) return false;
  const ones = ps.filter((p) => p === 1).length;
  const fours = ps.filter((p) => p === 4).length;
  return ones / ps.length > 0.5 && fours < ones;
}

const PRIORITY: Record<number, Priority | undefined> = { 1: "high", 2: "medium", 3: "low", 4: undefined };

interface ProjectResult {
  tasks: ImportTask[];
  flags: { assignees: boolean; deepNesting: boolean; subtaskDetails: boolean; reversed: boolean; foreignDates: boolean };
}

/** One project's CSV → tasks in the list `project`. */
export function parseTodoistProject(text: string, project: string, now = new Date()): ProjectResult {
  const raws = readRows(text);
  const flags = { assignees: false, deepNesting: false, subtaskDetails: false, reversed: false, foreignDates: false };
  flags.reversed = looksReversed(raws.filter((r) => r.type === "task").map((r) => r.priority));
  const prio = (p: number | null): Priority | undefined => (p === null ? undefined : PRIORITY[flags.reversed ? 5 - p : p]);
  const tasks: ImportTask[] = [];
  let section = "";
  let top: ImportTask | null = null;
  for (const r of raws) {
    if (r.type === "section") {
      section = r.content.trim();
      top = null;
      continue;
    }
    if (r.type === "note") {
      if (top && r.content.trim()) (top.notes ??= []).push(`💬 ${r.content.trim()}`);
      continue;
    }
    if (r.type !== "task" || !r.content.trim()) continue;
    if (r.responsible) flags.assignees = true;
    if (r.dateLang && !/^en/i.test(r.dateLang) && r.date) flags.foreignDates = true;
    // "* Call Sam" is a task that can't be ticked off (a heading) in Todoist.
    const { title, labels } = splitLabels(r.content.replace(/^\*\s+/, ""));
    if (r.indent > 1 && top) {
      if (r.indent > 2) flags.deepNesting = true;
      if (r.date || r.description || (r.priority !== null && prio(r.priority))) flags.subtaskDetails = true;
      (top.subtasks ??= []).push({ title, completed: false });
      continue;
    }
    const t: ImportTask = { title, list: project, completed: false };
    const allLabels = [...labels, ...(section ? [section] : [])];
    if (allLabels.length) t.labels = allLabels;
    const p = prio(r.priority);
    if (p) t.priority = p;
    const d = parseDateText(r.date, now);
    if (d.dueDate) t.dueDate = d.dueDate;
    if (d.dueTime) t.dueTime = d.dueTime;
    if (d.repeat) t.repeat = d.repeat;
    if (d.unmappedRepeat) t.repeatNote = d.unmappedRepeat;
    if (d.unparsed) t.dateNote = d.unparsed;
    if (r.deadline) {
      const dl = parseDateText(r.deadline, now);
      if (!t.dueDate && !t.repeatNote && !t.dateNote && dl.dueDate && !dl.repeat) t.dueDate = dl.dueDate;
      else (t.notes ??= []).push(`⏳ Deadline: ${r.deadline}`);
    }
    if (r.duration > 0) t.estimateMin = r.durationUnit === "day" ? r.duration * 8 * 60 : r.duration;
    if (r.description.trim()) (t.notes ??= []).push(r.description.trim());
    tasks.push(t);
    top = t;
  }
  return { tasks, flags };
}

/** One or more Todoist project CSVs (a single export, or the files inside a backup .zip). */
export function parseTodoistFiles(files: { name: string; text: string }[], now = new Date()): ParsedImport {
  const tasks: ImportTask[] = [];
  const flags = { assignees: false, deepNesting: false, subtaskDetails: false, reversed: false, foreignDates: false };
  let read = 0;
  for (const f of files) {
    if (!isTodoistCsv(f.text)) continue;
    const r = parseTodoistProject(f.text, projectNameFromFile(f.name), now);
    read++;
    tasks.push(...r.tasks);
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) flags[k] ||= r.flags[k];
  }
  if (!read) throw new Error("This doesn't look like a Todoist export. Export a project as CSV, or use a backup .zip from Todoist's Settings → Backups.");
  const dropped = [
    "Completed tasks (Todoist's export only has open ones)",
    ...(flags.assignees ? ["Who a task is assigned to"] : []),
    ...(flags.subtaskDetails ? ["Dates, priorities and descriptions on subtasks"] : []),
    ...(flags.deepNesting ? ["Sub-subtasks become subtasks of the top task"] : []),
    "Reminders and attachments",
  ];
  const info = [
    "Projects become lists; sections become labels.",
    ...(flags.reversed ? ["Most tasks had priority 1, so this file uses Todoist's API order: 4 was read as the highest."] : []),
    ...(flags.foreignDates ? ["Some dates aren't in English; any that couldn't be read are kept as a note on the task."] : []),
  ];
  return { app: "todoist", tasks, dropped, info };
}

/** A Todoist backup .zip → one list per project. */
export async function parseTodoistZip(bytes: Uint8Array, now = new Date()): Promise<ParsedImport> {
  const entries = await readZip(bytes, (n) => /\.csv$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n));
  const dec = new TextDecoder();
  return parseTodoistFiles(entries.map((e) => ({ name: e.name, text: dec.decode(e.bytes) })), now);
}
