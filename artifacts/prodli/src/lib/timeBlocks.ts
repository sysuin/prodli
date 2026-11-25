// Time-blocking: put today's planned tasks into the free time between calendar
// events, inside working hours. A block is stored on the to-do itself
// (Todo.block = { day, start }), so it syncs and disappears with the task.
//
// No calendar write access is needed: "Add to Google Calendar" opens Google's
// own prefilled event page, where the user clicks Save.

import type { CalendarEvent } from "./calendarEvent";
import type { Todo } from "../types";

export const DEFAULT_BLOCK_MIN = 30;
/** Breathing room after a meeting or block before the next one starts. */
export const BUFFER_MIN = 5;

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const toHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const roundUp = (m: number, step = 5) => Math.ceil(m / step) * step;

export interface Slot {
  start: number;
  end: number;
}

export const blockMinutes = (t: Pick<Todo, "estimateMin">) => t.estimateMin ?? DEFAULT_BLOCK_MIN;

/** Today's block of a task, if it has one (blocks from other days are ignored). */
export function blockOf(t: Todo, day: string): Slot | null {
  if (!t.block || t.block.day !== day || t.completed) return null;
  const start = toMin(t.block.start);
  return { start, end: start + blockMinutes(t) };
}

/** Busy time today: timed calendar events plus tasks already blocked (except `skip`). */
export function busy(events: CalendarEvent[], todos: Todo[], day: string, skip: Set<string> = new Set()): Slot[] {
  const fromEvents = events.filter((e) => !e.allDay && e.start && e.end).map((e) => ({ start: toMin(e.start!), end: Math.max(toMin(e.end!), toMin(e.start!) + 5) }));
  const fromBlocks = todos.filter((t) => !skip.has(t.id)).map((t) => blockOf(t, day)).filter((s): s is Slot => !!s);
  return [...fromEvents, ...fromBlocks].sort((a, b) => a.start - b.start);
}

/** Free time between `from` and `to`, around busy slots (with a buffer after each). */
export function freeSlots(busySlots: Slot[], from: number, to: number): Slot[] {
  const out: Slot[] = [];
  let cursor = roundUp(from);
  for (const b of busySlots) {
    if (b.end + BUFFER_MIN <= cursor) continue;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, roundUp(b.end + BUFFER_MIN));
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out.filter((s) => s.end - s.start >= 10);
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** The order tasks get the earliest time: overdue, then due today, then by priority. */
export function blockOrder(tasks: Todo[], day: string): Todo[] {
  const score = (t: Todo) => (t.dueDate && t.dueDate < day ? 0 : t.dueDate === day ? 1 : 2) * 10 + (t.priority ? RANK[t.priority] : 3);
  return [...tasks].sort((a, b) => score(a) - score(b));
}

export interface Plan {
  /** task id → start "HH:MM" */
  placed: Record<string, string>;
  /** Tasks that don't fit in today's free time. */
  unplaced: string[];
}

/**
 * Pure: places each unblocked task (in order) into the first free slot long enough for it.
 * Tasks already blocked keep their time. Planning starts now (or at the start of the
 * working day, if later) and ends with the working day.
 */
export function autoSchedule(input: { tasks: Todo[]; todos: Todo[]; events: CalendarEvent[]; day: string; workStart: string; workEnd: string; nowMin: number }): Plan {
  const { day } = input;
  const from = Math.max(toMin(input.workStart), input.nowMin);
  const to = toMin(input.workEnd);
  const taken = busy(input.events, input.todos, day);
  const placed: Record<string, string> = {};
  const unplaced: string[] = [];
  for (const t of blockOrder(input.tasks.filter((x) => !x.completed && !blockOf(x, day)), day)) {
    const need = blockMinutes(t);
    const slot = freeSlots(taken, from, to).find((s) => s.end - s.start >= need);
    if (!slot) {
      unplaced.push(t.id);
      continue;
    }
    placed[t.id] = toHM(slot.start);
    taken.push({ start: slot.start, end: slot.start + need });
    taken.sort((a, b) => a.start - b.start);
  }
  return { placed, unplaced };
}

/** Blocks that overlap a calendar event or another block. */
export function conflicts(todos: Todo[], events: CalendarEvent[], day: string): Set<string> {
  const out = new Set<string>();
  const blocked = todos.map((t) => ({ t, s: blockOf(t, day) })).filter((x): x is { t: Todo; s: Slot } => !!x.s);
  const ev = busy(events, [], day);
  for (const { t, s } of blocked) {
    if (ev.some((e) => s.start < e.end && e.start < s.end)) out.add(t.id);
    for (const o of blocked) if (o.t.id !== t.id && s.start < o.s.end && o.s.start < s.end) out.add(t.id);
  }
  return out;
}

export type AgendaItem =
  | { kind: "event"; start: number; end: number; event: CalendarEvent }
  | { kind: "block"; start: number; end: number; todo: Todo; conflict: boolean };

/** Today's timeline: calendar events and task blocks, in time order. */
export function agenda(events: CalendarEvent[], todos: Todo[], day: string): AgendaItem[] {
  const clash = conflicts(todos, events, day);
  const items: AgendaItem[] = [
    ...events.filter((e) => !e.allDay && e.start && e.end).map((e) => ({ kind: "event" as const, start: toMin(e.start!), end: toMin(e.end!), event: e })),
    ...todos.flatMap((t) => {
      const s = blockOf(t, day);
      return s ? [{ kind: "block" as const, ...s, todo: t, conflict: clash.has(t.id) }] : [];
    }),
  ];
  return items.sort((a, b) => a.start - b.start || (a.kind === "event" ? -1 : 1));
}

/** Google Calendar's own "new event" page, prefilled (no calendar permission needed). */
export function googleCalendarLink(title: string, day: string, start: string, minutes: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const stamp = (m: number) => {
    const d = new Date(`${day}T00:00:00`);
    d.setMinutes(m);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  };
  const s = toMin(start);
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(s)}/${stamp(s + minutes)}`, details: "Focus time planned in ProdLi", ctz: timeZone });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ── Day view (drag-to-timebox) ───────────────────────────────────────────────

/** Times on the day view snap to this many minutes. */
export const SNAP_MIN = 15;
export const MIN_BLOCK_MIN = 15;

export const snap = (m: number, step = SNAP_MIN) => Math.round(m / step) * step;

/** The hours the day view shows: the working day, stretched to fit events and blocks (whole hours). */
export function dayRange(items: Slot[], workStart: string, workEnd: string): Slot {
  let from = toMin(workStart);
  let to = Math.max(toMin(workEnd), from + 60);
  for (const s of items) {
    from = Math.min(from, s.start);
    to = Math.max(to, s.end);
  }
  return { start: Math.max(0, Math.floor(from / 60) * 60), end: Math.min(24 * 60, Math.ceil(to / 60) * 60) };
}

/** Keeps a block of `minutes` inside the range, snapped. */
export function clampStart(start: number, minutes: number, range: Slot): number {
  return Math.min(Math.max(snap(start), range.start), Math.max(range.start, range.end - minutes));
}

/** Side-by-side columns for overlapping items: each gets its column and how many share its cluster. */
export function columns<T extends Slot>(items: T[]): { item: T; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { item: T; col: number; cols: number }[] = [];
  let cluster: { item: T; col: number; cols: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = n;
    out.push(...cluster);
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const used = new Set(cluster.filter((c) => c.item.end > item.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ item, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}

/** The first free time today for one task (the keyboard "place" action), or null. */
export function nextFreeStart(task: Todo, todos: Todo[], events: CalendarEvent[], day: string, workStart: string, workEnd: string, nowMin: number): string | null {
  return autoSchedule({ tasks: [{ ...task, block: undefined }], todos: todos.filter((t) => t.id !== task.id), events, day, workStart, workEnd, nowMin }).placed[task.id] ?? null;
}
