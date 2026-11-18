// Habit rules shared by the Habits page, Today, the daily brief and the weekly
// review. Plain habits are done or not (`completedDays`). Count and timed
// habits log an amount per day and count as done at their target. Quit habits
// log slips: a day is kept while slips stay at or under the limit.
// Habits on chosen weekdays, and skipped days, never break a streak.

import { getDayKey } from "./utils";
import type { Habit } from "../types";

export type HabitKind = NonNullable<Habit["kind"]>;
export const kindOf = (h: Habit): HabitKind => h.kind ?? "check";

const at = (day: string) => new Date(`${day}T12:00:00`);
const shift = (day: string, n: number) => getDayKey(new Date(at(day).getTime() + n * 86_400_000));
const createdDay = (h: Habit) => (h.createdAt && !Number.isNaN(Date.parse(h.createdAt)) ? getDayKey(h.createdAt) : "0000-00-00");

/** Is the habit expected on this day? (chosen weekdays, not skipped, not before it existed) */
export function isScheduled(h: Habit, day: string): boolean {
  if (day < createdDay(h)) return false;
  if (h.skipped?.includes(day)) return false;
  return !h.days?.length || h.days.includes(at(day).getDay());
}

export const amountOn = (h: Habit, day: string) => h.log?.[day] ?? 0;
export const targetOf = (h: Habit) => (kindOf(h) === "quit" ? Math.max(0, h.target ?? 0) : Math.max(1, h.target ?? 1));

/** Was the habit done (or, for quit habits, kept) on this day? */
export function isDone(h: Habit, day: string): boolean {
  const k = kindOf(h);
  if (k === "quit") return day >= createdDay(h) && amountOn(h, day) <= targetOf(h);
  if (k === "check") return h.completedDays.includes(day);
  return amountOn(h, day) >= targetOf(h) || h.completedDays.includes(day);
}

/**
 * Current streak in scheduled days. Today only counts once it's done (a quit
 * habit's today counts while it's still kept), and an unfinished today doesn't
 * break the streak.
 */
export function currentStreak(h: Habit, today = getDayKey()): number {
  let n = 0;
  let day = today;
  if (!isDone(h, today)) day = shift(today, -1);
  for (let i = 0; i < 3660; i++, day = shift(day, -1)) {
    if (day < createdDay(h)) break;
    if (!isScheduled(h, day)) continue;
    if (!isDone(h, day)) break;
    n++;
  }
  return n;
}

/** Longest streak in scheduled days, up to today. */
export function bestStreak(h: Habit, today = getDayKey()): number {
  const start = kindOf(h) === "quit" ? createdDay(h) : [...h.completedDays, ...Object.keys(h.log ?? {})].sort()[0];
  if (!start) return 0;
  let best = 0;
  let run = 0;
  for (let day = start, i = 0; day <= today && i < 3660; day = shift(day, 1), i++) {
    if (!isScheduled(h, day)) continue;
    if (isDone(h, day)) best = Math.max(best, ++run);
    else if (day !== today) run = 0;
  }
  return best;
}

/** Sets the amount for a day (count, timed, quit), keeping `completedDays` in step for count/timed. */
export function setAmount(h: Habit, day: string, amount: number): Habit {
  const value = Math.max(0, Math.round(amount));
  const log = { ...(h.log ?? {}) };
  if (value) log[day] = value;
  else delete log[day];
  const k = kindOf(h);
  if (k === "quit") return { ...h, log };
  const done = value >= targetOf(h);
  const days = h.completedDays.filter((d) => d !== day);
  return { ...h, log, completedDays: done ? [...days, day] : days };
}

export const addAmount = (h: Habit, day: string, delta: number) => setAmount(h, day, amountOn(h, day) + delta);

export function toggleCheck(h: Habit, day: string): Habit {
  return { ...h, completedDays: h.completedDays.includes(day) ? h.completedDays.filter((d) => d !== day) : [...h.completedDays, day] };
}

export function toggleSkip(h: Habit, day: string): Habit {
  const skipped = h.skipped ?? [];
  return { ...h, skipped: skipped.includes(day) ? skipped.filter((d) => d !== day) : [...skipped, day] };
}

/** "3/8 glasses", "15/20 min", "1 of max 2", "✓" */
export function progressLabel(h: Habit, day: string): string {
  const k = kindOf(h);
  const a = amountOn(h, day);
  if (k === "count") return `${a}/${targetOf(h)}${h.unit ? ` ${h.unit}` : ""}`;
  if (k === "timed") return `${a}/${targetOf(h)} min`;
  if (k === "quit") return targetOf(h) === 0 ? (a ? `${a} slip${a > 1 ? "s" : ""}` : "clean") : `${a} of max ${targetOf(h)}`;
  return isDone(h, day) ? "done" : "not yet";
}

/** Share of the target reached on a day, 0–1 (quit habits: 1 when kept). For heatmaps. */
export function dayLevel(h: Habit, day: string): number {
  const k = kindOf(h);
  if (k === "check") return isDone(h, day) ? 1 : 0;
  if (k === "quit") return isDone(h, day) ? 1 : 0;
  return Math.min(1, amountOn(h, day) / targetOf(h));
}
