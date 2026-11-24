// Habit rules shared by the Habits page, Today, the daily brief and the weekly
// review. Plain habits are done or not (`completedDays`). Count and timed
// habits log an amount per day and count as done at their target. Quit habits
// log slips: a day is kept while slips stay at or under the limit.
// Habits on chosen weekdays, skipped days and days covered by a streak freeze
// never break a streak. Freezes are earned every 7 days of streak (at most 2
// in hand) and used up automatically for missed days (settleFreezes).

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
  if (h.skipped?.includes(day) || h.frozen?.includes(day)) return false;
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

// ── Streak freezes and milestones ────────────────────────────────────────────

/** A streak freeze is earned every this many days of streak. */
export const FREEZE_EVERY = 7;
/** Most freezes a habit can hold. */
export const MAX_FREEZES = 2;
/** Streak lengths worth celebrating. */
export const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365, 500, 730, 1000];

export const freezesOf = (h: Habit) => Math.max(0, Math.min(MAX_FREEZES, h.freezes ?? 0));

/**
 * Uses streak freezes for the most recent run of missed scheduled days (today
 * doesn't count: it isn't over). Only when there was a streak to keep, every
 * missed day can be covered, and the freezes were already in hand then. The
 * run may sit behind up to two newer check-ins (made on another device before
 * this one settled). Returns the same object when nothing changes.
 */
export function settleFreezes(h: Habit, today = getDayKey()): Habit {
  const have = freezesOf(h);
  if (!have || h.archived) return h;
  const missed: string[] = [];
  let doneAfter = 0;
  let streakBefore = false;
  for (let day = shift(today, -1), i = 0; i < 60; day = shift(day, -1), i++) {
    if (day < createdDay(h)) break;
    if (!isScheduled(h, day)) continue;
    if (isDone(h, day)) {
      if (missed.length) {
        streakBefore = true;
        break;
      }
      if (++doneAfter > 2) return h;
      continue;
    }
    missed.push(day);
    if (missed.length > have) return h;
  }
  if (!streakBefore || !missed.length) return h;
  // A freeze earned after the miss can't cover it.
  if (h.freezeEarnedOn && h.freezeEarnedOn >= missed[missed.length - 1]) return h;
  return { ...h, freezes: have - missed.length, frozen: [...(h.frozen ?? []), ...missed].sort() };
}

/** settleFreezes for a whole list: the new list, or null when nothing changed. */
export function settleAllFreezes(list: Habit[], today = getDayKey()): Habit[] | null {
  let changed = false;
  const next = list.map((h) => {
    const s = settleFreezes(h, today);
    if (s !== h) changed = true;
    return s;
  });
  return changed ? next : null;
}

export interface StreakMoment {
  habitId: string;
  name: string;
  emoji: string;
  streak: number;
  /** A streak freeze was earned with this check-in. */
  earnedFreeze: boolean;
  /** The streak reached a milestone (3, 7, 14, 30, 100…). */
  milestone: boolean;
}

/**
 * After logging today: earn a freeze every FREEZE_EVERY days of streak (taken
 * back if today is unmarked again), and say whether it's a moment to celebrate.
 */
export function afterLog(before: Habit, after: Habit, today = getDayKey()): { habit: Habit; moment: StreakMoment | null } {
  const wasDone = isScheduled(before, today) && isDone(before, today);
  const nowDone = isScheduled(after, today) && isDone(after, today);
  if (wasDone && !nowDone && after.freezeEarnedOn === today) {
    const { freezeEarnedOn: _gone, ...rest } = after;
    return { habit: { ...rest, freezes: Math.max(0, freezesOf(after) - 1) }, moment: null };
  }
  if (wasDone || !nowDone) return { habit: after, moment: null };
  const streak = currentStreak(after, today);
  let habit = after;
  let earnedFreeze = false;
  if (streak > 0 && streak % FREEZE_EVERY === 0 && after.freezeEarnedOn !== today && freezesOf(after) < MAX_FREEZES) {
    habit = { ...after, freezes: freezesOf(after) + 1, freezeEarnedOn: today };
    earnedFreeze = true;
  }
  const milestone = MILESTONES.includes(streak);
  return { habit, moment: milestone || earnedFreeze ? { habitId: after.id, name: after.name, emoji: after.emoji, streak, earnedFreeze, milestone } : null };
}

/** "🔥 7-day streak!" and what goes with it. */
export function momentText(m: StreakMoment, quit = false): { title: string; detail: string } {
  const title = quit ? `🛡 ${m.streak} days kept!` : `🔥 ${m.streak}-day streak!`;
  const parts: string[] = [];
  if (m.milestone) parts.push(m.streak >= 100 ? "That's a habit for life." : m.streak >= 30 ? "A whole month. Seriously impressive." : m.streak >= 7 ? "A full week. Keep it rolling." : "Off to a great start.");
  if (m.earnedFreeze) parts.push("You earned a 🧊 streak freeze: it covers a missed day automatically.");
  return { title, detail: parts.join(" ") };
}
