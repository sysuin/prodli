// "What ProdLi did for you": a short recap of the user's own activity, shown
// on Today (sections/today/ValueRecap.tsx) at two moments:
//   - the first days of a month: last month's recap (once, dismissible);
//   - the last 3 days of the free Pro trial: what the trial covered, with Upgrade.
// Everything is counted on this device from data the app already has; nothing
// is sent anywhere.

import type { Habit, Todo } from "../types";

export const RECAP_KEY = "valueRecap";
/** Dismissals: the month recaps already seen ("2026-11") and the last day the trial reminder was closed. */
export interface RecapState {
  months: string[];
  trialDismissedOn: string | null;
}
export const NO_RECAP_STATE: RecapState = { months: [], trialDismissedOn: null };

export interface RecapStats {
  tasksDone: number;
  meetingsSummarized: number;
  focusMinutes: number;
  habitCheckIns: number;
  dictatedWords: number;
}

export interface RecapInput {
  todos: Pick<Todo, "completed" | "completedAt">[];
  meetings: { startedAt?: string | number; summary?: { generatedAt?: string } | null }[];
  sessions: { completedAt: string; duration: number }[];
  habits: Pick<Habit, "completedDays" | "log">[];
  dictation: { at: string; words: number }[];
}

const inRange = (t: string | number | undefined | null, from: number, to: number) => {
  if (t == null) return false;
  const ms = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) && ms >= from && ms < to;
};
const dayInRange = (day: string, from: number, to: number) => inRange(`${day}T12:00:00`, from, to);

/** Counts activity between `from` (inclusive) and `to` (exclusive), both ms. */
export function recapStats(input: RecapInput, from: number, to: number): RecapStats {
  return {
    tasksDone: input.todos.filter((t) => t.completed && inRange(t.completedAt, from, to)).length,
    meetingsSummarized: input.meetings.filter((m) => inRange(m.summary?.generatedAt, from, to)).length,
    // Pomodoro sessions store their length in minutes (pomodoroCore.ts).
    focusMinutes: Math.round(input.sessions.filter((s) => inRange(s.completedAt, from, to)).reduce((n, s) => n + (s.duration || 0), 0)),
    habitCheckIns: input.habits.reduce((n, h) => n + h.completedDays.filter((d) => dayInRange(d, from, to)).length + Object.keys(h.log ?? {}).filter((d) => (h.log?.[d] ?? 0) > 0 && dayInRange(d, from, to)).length, 0),
    dictatedWords: input.dictation.filter((d) => inRange(d.at, from, to)).reduce((n, d) => n + (d.words || 0), 0),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const hours = (min: number) => (min >= 90 ? `${Math.round(min / 6) / 10} hours` : plural(min, "minute"));

/** The non-zero parts as short phrases, biggest wins first. */
export function recapPhrases(s: RecapStats): string[] {
  return [
    s.meetingsSummarized ? `summarized ${plural(s.meetingsSummarized, "meeting")}` : "",
    s.tasksDone ? `finished ${plural(s.tasksDone, "to-do")}` : "",
    s.focusMinutes ? `${hours(s.focusMinutes)} of focus` : "",
    s.habitCheckIns ? `${plural(s.habitCheckIns, "habit check-in")}` : "",
    s.dictatedWords ? `${plural(s.dictatedWords, "word")} dictated` : "",
  ].filter(Boolean);
}

export const hasActivity = (s: RecapStats) => recapPhrases(s).length > 0;

const monthId = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dayId = (d: Date) => `${monthId(d)}-${String(d.getDate()).padStart(2, "0")}`;

/** Last month's range and name, for a recap shown in the first 5 days of a month; otherwise null. */
export function monthRecapWindow(now: Date, state: RecapState): { id: string; label: string; from: number; to: number } | null {
  if (now.getDate() > 5) return null;
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const id = monthId(start);
  if (state.months.includes(id)) return null;
  return { id, label: start.toLocaleDateString([], { month: "long" }), from: start.getTime(), to: end.getTime() };
}

/** The trial reminder shows in the last 3 days of the trial, at most once a day. */
export function trialReminderDue(trialEndsAt: number | null | undefined, now: Date, state: RecapState): boolean {
  if (!trialEndsAt) return false;
  const left = trialEndsAt - now.getTime();
  return left > 0 && left <= 3 * 86_400_000 && state.trialDismissedOn !== dayId(now);
}

export const dismissMonth = (state: RecapState, id: string): RecapState => ({ ...state, months: [...state.months.filter((m) => m !== id), id].slice(-12) });
export const dismissTrialToday = (state: RecapState, now: Date): RecapState => ({ ...state, trialDismissedOn: dayId(now) });
