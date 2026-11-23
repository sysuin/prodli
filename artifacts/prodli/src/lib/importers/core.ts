// Import from other apps: the shape every parser produces, and turning it
// into ProdLi to-dos and lists. Pure (no storage); see ./apply.ts for saving
// and Undo.
//
// Re-importing the same file skips what's already here: each imported to-do
// remembers where it came from (`Todo.importedFrom`): the app plus the task's
// id in that app, or, when the export has no ids (Todoist CSV, Markdown,
// generic CSV), a stable hash of list + title + due date, numbered when the
// same task appears more than once.

import { generateId } from "../utils";
import { findList, isList, LIST_EMOJIS, normLabel, type TaskList } from "../taskLists";
import type { ListItem, Repeat, Subtask, Todo } from "../../types";

/** Opens the import window (App listens). */
export const IMPORT_TASKS_EVENT = "prodli-import-tasks";

export type ImportApp ="todoist" | "ticktick" | "google" | "csv" | "markdown";
export type Priority = "high" | "medium" | "low";

export const APP_NAMES: Record<ImportApp, string> = {
  todoist: "Todoist",
  ticktick: "TickTick",
  google: "Google Tasks",
  csv: "CSV file",
  markdown: "Markdown or text",
};

/** One task as read from another app's export. */
export interface ImportTask {
  /** The task's id in the other app, when the export has one. */
  sourceId?: string;
  title: string;
  /** List (project) name; none or "Inbox" = ProdLi's Inbox. */
  list?: string;
  completed: boolean;
  completedAt?: string;
  createdAt?: string;
  priority?: Priority;
  dueDate?: string;
  dueTime?: string;
  repeat?: Repeat;
  /** A repeat rule ProdLi can't express: kept on the task as a note subtask. */
  repeatNote?: string;
  /** A date that couldn't be read: kept as a note subtask. */
  dateNote?: string;
  estimateMin?: number;
  labels?: string[];
  /** Description, comments: become note subtasks ("📝 …"). */
  notes?: string[];
  subtasks?: { title: string; completed: boolean }[];
}

export interface ParsedImport {
  app: ImportApp;
  tasks: ImportTask[];
  /** Plain lines for the preview: what won't carry over. */
  dropped: string[];
  /** Other things worth saying in the preview. */
  info: string[];
}

/** Most tasks one import takes (storage stays small and fast). */
export const MAX_IMPORT = 5000;

/** cyrb53: a fast, well-spread 53-bit string hash (base 36). */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const isInbox = (name?: string) => !name || name.trim().toLowerCase() === "inbox";

/** The id stored in `importedFrom.id` for each task, in order. */
export function importIds(tasks: ImportTask[]): string[] {
  const seen = new Map<string, number>();
  return tasks.map((t) => {
    if (t.sourceId) return t.sourceId;
    const base = `h:${hashString(`${(t.list ?? "").trim().toLowerCase()}\u0000${t.title.trim().toLowerCase()}\u0000${t.dueDate ?? ""}`)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

const keyOf = (app: string, id: string) => `${app}\u0000${id}`;

export function importedKeys(todos: Todo[]): Set<string> {
  return new Set(todos.filter((t) => t.importedFrom).map((t) => keyOf(t.importedFrom!.app, t.importedFrom!.id)));
}

export interface ImportSummary {
  /** Tasks in the file. */
  total: number;
  /** Tasks that would be added with the current choices. */
  toAdd: number;
  lists: string[];
  repeating: number;
  done: number;
  /** Already imported before (skipped). */
  duplicates: number;
  /** Repeat rules kept as a note. */
  repeatNotes: number;
  dateNotes: number;
  subtasks: number;
}

export function summarize(parsed: ParsedImport, existing: Todo[], includeDone: boolean): ImportSummary {
  const ids = importIds(parsed.tasks);
  const have = importedKeys(existing);
  let duplicates = 0;
  let toAdd = 0;
  const lists = new Set<string>();
  for (let i = 0; i < parsed.tasks.length; i++) {
    const t = parsed.tasks[i];
    if (!isInbox(t.list)) lists.add(t.list!.trim());
    if (have.has(keyOf(parsed.app, ids[i]))) duplicates++;
    else if (includeDone || !t.completed) toAdd++;
  }
  return {
    total: parsed.tasks.length,
    toAdd: Math.min(toAdd, MAX_IMPORT),
    lists: [...lists],
    repeating: parsed.tasks.filter((t) => t.repeat).length,
    done: parsed.tasks.filter((t) => t.completed).length,
    duplicates,
    repeatNotes: parsed.tasks.filter((t) => t.repeatNote).length,
    dateNotes: parsed.tasks.filter((t) => t.dateNote).length,
    subtasks: parsed.tasks.reduce((n, t) => n + (t.subtasks?.length ?? 0), 0),
  };
}

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const validIso = (s?: string) => !!s && !Number.isNaN(new Date(s).getTime());

export interface BuiltImport {
  todos: Todo[];
  newLists: TaskList[];
  skipped: number;
}

/** Turns parsed tasks into to-dos and the lists they need (existing lists with the same name are reused). */
export function buildImport(parsed: ParsedImport, opts: { includeDone: boolean; existingTodos: Todo[]; existingLists: ListItem[]; now?: Date }): BuiltImport {
  const now = (opts.now ?? new Date()).toISOString();
  const ids = importIds(parsed.tasks);
  const have = importedKeys(opts.existingTodos);
  const lists = [...opts.existingLists];
  const newLists: TaskList[] = [];
  const listId = (name?: string): string | undefined => {
    if (isInbox(name)) return undefined;
    const found = findList(lists, name!);
    if (found) return found.id;
    const l: TaskList = { id: generateId(), kind: "list", name: clip(name!, 60), emoji: LIST_EMOJIS[lists.filter(isList).length % LIST_EMOJIS.length], createdAt: now, updatedAt: now };
    lists.push(l);
    newLists.push(l);
    return l.id;
  };
  const todos: Todo[] = [];
  let skipped = 0;
  parsed.tasks.forEach((t, i) => {
    if (have.has(keyOf(parsed.app, ids[i]))) {
      skipped++;
      return;
    }
    if (t.completed && !opts.includeDone) return;
    if (todos.length >= MAX_IMPORT) return;
    const title = clip(t.title, 300);
    if (!title) return;
    const sub = (s: string, completed = false): Subtask => ({ id: generateId(), title: clip(s, 500), completed });
    const subtasks: Subtask[] = [
      ...(t.subtasks ?? []).filter((s) => s.title.trim()).map((s) => sub(s.title, s.completed)),
      ...(t.repeatNote ? [sub(`🔁 Repeats: ${t.repeatNote}`)] : []),
      ...(t.dateNote ? [sub(`📅 Due: ${t.dateNote}`)] : []),
      ...(t.notes ?? []).filter((n) => n.trim()).map((n) => sub(`📝 ${n}`)),
    ];
    const todo: Todo = {
      id: generateId(),
      title,
      completed: t.completed,
      subtasks,
      createdAt: validIso(t.createdAt) ? new Date(t.createdAt!).toISOString() : now,
      updatedAt: now,
      importedFrom: { app: parsed.app, id: ids[i] },
    };
    if (t.priority) todo.priority = t.priority;
    if (t.dueDate) todo.dueDate = t.dueDate;
    if (t.dueDate && t.dueTime) todo.dueTime = t.dueTime;
    if (t.repeat && !t.completed) todo.repeat = t.repeat;
    if (t.estimateMin && t.estimateMin > 0) todo.estimateMin = Math.round(t.estimateMin);
    if (t.completed) todo.completedAt = validIso(t.completedAt) ? new Date(t.completedAt!).toISOString() : now;
    const labels = [...new Set((t.labels ?? []).map(normLabel).filter(Boolean))];
    if (labels.length) todo.labels = labels;
    const lid = listId(t.list);
    if (lid) todo.listId = lid;
    todos.push(todo);
  });
  return { todos, newLists, skipped };
}

/** "Buy milk @errands @home" → title "Buy milk", labels ["errands", "home"]. */
export function splitLabels(text: string): { title: string; labels: string[] } {
  const labels: string[] = [];
  const title = text
    .replace(/(^|\s)@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/gu, (_m, pre: string, l: string) => {
      labels.push(l.replace(/[.-]+$/, ""));
      return pre;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title: title || text.trim(), labels };
}

/** Attaches child tasks to their top-most ancestor as subtasks (ProdLi has one level). */
export function flattenChildren<T extends { id: string; parent?: string; title: string; completed: boolean }>(items: T[]): { tops: T[]; childrenOf: Map<string, T[]>; deep: number } {
  const byId = new Map(items.map((x) => [x.id, x]));
  const topOf = (x: T): T => {
    let cur = x;
    for (let i = 0; i < 50 && cur.parent && byId.has(cur.parent); i++) cur = byId.get(cur.parent)!;
    return cur;
  };
  const tops: T[] = [];
  const childrenOf = new Map<string, T[]>();
  let deep = 0;
  for (const x of items) {
    const top = topOf(x);
    if (top === x) {
      tops.push(x);
      continue;
    }
    if (x.parent !== top.id) deep++;
    childrenOf.set(top.id, [...(childrenOf.get(top.id) ?? []), x]);
  }
  return { tops, childrenOf, deep };
}
