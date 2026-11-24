// Typed prefixes, shared by the command palette (Ctrl/⌘+K) and Quick add
// (Alt+Shift+A, the desktop app's global shortcut):
//   t Pay rent friday   → a to-do (quick-add rules: dates, #list, @label, !high)
//   n Meeting ideas     → a note
//   h read              → check off a habit
//   p 25 / p            → start a Pomodoro (minutes; default from settings)
//   ? why is…           → Ask ProdLi
//   s addr              → a saved snippet (copied, or typed into the page)
// A prefix is one letter and a space at the start (or "?"), so "today" or
// "pay rent" are never read as prefixes.

import { afterLog, isDone, isScheduled, kindOf, addAmount, toggleCheck, type StreakMoment } from "./habits";
import { loadPomodoro, saveTimer, start, type TimerState } from "./pomodoroCore";
import { storageGet, storageSet } from "./storage";
import { getDayKey } from "./utils";
import type { Habit } from "../types";

export type PrefixKind = "todo" | "note" | "habit" | "pomodoro" | "ask" | "snippet";

export interface Prefixed {
  kind: PrefixKind;
  /** The text after the prefix. */
  rest: string;
  /** Pomodoro minutes (p 25), when given. */
  minutes?: number;
}

export const PREFIXES: { key: string; kind: PrefixKind; label: string; example: string }[] = [
  { key: "t", kind: "todo", label: "to-do", example: "t Pay rent friday" },
  { key: "n", kind: "note", label: "note", example: "n Meeting ideas" },
  { key: "h", kind: "habit", label: "habit", example: "h read" },
  { key: "p", kind: "pomodoro", label: "Pomodoro", example: "p 25" },
  { key: "?", kind: "ask", label: "ask", example: "? what's due this week" },
  { key: "s", kind: "snippet", label: "snippet", example: "s address" },
];

/** Longest Pomodoro the prefix starts (minutes). */
export const MAX_POMODORO_MINUTES = 180;

/** Reads a typed prefix, or null for plain text. */
export function parsePrefix(input: string): Prefixed | null {
  const text = input.replace(/^\s+/, "");
  if (text.startsWith("?")) return { kind: "ask", rest: text.slice(1).trim() };
  const m = /^([tnhps])(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return null;
  // A lone letter only counts once a space follows it ("t" alone could be the start of a word).
  if (m[2] === undefined && !/\s$/.test(input) && text.length === 1) return null;
  const kind = PREFIXES.find((p) => p.key === m[1].toLowerCase())!.kind;
  const rest = (m[2] ?? "").trim();
  if (kind === "pomodoro") {
    const n = /^(\d{1,3})(?:\s*(?:m|min|mins|minutes))?(?:\s+([\s\S]*))?$/i.exec(rest);
    if (n) {
      const minutes = Number(n[1]);
      if (minutes >= 1 && minutes <= MAX_POMODORO_MINUTES) return { kind, rest: (n[2] ?? "").trim(), minutes };
    }
    return { kind, rest };
  }
  return { kind, rest };
}

/** The one-line help shown when nothing's typed: "t to-do · n note · …". */
export const prefixHelp = (kinds: PrefixKind[] = PREFIXES.map((p) => p.kind)) =>
  PREFIXES.filter((p) => kinds.includes(p.kind))
    .map((p) => (p.kind === "pomodoro" ? "p 25 Pomodoro" : `${p.key} ${p.label}`))
    .join(" · ");

// ── Habits ───────────────────────────────────────────────────────────────────

/** Today's habits that match the text (name or emoji), best match first. */
export function matchHabits(habits: Habit[], query: string, today = getDayKey()): Habit[] {
  const q = query.trim().toLowerCase();
  const due = habits.filter((h) => !h.archived && isScheduled(h, today) && kindOf(h) !== "quit");
  if (!q) return due;
  const score = (h: Habit) => {
    const name = h.name.toLowerCase();
    if (name === q || h.emoji === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return 9;
  };
  return due.filter((h) => score(h) < 9).sort((a, b) => score(a) - score(b));
}

/**
 * Logs a habit for today from the palette or Quick add (check: done/undone;
 * count/timed: +1 / +5 min), earning streak freezes like the Habits page.
 */
export async function logHabitToday(id: string, today = getDayKey()): Promise<{ habit: Habit; done: boolean; moment: StreakMoment | null } | null> {
  const list = await storageGet<Habit[]>("habits", []);
  const h = list.find((x) => x.id === id);
  if (!h) return null;
  const k = kindOf(h);
  if (k === "quit") return null;
  const next = k === "check" ? toggleCheck(h, today) : addAmount(h, today, k === "timed" ? 5 : 1);
  const { habit, moment } = afterLog(h, next, today);
  const stamped = { ...habit, updatedAt: new Date().toISOString() };
  // Re-read just before writing, so a change made meanwhile in another tab isn't lost.
  const latest = await storageGet<Habit[]>("habits", []);
  await storageSet("habits", latest.map((x) => (x.id === id ? stamped : x)));
  return { habit: stamped, done: isDone(stamped, today), moment };
}

// ── Pomodoro ─────────────────────────────────────────────────────────────────

/** Starts a focus session now (minutes from `p 25`, else the Pomodoro settings), with an optional label. */
export async function startPomodoroNow(minutes?: number, label = ""): Promise<TimerState> {
  const { settings, timer } = await loadPomodoro();
  const mins = minutes ?? settings.workDuration;
  const next = start({ ...timer, phase: "work", running: false, endsAt: null, remaining: Math.round(mins * 60), label: label || timer.label });
  await saveTimer(next);
  return next;
}
