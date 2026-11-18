// Repeating to-dos. Completing a repeating task keeps a completed copy (so the
// weekly review and tomorrow's brief still see it was done) and moves the task
// itself to its next date, with its subtasks unticked again.

import { generateId, getDayKey } from "./utils";
import type { Repeat, Todo } from "../types";

const DAY = 86_400_000;
const at = (key: string) => new Date(`${key}T12:00:00`);
const key = (d: Date) => getDayKey(d);
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday-based week number since 1970, to count "every 2 weeks". */
const weekIndex = (d: Date) => Math.floor((Math.round(at(key(d)).getTime() / DAY) + 3) / 7);

/** The first date after `from` (YYYY-MM-DD) on which the task repeats. */
export function nextOccurrence(from: string, repeat: Repeat): string {
  const every = Math.max(1, Math.floor(repeat.every || 1));
  const d = at(from);
  switch (repeat.unit) {
    case "day":
      return key(new Date(d.getTime() + every * DAY));
    case "week": {
      const days = (repeat.weekdays ?? []).filter((x) => x >= 0 && x <= 6);
      if (!days.length) return key(new Date(d.getTime() + every * 7 * DAY));
      const startWeek = weekIndex(d);
      for (let i = 1; i <= 7 * every + 7; i++) {
        const c = new Date(d.getTime() + i * DAY);
        if (days.includes(c.getDay()) && (weekIndex(c) - startWeek) % every === 0) return key(c);
      }
      return key(new Date(d.getTime() + 7 * DAY));
    }
    case "month": {
      const day = repeat.monthDay ?? d.getDate();
      const m = d.getMonth() + every;
      const y = d.getFullYear() + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      return key(new Date(y, mm, Math.min(day, daysInMonth(y, mm)), 12));
    }
    case "year": {
      const day = repeat.monthDay ?? d.getDate();
      const y = d.getFullYear() + every;
      return key(new Date(y, d.getMonth(), Math.min(day, daysInMonth(y, d.getMonth())), 12));
    }
  }
}

/** Next due date after completing: after the current due date, and not in the past. */
export function nextDue(todo: Pick<Todo, "dueDate" | "repeat">, today = getDayKey()): string | undefined {
  if (!todo.repeat) return undefined;
  let d = nextOccurrence(todo.dueDate ?? today, todo.repeat);
  for (let i = 0; d < today && i < 2000; i++) d = nextOccurrence(d, todo.repeat);
  return d;
}

/** The first date on or after `today` that matches the rule (for a new repeating task with no date). */
export function firstOccurrence(repeat: Repeat, today = getDayKey()): string {
  if (repeat.unit === "week" && repeat.weekdays?.length && !repeat.weekdays.includes(at(today).getDay())) {
    return nextOccurrence(today, { ...repeat, every: 1 });
  }
  return today;
}

export function repeatLabel(r: Repeat): string {
  const n = Math.max(1, r.every || 1);
  const days = r.weekdays?.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (r.unit === "week" && days?.length) {
    const list = days.join(",") === "1,2,3,4,5" ? "weekdays" : days.map((x) => WEEKDAY_SHORT[x]).join(", ");
    return n === 1 ? `Every ${list}` : `Every ${n} weeks on ${list}`;
  }
  const unit = { day: "day", week: "week", month: "month", year: "year" }[r.unit];
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

/** Toggles a task done/undone. A repeating task, when completed, moves to its next date and leaves a done copy. */
export function toggleTodo(list: Todo[], id: string, now = new Date()): Todo[] {
  const t = list.find((x) => x.id === id);
  if (!t) return list;
  const stamp = now.toISOString();
  if (t.completed || !t.repeat) {
    return list.map((x) => (x.id === id ? { ...x, completed: !x.completed, completedAt: x.completed ? undefined : stamp, updatedAt: stamp } : x));
  }
  const today = getDayKey(now);
  const done: Todo = { ...t, id: generateId(), completed: true, completedAt: stamp, repeat: undefined, dueDate: t.dueDate ?? today, createdAt: stamp, updatedAt: stamp };
  const next: Todo = {
    ...t,
    dueDate: nextDue(t, today),
    plannedFor: undefined,
    block: undefined,
    subtasks: t.subtasks?.map((s) => ({ ...s, completed: false })),
    updatedAt: stamp,
  };
  const i = list.indexOf(t);
  return [...list.slice(0, i), next, done, ...list.slice(i + 1)];
}

/** When a task's reminder is due (ms), or null if it has no time. */
export function reminderAt(t: Pick<Todo, "dueDate" | "dueTime" | "completed">): number | null {
  if (t.completed || !t.dueDate || !t.dueTime || !/^\d{2}:\d{2}$/.test(t.dueTime)) return null;
  const [h, m] = t.dueTime.split(":").map(Number);
  const [y, mo, d] = t.dueDate.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
}

/** "3:00 PM" in the user's locale. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
