// Reading and changing the synced lists. Every change goes through setList(),
// which stamps `updatedAt` on whatever changed (sync's "newest edit wins" needs
// it) and records deletions as tombstones (so other devices delete too).
import { useMemo } from "react";
import { generateId, getDayKey, parseTask, toggleTodo, type DayRecord, type Habit, type ListItem, type Note, type ReadLaterItem, type Todo } from "../shared";
import { read, useStored, write } from "./store";
import { recordDeletions, type TombCollection } from "./tombstones";
import { stable } from "../shared";

type Item = { id: string; updatedAt?: string; createdAt?: string };

/** Pure: stamps items that changed between `prev` and `next`; returns the ids that disappeared. */
export function stampChanges<T extends Item>(prev: T[], next: T[], now = new Date().toISOString()): { items: T[]; removed: string[] } {
  const before = new Map(prev.map((i) => [i.id, i]));
  const items = next.map((i) => {
    const old = before.get(i.id);
    if (!old) return i.updatedAt ? i : { ...i, updatedAt: now };
    if (i.updatedAt && i.updatedAt !== old.updatedAt) return i; // already stamped by the caller
    return stable({ ...old, updatedAt: undefined }) === stable({ ...i, updatedAt: undefined }) ? i : { ...i, updatedAt: now };
  });
  const ids = new Set(next.map((i) => i.id));
  return { items, removed: prev.filter((i) => !ids.has(i.id)).map((i) => i.id) };
}

export function setList<T extends Item>(key: TombCollection, fn: (items: T[]) => T[]): T[] {
  const prev = read<T[]>(key, []);
  const { items, removed } = stampChanges(prev, fn(prev));
  write(key, items);
  if (removed.length) recordDeletions(key, removed);
  return items;
}

export const useList = <T,>(key: string): T[] => useStored<T[]>(key, []);

// ── To-dos ───────────────────────────────────────────────────────────────────

export function addTodoFromText(text: string, opts: { listId?: string; planToday?: boolean } = {}): Todo | null {
  if (!text.trim()) return null;
  const p = parseTask(text);
  const today = getDayKey();
  let listId = opts.listId;
  if (p.listName) listId = findOrCreateList(p.listName);
  const todo: Todo = {
    id: generateId(),
    title: p.title,
    completed: false,
    ...(p.priority ? { priority: p.priority } : {}),
    ...(p.dueDate || p.dueTime ? { dueDate: p.dueDate ?? today } : {}),
    ...(p.dueTime ? { dueTime: p.dueTime } : {}),
    ...(p.planToday || opts.planToday ? { plannedFor: today } : {}),
    ...(p.repeat ? { repeat: p.repeat } : {}),
    ...(p.labels?.length ? { labels: p.labels } : {}),
    ...(listId ? { listId } : {}),
    subtasks: [],
    createdAt: new Date().toISOString(),
  };
  setList<Todo>("todos", (all) => [todo, ...all]);
  return todo;
}

export const toggleTodoDone = (id: string) => setList<Todo>("todos", (all) => toggleTodo(all, id));
export const updateTodo = (id: string, patch: Partial<Todo>) => setList<Todo>("todos", (all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
export const deleteTodo = (id: string) => setList<Todo>("todos", (all) => all.filter((t) => t.id !== id));
export const clearCompletedTodos = () => setList<Todo>("todos", (all) => all.filter((t) => !t.completed));

export function togglePlanToday(id: string) {
  const today = getDayKey();
  setList<Todo>("todos", (all) => all.map((t) => (t.id === id ? { ...t, plannedFor: t.plannedFor && t.plannedFor <= today ? undefined : today } : t)));
}

export function toggleSubtask(todoId: string, subId: string) {
  setList<Todo>("todos", (all) => all.map((t) => (t.id === todoId ? { ...t, subtasks: (t.subtasks ?? []).map((s) => (s.id === subId ? { ...s, completed: !s.completed } : s)) } : t)));
}

export function addSubtask(todoId: string, title: string) {
  if (!title.trim()) return;
  setList<Todo>("todos", (all) => all.map((t) => (t.id === todoId ? { ...t, subtasks: [...(t.subtasks ?? []), { id: generateId(), title: title.trim(), completed: false }] } : t)));
}

export function removeSubtask(todoId: string, subId: string) {
  setList<Todo>("todos", (all) => all.map((t) => (t.id === todoId ? { ...t, subtasks: (t.subtasks ?? []).filter((s) => s.id !== subId) } : t)));
}

export type TodoView = "today" | "upcoming" | "all" | "done" | `list:${string}`;

/** Pure: which to-dos a view shows, in display order. */
export function todosFor(all: Todo[], view: TodoView, today = getDayKey()): Todo[] {
  const open = all.filter((t) => !t.completed);
  const byDue = (a: Todo, b: Todo) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || prio(a) - prio(b);
  if (view === "today") return open.filter((t) => (t.dueDate && t.dueDate <= today) || (t.plannedFor && t.plannedFor <= today)).sort(byDue);
  if (view === "upcoming") return open.filter((t) => t.dueDate && t.dueDate > today).sort(byDue);
  if (view === "done") return all.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  if (view.startsWith("list:")) {
    const id = view.slice(5);
    return open.filter((t) => (id === "inbox" ? !t.listId : t.listId === id));
  }
  return open;
}
const prio = (t: Todo) => (t.priority === "high" ? 0 : t.priority === "medium" ? 1 : t.priority === "low" ? 2 : 3);

export function findOrCreateList(name: string): string {
  const lists = read<ListItem[]>("lists", []);
  const found = lists.find((l) => l.kind === "list" && l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const id = generateId();
  setList<ListItem>("lists", (all) => [...all, { id, kind: "list", name: name.slice(0, 60), createdAt: new Date().toISOString() }]);
  return id;
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function newNote(partial: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  const note: Note = { id: generateId(), title: "Untitled", content: "", createdAt: now, updatedAt: now, autoTitle: true, ...partial };
  setList<Note>("notes", (all) => [note, ...all]);
  return note;
}

export const saveNote = (id: string, patch: Partial<Note>) => setList<Note>("notes", (all) => all.map((n) => (n.id === id ? { ...n, ...patch } : n)));
export const deleteNote = (id: string) => setList<Note>("notes", (all) => all.filter((n) => n.id !== id));
export const togglePin = (id: string) => setList<Note>("notes", (all) => all.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));

/** The notes list: templates hidden, pinned first, then most recently edited. */
export function useNotes(): Note[] {
  const all = useList<Note>("notes");
  return useMemo(() => all.filter((n) => !n.template).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")), [all]);
}

// ── Habits ───────────────────────────────────────────────────────────────────

export const HABIT_COLORS = ["#FFD700", "#00BCD4", "#FF6B6B", "#66BB6A", "#A78BFA", "#FF9800"];

export function addHabit(h: Pick<Habit, "name" | "emoji"> & Partial<Habit>): Habit {
  const habit: Habit = { id: generateId(), color: HABIT_COLORS[read<Habit[]>("habits", []).length % HABIT_COLORS.length], completedDays: [], createdAt: new Date().toISOString(), archived: false, ...h };
  setList<Habit>("habits", (all) => [...all, habit]);
  return habit;
}

export const replaceHabit = (h: Habit) => setList<Habit>("habits", (all) => all.map((x) => (x.id === h.id ? h : x)));
export const deleteHabit = (id: string) => setList<Habit>("habits", (all) => all.filter((h) => h.id !== id));

// ── Days (focus, reflection, brief) ──────────────────────────────────────────

export function useDay(day: string): DayRecord | undefined {
  const days = useList<DayRecord>("days");
  return useMemo(() => days.find((d) => d.id === day), [days, day]);
}

export function updateDay(day: string, patch: Partial<DayRecord>) {
  setList<DayRecord>("days", (all) => {
    const found = all.some((d) => d.id === day);
    return found ? all.map((d) => (d.id === day ? { ...d, ...patch } : d)) : [{ id: day, createdAt: new Date().toISOString(), ...patch }, ...all];
  });
}

// ── Pomodoro (history and counter sync; the running timer stays on the phone) ─

export interface PomodoroSession {
  id: string;
  label: string;
  completedAt: string;
  duration: number;
}

export function recordPomodoro(label: string, minutes: number, at = new Date()) {
  const s: PomodoroSession = { id: generateId(), label, completedAt: at.toISOString(), duration: minutes };
  write("pomodoroSessions", [s, ...read<PomodoroSession[]>("pomodoroSessions", [])].slice(0, 20));
  write("completedPomodoros", read<number>("completedPomodoros", 0) + 1);
}

// ── Read later (pages saved from the extension or added here) ───────────────

/** Pure: a web address from what the user typed or pasted, or null. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function addReadLater(url: string, title?: string): ReadLaterItem | null {
  const u = normalizeUrl(url);
  if (!u) return null;
  const existing = read<ReadLaterItem[]>("readLater", []).find((i) => i.url === u && !i.readAt);
  if (existing) return existing;
  const item: ReadLaterItem = { id: generateId(), url: u, title: title?.trim() || new URL(u).hostname.replace(/^www\./, ""), createdAt: new Date().toISOString() };
  setList<ReadLaterItem>("readLater", (all) => [item, ...all]);
  return item;
}

export const markRead = (id: string, read = true) => setList<ReadLaterItem>("readLater", (all) => all.map((i) => (i.id === id ? { ...i, readAt: read ? new Date().toISOString() : undefined } : i)));
export const deleteReadLater = (id: string) => setList<ReadLaterItem>("readLater", (all) => all.filter((i) => i.id !== id));

// ── Lists ────────────────────────────────────────────────────────────────────

export function renameList(id: string, name: string) {
  const n = name.trim().slice(0, 60);
  if (n) setList<ListItem>("lists", (all) => all.map((l) => (l.id === id ? { ...l, name: n } : l)));
}

/** Deletes the list; its to-dos move to the Inbox (as in the extension). */
export function deleteList(id: string) {
  setList<Todo>("todos", (all) => all.map((t) => (t.listId === id ? { ...t, listId: undefined } : t)));
  setList<ListItem>("lists", (all) => all.filter((l) => l.id !== id));
}
