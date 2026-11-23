// TickTick: Settings → Account → Backup & Restore → Generate backup (CSV).
//
// The file starts with a few lines of its own ("Date: …", "Version: …", a
// multi-line "Status: 0 Normal / 1 Completed / 2 Archived" note) before the
// real header row. Columns we read: Folder Name, List Name, Title, Kind
// (TEXT / CHECKLIST / NOTE), Tags, Content, Is Check list, Start Date,
// Due Date, Repeat (an RRULE), Priority (0 none, 1 low, 3 medium, 5 high),
// Status (0 open, 1 completed, 2 completed and archived), Created Time,
// Completed Time, Timezone, Is All Day, taskId, parentId.
// Dates look like "2024-01-15T09:00:00+0000" and are shown in the task's own
// Timezone (an all-day task is stored as midnight there).
//
// Lists stay lists (folders are dropped), tags become labels, checklist items
// become subtasks, other Content becomes a note subtask, child tasks
// (parentId) become subtasks of their top task, and Kind NOTE (notes, not
// tasks) is skipped.

import { cell, findHeaderRow, parseCsv, rowsToObjects } from "./csv";
import { instantToLocal, rruleToRepeat } from "./dates";
import { flattenChildren, type ImportTask, type ParsedImport, type Priority } from "./core";

export function isTickTickCsv(text: string): boolean {
  return findHeaderRow(parseCsv(text.slice(0, 6000), ","), ["Title", "List Name"], 15) >= 0;
}

const PRIORITY: Record<string, Priority | undefined> = { "5": "high", "3": "medium", "1": "low" };
const yes = (s: string) => /^(y|yes|true|1)$/i.test(s.trim());
const OPEN_ITEM = /^\s*(?:▫|☐|□|◻|-\s\[\s\])\s*/;
const DONE_ITEM = /^\s*(?:▪|☑|✓|✔|■|◼|-\s\[[xX]\])\s*/;

/** Checklist Content → items; other lines → one note. */
export function splitChecklist(content: string): { items: { title: string; completed: boolean }[]; note: string } {
  const items: { title: string; completed: boolean }[] = [];
  const rest: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (DONE_ITEM.test(line)) items.push({ title: line.replace(DONE_ITEM, "").trim(), completed: true });
    else if (OPEN_ITEM.test(line)) items.push({ title: line.replace(OPEN_ITEM, "").trim(), completed: false });
    else if (line.trim()) rest.push(line.trim());
  }
  return { items: items.filter((i) => i.title), note: rest.join(" ") };
}

const isoOrUndefined = (s: string) => {
  if (!s) return undefined;
  const d = new Date(s.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export function parseTickTickCsv(text: string): ParsedImport {
  const rows = parseCsv(text, ",");
  const h = findHeaderRow(rows, ["Title", "List Name"], 15);
  if (h < 0) throw new Error("This doesn't look like a TickTick backup. In TickTick: Settings → Account → Backup & Restore → Generate backup.");
  const records = rowsToObjects(rows, h);
  let notesSkipped = 0;
  let folders = false;
  let reminders = false;
  let repeatEnds = false;
  type Row = ImportTask & { id: string; parent?: string };
  const items: Row[] = [];
  records.forEach((r, i) => {
    const title = cell(r, "Title").trim();
    const kind = cell(r, "Kind").toUpperCase();
    if (kind === "NOTE") {
      notesSkipped++;
      return;
    }
    if (!title) return;
    if (cell(r, "Folder Name")) folders = true;
    if (cell(r, "Reminder")) reminders = true;
    const status = cell(r, "Status");
    const t: Row = { id: cell(r, "taskId", "Task Id") || `row${i}`, parent: cell(r, "parentId", "Parent Id") || undefined, title, list: cell(r, "List Name") || undefined, completed: status === "1" || status === "2" };
    const sourceId = cell(r, "taskId", "Task Id");
    if (sourceId) t.sourceId = sourceId;
    const p = PRIORITY[cell(r, "Priority")];
    if (p) t.priority = p;
    const tz = cell(r, "Timezone") || undefined;
    const due = cell(r, "Due Date") || cell(r, "Start Date");
    if (due) {
      const local = instantToLocal(due, tz);
      if (local) {
        t.dueDate = local.date;
        const allDay = cell(r, "Is All Day") ? yes(cell(r, "Is All Day")) : local.time === "00:00";
        if (!allDay && local.time !== "00:00") t.dueTime = local.time;
      } else t.dateNote = due;
    }
    const rule = cell(r, "Repeat");
    if (rule) {
      const rep = rruleToRepeat(rule, t.dueDate);
      if (rep && !t.completed) t.repeat = rep;
      else if (!rep) t.repeatNote = rule.replace(/^RRULE:/i, "");
      if (/COUNT=|UNTIL=/i.test(rule) && rep) repeatEnds = true;
    }
    const tags = cell(r, "Tags")
      .split(/[,;]/)
      .map((x) => x.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (tags.length) t.labels = tags;
    const content = cell(r, "Content");
    if (content) {
      if (kind === "CHECKLIST" || yes(cell(r, "Is Check list"))) {
        const { items: list, note } = splitChecklist(content);
        if (list.length) t.subtasks = list;
        if (note) t.notes = [note];
      } else t.notes = [content.replace(/\s+/g, " ").trim()];
    }
    const created = isoOrUndefined(cell(r, "Created Time"));
    if (created) t.createdAt = created;
    const completed = isoOrUndefined(cell(r, "Completed Time"));
    if (completed && t.completed) t.completedAt = completed;
    items.push(t);
  });
  if (!items.length && !notesSkipped) throw new Error("No tasks found in this TickTick backup.");
  const { tops, childrenOf, deep } = flattenChildren(items);
  const tasks: ImportTask[] = tops.map(({ id, parent: _p, ...t }) => {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length) t.subtasks = [...(t.subtasks ?? []), ...kids.map((k) => ({ title: k.title, completed: k.completed }))];
    return t;
  });
  const dropped = [
    ...(notesSkipped ? [`${notesSkipped} note${notesSkipped === 1 ? "" : "s"} (TickTick notes aren't tasks)`] : []),
    ...(folders ? ["Folders (their lists are kept)"] : []),
    ...(reminders ? ["Reminders (ProdLi reminds at the task's time)"] : []),
    ...(repeatEnds ? ["When a repeat stops (end date or count)"] : []),
    ...(childrenOf.size ? ["Dates and priorities on subtasks"] : []),
    ...(deep ? ["Sub-subtasks become subtasks of the top task"] : []),
    "Kanban columns and attachments",
  ];
  return { app: "ticktick", tasks, dropped, info: ["Tags become labels; checklist items become subtasks."] };
}
