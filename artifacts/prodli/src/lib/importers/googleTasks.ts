// Google Tasks from Google Takeout (takeout.google.com → Tasks): Tasks.json,
// or the Takeout .zip that contains it.
//
// { items: [ { title: "My Tasks", items: [ { id, title, notes, status:
// "needsAction" | "completed", due: "2024-01-15T00:00:00.000Z", completed,
// parent, deleted, hidden, links, … } ] } ] }
//
// Each task list becomes a list, notes become a note subtask, tasks with a
// parent become subtasks of their top task. Google stores due dates as a day
// (midnight UTC; the time isn't exported), so only the day part is used.
// Repeat rules aren't in Takeout.

import { flattenChildren, type ImportTask, type ParsedImport } from "./core";
import { readZip } from "../zip";

interface GTask {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  created?: string;
  updated?: string;
  parent?: string;
  deleted?: boolean;
  links?: unknown[];
}

export function isGoogleTasksJson(text: string): boolean {
  try {
    const j = JSON.parse(text) as { kind?: string; items?: { kind?: string; items?: unknown }[] };
    return j.kind === "tasks#taskLists" || (Array.isArray(j.items) && j.items.some((l) => l && (l.kind === "tasks#taskList" || Array.isArray(l.items))));
  } catch {
    return false;
  }
}

export function parseGoogleTasksJson(text: string): ParsedImport {
  let root: { items?: { title?: string; items?: GTask[] }[] };
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON. Use Tasks.json from your Google Takeout download.");
  }
  if (!isGoogleTasksJson(text)) throw new Error("This doesn't look like Google Tasks from Takeout (Tasks.json).");
  const tasks: ImportTask[] = [];
  let links = false;
  let deep = 0;
  let withChildren = false;
  for (const list of root.items ?? []) {
    const listName = (list.title ?? "").trim() || "Google Tasks";
    type Row = ImportTask & { id: string; parent?: string };
    const rows: Row[] = [];
    (list.items ?? []).forEach((g, i) => {
      if (!g || g.deleted || !(g.title ?? "").trim()) return;
      if (g.links?.length) links = true;
      const t: Row = { id: g.id ?? `row${i}`, parent: g.parent || undefined, title: g.title!.trim(), list: listName, completed: g.status === "completed" };
      if (g.id) t.sourceId = g.id;
      if (g.due && /^\d{4}-\d{2}-\d{2}/.test(g.due)) t.dueDate = g.due.slice(0, 10);
      if (g.notes?.trim()) t.notes = [g.notes.trim()];
      if (t.completed && g.completed) t.completedAt = g.completed;
      const created = g.created ?? g.updated;
      if (created) t.createdAt = created;
      rows.push(t);
    });
    const flat = flattenChildren(rows);
    deep += flat.deep;
    for (const { id, parent: _p, ...t } of flat.tops) {
      const kids = flat.childrenOf.get(id) ?? [];
      if (kids.length) {
        withChildren = true;
        t.subtasks = kids.map((k) => ({ title: k.title, completed: k.completed }));
      }
      tasks.push(t);
    }
  }
  const dropped = [
    ...(withChildren ? ["Dates and notes on subtasks"] : []),
    ...(deep ? ["Sub-subtasks become subtasks of the top task"] : []),
    ...(links ? ["Links to Gmail or Docs"] : []),
    "Due times and repeat rules (Takeout doesn't include them)",
  ];
  return { app: "google", tasks, dropped, info: ["Each task list becomes a list."] };
}

/** A Takeout .zip: finds Tasks.json inside. */
export async function parseGoogleTasksZip(bytes: Uint8Array): Promise<ParsedImport> {
  const entries = await readZip(bytes, (n) => /(^|\/)Tasks\.json$/i.test(n) || /(^|\/)Tasks\/[^/]+\.json$/i.test(n));
  const dec = new TextDecoder();
  const hit = entries.map((e) => dec.decode(e.bytes)).find(isGoogleTasksJson);
  if (!hit) throw new Error("No Tasks.json in this .zip. In Google Takeout, choose Tasks.");
  return parseGoogleTasksJson(hit);
}
