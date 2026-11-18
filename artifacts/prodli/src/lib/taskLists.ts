// To-do lists (projects), labels and saved filters. Lists and filters are
// stored together in the synced "lists" collection; labels are just names on
// tasks, so the label list is whatever the tasks use.

import { generateId, getDayKey } from "./utils";
import { storageGet, storageSet } from "./storage";
import type { ListItem, TaskQuery, Todo } from "../types";

export type TaskList = Extract<ListItem, { kind: "list" }>;
export type SavedFilter = Extract<ListItem, { kind: "filter" }>;

export const isList = (x: ListItem): x is TaskList => x.kind === "list";
export const isFilter = (x: ListItem): x is SavedFilter => x.kind === "filter";

/** "Errands " → "errands": labels compare without case or surrounding space. */
export const normLabel = (s: string) => s.trim().replace(/^@/, "").replace(/\s+/g, "-").toLowerCase();

/** Labels in use, most used first. */
export function labelsInUse(todos: Todo[]): { name: string; open: number }[] {
  const counts = new Map<string, number>();
  for (const t of todos) for (const l of t.labels ?? []) counts.set(l, (counts.get(l) ?? 0) + (t.completed ? 0 : 1));
  return [...counts.entries()].map(([name, open]) => ({ name, open })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

export function findList(lists: ListItem[], name: string): TaskList | undefined {
  const n = name.trim().toLowerCase();
  return lists.filter(isList).find((l) => l.name.trim().toLowerCase() === n);
}

const addDays = (day: string, n: number) => getDayKey(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86_400_000));

/** Does a task match a query? (An empty query matches everything.) */
export function matchesQuery(t: Todo, q: TaskQuery, today = getDayKey()): boolean {
  if (q.list === "inbox" ? !!t.listId : q.list && t.listId !== q.list) return false;
  if (q.label && !(t.labels ?? []).includes(q.label)) return false;
  if (q.priority && t.priority !== q.priority) return false;
  if (q.status === "active" && t.completed) return false;
  if (q.status === "completed" && !t.completed) return false;
  if (q.due) {
    const due = t.dueDate;
    const planned = !!t.plannedFor && t.plannedFor <= today;
    if (q.due === "overdue" && !(due && due < today)) return false;
    if (q.due === "today" && !((due && due <= today) || planned)) return false;
    if (q.due === "week" && !(due && due <= addDays(today, 7))) return false;
    if (q.due === "none" && due) return false;
  }
  if (q.text) {
    const s = q.text.trim().toLowerCase();
    if (s && !t.title.toLowerCase().includes(s) && !(t.subtasks ?? []).some((x) => x.title.toLowerCase().includes(s))) return false;
  }
  return true;
}

/** A short description of a query, e.g. "Work · @errands · High · “invoice”". */
export function describeQuery(q: TaskQuery, lists: ListItem[]): string {
  const parts: string[] = [];
  if (q.list === "inbox") parts.push("Inbox");
  else if (q.list) parts.push(lists.find((l) => l.id === q.list)?.name ?? "A deleted list");
  if (q.label) parts.push(`@${q.label}`);
  if (q.due) parts.push({ overdue: "Overdue", today: "Due today", week: "Next 7 days", none: "No date" }[q.due]);
  if (q.priority) parts.push({ high: "High", medium: "Medium", low: "Low" }[q.priority]);
  if (q.status) parts.push(q.status === "active" ? "Open" : "Done");
  if (q.text) parts.push(`“${q.text}”`);
  return parts.join(" · ") || "All tasks";
}

export const LIST_EMOJIS = ["📁", "💼", "🏠", "🛒", "📚", "💡", "🏃", "✈️", "💰", "🎯", "🧑‍💻", "❤️"];

/** Finds a list by name in storage, or creates it (quick add from anywhere: "#Work"). Returns its id. */
export async function ensureListStored(name: string): Promise<string> {
  const lists = await storageGet<ListItem[]>("lists", []);
  const existing = findList(lists, name);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const id = generateId();
  const emoji = LIST_EMOJIS[lists.filter(isList).length % LIST_EMOJIS.length];
  await storageSet("lists", [...lists, { id, kind: "list", name: name.trim().slice(0, 60), emoji, createdAt: now, updatedAt: now }]);
  return id;
}
