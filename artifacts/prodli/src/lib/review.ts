// Weekly review: what got done this week, what slipped, how habits and focus
// went, where browsing time went — and, when signed in, a short AI write-up
// with priorities for next week (server: /api/ai/review, counted with briefs).
//
// Weeks run Monday–Sunday. The review is saved on the week's Monday day
// record (DayRecord.review), so it syncs like everything else.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet, storageGetAll } from "./storage";
import { getDayKey } from "./utils";
import { DAYS_KEY } from "./today";
import type { DayRecord, Habit, Note, Todo, WeeklyReview } from "../types";
import type { Meeting } from "../recorder/types";

const DAY_MS = 86_400_000;
const at = (key: string) => new Date(`${key}T12:00:00`);
export const addDays = (key: string, n: number) => getDayKey(new Date(at(key).getTime() + n * DAY_MS));

/** Monday (YYYY-MM-DD) of the week containing `d`. */
export function weekStart(d: Date | string = new Date()): string {
  const date = typeof d === "string" ? at(d) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const back = (date.getDay() + 6) % 7; // Mon → 0 … Sun → 6
  return getDayKey(new Date(date.getTime() - back * DAY_MS));
}

/** The week to review by default: this week from Friday on, otherwise last week. */
export function defaultReviewWeek(now = new Date()): string {
  const thisWeek = weekStart(now);
  return now.getDay() === 0 || now.getDay() >= 5 ? thisWeek : addDays(thisWeek, -7);
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export function weekLabel(start: string): string {
  const s = at(start);
  const e = at(addDays(start, 6));
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

export interface WeekStats {
  start: string;
  end: string;
  /** Days of the week up to today (a review written mid-week only counts those). */
  daysSoFar: number;
  done: { id: string; title: string; day: string; priority?: Todo["priority"] }[];
  /** Open tasks that were due or planned this week (or earlier) and not done. */
  slipped: { id: string; title: string; due?: string; planned?: string; priority?: Todo["priority"] }[];
  added: number;
  perDay: { day: string; done: number; focusMin: number }[];
  habits: { id: string; name: string; emoji: string; done: number; of: number }[];
  focus: { sessions: number; minutes: number };
  browsing: { minutes: number; topSites: { site: string; minutes: number }[] };
  meetings: { count: number; minutes: number; titles: string[]; openActions: string[] };
  notes: { created: number; edited: number };
  focuses: { day: string; text: string }[];
  reflections: { day: string; text: string }[];
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pure: the week's numbers from the user's data. */
export function weekStats(input: {
  start: string;
  today: string;
  todos: Todo[];
  habits: Habit[];
  days: DayRecord[];
  sessions: { completedAt: string; duration?: number }[];
  tracking: Record<string, Record<string, number> | undefined>;
  meetings: Meeting[];
  notes: Note[];
}): WeekStats {
  const days = weekDays(input.start);
  const end = days[6];
  const inWeek = (key: string | undefined) => !!key && key >= input.start && key <= end;
  const lastCounted = input.today < end ? input.today : end;
  const counted = days.filter((d) => d <= lastCounted);

  const done = input.todos
    .filter((t) => t.completed && t.completedAt && inWeek(getDayKey(t.completedAt)))
    .map((t) => ({ id: t.id, title: t.title, day: getDayKey(t.completedAt!), priority: t.priority }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const slipped = input.todos
    .filter((t) => !t.completed && ((t.dueDate && t.dueDate <= lastCounted && t.dueDate >= addDays(input.start, -28)) || (t.plannedFor && t.plannedFor <= lastCounted && t.plannedFor >= addDays(input.start, -28))))
    .map((t) => ({ id: t.id, title: t.title, due: t.dueDate, planned: t.plannedFor, priority: t.priority }))
    .sort((a, b) => (a.due ?? a.planned ?? "").localeCompare(b.due ?? b.planned ?? ""));
  const dayOf = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? getDayKey(iso) : undefined);
  const added = input.todos.filter((t) => inWeek(dayOf(t.createdAt))).length;

  const sessions = input.sessions.filter((s) => inWeek(getDayKey(s.completedAt)));
  const perDay = days.map((day) => ({
    day,
    done: done.filter((t) => t.day === day).length,
    focusMin: sessions.filter((s) => getDayKey(s.completedAt) === day).reduce((n, s) => n + (s.duration ?? 25), 0),
  }));

  const habits = input.habits
    .filter((h) => !h.archived)
    .map((h) => {
      const created = h.createdAt && !Number.isNaN(Date.parse(h.createdAt)) ? getDayKey(h.createdAt) : "";
      const from = created > input.start ? created : input.start;
      const span = counted.filter((d) => d >= from);
      return { id: h.id, name: h.name, emoji: h.emoji, done: span.filter((d) => h.completedDays.includes(d)).length, of: span.length };
    })
    .filter((h) => h.of > 0);

  const siteTotals: Record<string, number> = {};
  for (const d of days) for (const [site, sec] of Object.entries(input.tracking[d] ?? {})) siteTotals[site] = (siteTotals[site] ?? 0) + (sec || 0);
  const sites = Object.entries(siteTotals).sort((a, b) => b[1] - a[1]);

  const meetings = input.meetings.filter((m) => inWeek(getDayKey(m.startedAt)));
  const todoTitles = new Set(input.todos.map((t) => t.title.trim().toLowerCase()));
  const openActions = meetings.flatMap((m) => m.summary?.actionItems.map((a) => a.task) ?? []).filter((a) => !todoTitles.has(a.trim().toLowerCase()));

  const records = input.days.filter((d) => inWeek(d.id));
  return {
    start: input.start,
    end,
    daysSoFar: counted.length,
    done,
    slipped,
    added,
    perDay,
    habits,
    focus: { sessions: sessions.length, minutes: perDay.reduce((n, d) => n + d.focusMin, 0) },
    browsing: { minutes: Math.round(sites.reduce((n, [, s]) => n + s, 0) / 60), topSites: sites.slice(0, 5).map(([site, s]) => ({ site, minutes: Math.round(s / 60) })) },
    meetings: { count: meetings.length, minutes: Math.round(meetings.reduce((n, m) => n + (m.durationSec || 0), 0) / 60), titles: meetings.map((m) => m.summary?.title || m.title).slice(0, 15), openActions: openActions.slice(0, 15) },
    notes: { created: input.notes.filter((n) => inWeek(dayOf(n.createdAt))).length, edited: input.notes.filter((n) => inWeek(dayOf(n.updatedAt)) && !inWeek(dayOf(n.createdAt))).length },
    focuses: records.filter((r) => r.focus?.trim()).map((r) => ({ day: r.id, text: r.focus!.trim() })).sort((a, b) => a.day.localeCompare(b.day)),
    reflections: records.filter((r) => r.reflection?.trim()).map((r) => ({ day: r.id, text: r.reflection!.trim() })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** Gathers the week's data from this device. */
export async function loadWeekStats(start: string, today = getDayKey()): Promise<WeekStats> {
  const [todos, habits, days, sessions, notes, all] = await Promise.all([
    storageGet<Todo[]>("todos", []),
    storageGet<Habit[]>("habits", []),
    storageGet<DayRecord[]>(DAYS_KEY, []),
    storageGet<{ completedAt: string; duration?: number }[]>("pomodoroSessions", []),
    storageGet<Note[]>("notes", []),
    storageGetAll(),
  ]);
  let meetings: Meeting[] = [];
  try {
    meetings = await (await import("../recorder/db")).listMeetings();
  } catch {
    // IndexedDB unavailable
  }
  const tracking: Record<string, Record<string, number> | undefined> = {};
  for (const d of weekDays(start)) tracking[d] = all[`tt_${d}`] as Record<string, number> | undefined;
  return weekStats({ start, today, todos, habits, days, sessions, tracking, meetings, notes });
}

/** What the server gets: the stats, trimmed to what's useful (and allowed). */
export type ReviewContext = {
  weekStart: string;
  weekEnd: string;
  daysSoFar: number;
  done: { title: string; day: string; priority?: Todo["priority"] }[];
  slipped: { title: string; due?: string; planned?: string; priority?: Todo["priority"] }[];
  added: number;
  perDay: { day: string; done: number; focusMin: number }[];
  habits: { name: string; done: number; of: number }[];
  focus: { sessions: number; minutes: number };
  browsing: { minutes: number; topSites: { site: string; minutes: number }[] };
  meetings: { count: number; minutes: number; titles: string[]; openActions: string[] };
  notes: { created: number; edited: number };
  focuses: { day: string; text: string }[];
  reflections: { day: string; text: string }[];
  userNote?: string;
};

export function reviewContext(s: WeekStats, userNote?: string): ReviewContext {
  return {
    weekStart: s.start,
    weekEnd: s.end,
    daysSoFar: s.daysSoFar,
    done: s.done.slice(0, 60).map((t) => ({ title: clip(t.title), day: t.day, priority: t.priority })),
    slipped: s.slipped.slice(0, 40).map((t) => ({ title: clip(t.title), due: t.due, planned: t.planned, priority: t.priority })),
    added: s.added,
    perDay: s.perDay,
    habits: s.habits.slice(0, 30).map((h) => ({ name: clip(h.name, 100), done: h.done, of: h.of })),
    focus: s.focus,
    browsing: { minutes: Math.min(s.browsing.minutes, 10080), topSites: s.browsing.topSites.map((x) => ({ site: clip(x.site, 100), minutes: Math.min(x.minutes, 10080) })) },
    meetings: { count: s.meetings.count, minutes: Math.min(s.meetings.minutes, 10080), titles: s.meetings.titles.map((t) => clip(t, 150)), openActions: s.meetings.openActions.map((t) => clip(t)) },
    notes: s.notes,
    focuses: s.focuses.map((f) => ({ day: f.day, text: clip(f.text, 300) })),
    reflections: s.reflections.map((r) => ({ day: r.day, text: clip(r.text, 600) })),
    userNote: userNote?.trim() ? clip(userNote.trim(), 1500) : undefined,
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A useful review without AI (not signed in, offline, or allowance used up). */
export function basicReview(s: WeekStats): WeeklyReview {
  const bestDay = [...s.perDay].sort((a, b) => b.done + b.focusMin / 25 - (a.done + a.focusMin / 25))[0];
  const habitRate = s.habits.length ? Math.round((s.habits.reduce((n, h) => n + h.done, 0) / Math.max(1, s.habits.reduce((n, h) => n + h.of, 0))) * 100) : null;
  const topHabit = [...s.habits].sort((a, b) => b.done / b.of - a.done / a.of)[0];
  const weakHabit = [...s.habits].sort((a, b) => a.done / a.of - b.done / b.of)[0];
  const top = s.browsing.topSites[0];
  const wins = [
    ...(s.done.length ? [`Finished ${plural(s.done.length, "task")}${s.done.some((t) => t.priority === "high") ? `, including ${s.done.filter((t) => t.priority === "high").length} high priority` : ""}.`] : []),
    ...(s.focus.sessions ? [`${plural(s.focus.sessions, "focus session")} (${Math.round((s.focus.minutes / 60) * 10) / 10} h).`] : []),
    ...(topHabit && topHabit.done ? [`${topHabit.emoji} ${topHabit.name}: ${topHabit.done} of ${topHabit.of} days.`] : []),
  ];
  const patterns = [
    ...(bestDay && (bestDay.done || bestDay.focusMin) ? [`Your most productive day was ${at(bestDay.day).toLocaleDateString("en-US", { weekday: "long" })}.`] : []),
    ...(top && s.browsing.minutes ? [`${Math.round((s.browsing.minutes / 60) * 10) / 10} h of browsing; most on ${top.site} (${Math.round((top.minutes / 60) * 10) / 10} h).`] : []),
    ...(habitRate !== null ? [`Habits done ${habitRate}% of the time.`] : []),
  ];
  const nextWeek = [
    ...s.slipped.filter((t) => t.priority === "high").slice(0, 2).map((t) => ({ title: t.title, reason: "High priority that slipped this week" })),
    ...s.slipped.filter((t) => t.priority !== "high").slice(0, 3 - Math.min(2, s.slipped.filter((t) => t.priority === "high").length)).map((t) => ({ title: t.title, reason: t.due ? `Was due ${t.due}` : "Carried over from this week" })),
    ...s.meetings.openActions.slice(0, 1).map((a) => ({ title: a, reason: "Action item from a meeting, not on your to-do list yet" })),
  ].slice(0, 3);
  return {
    headline: s.done.length ? `${plural(s.done.length, "task")} done this week` : "A fresh start next week",
    summary: [
      s.done.length || s.focus.sessions ? `You finished ${plural(s.done.length, "task")} and logged ${plural(s.focus.sessions, "focus session")}.` : "Not much was tracked this week.",
      s.slipped.length ? `${plural(s.slipped.length, "task")} slipped.` : "Nothing slipped.",
      s.meetings.count ? `${plural(s.meetings.count, "meeting")} recorded.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    wins,
    slipped: s.slipped.slice(0, 5).map((t) => ({ title: t.title, suggestion: t.priority === "high" ? "Plan it for Monday morning." : "Move it to next week, or drop it if it no longer matters." })),
    patterns,
    nextWeek,
    habitTip: weakHabit && weakHabit.done < weakHabit.of ? `${weakHabit.emoji} ${weakHabit.name} was the hardest to keep (${weakHabit.done} of ${weakHabit.of} days). Pick a fixed time for it.` : "",
    question: "What's the one thing that would make next week a win?",
    model: "basic",
    generatedAt: new Date().toISOString(),
    source: "basic",
  };
}

export interface ReviewResult {
  review: WeeklyReview;
  usage?: { used: number; limit: number };
  fallbackReason?: string;
}

/** The AI review when signed in; otherwise (or if that fails) the basic one. */
export async function writeReview(stats: WeekStats, userNote?: string): Promise<ReviewResult> {
  if (!accountsEnabled() || !(await getProdliAccount())) return { review: basicReview(stats), fallbackReason: "signed_out" };
  try {
    const r = await accountRequest<{ review: WeeklyReview; usage: { used: number; limit: number } }>("/api/ai/review", { method: "POST", body: JSON.stringify(reviewContext(stats, userNote)) });
    return { review: { ...r.review, source: "ai" }, usage: r.usage };
  } catch (err) {
    const reason =
      err instanceof AccountError && err.status === 503
        ? "ProdLi's AI isn't available right now — here's a basic review."
        : err instanceof AccountError && err.status === 0
          ? "You're offline — here's a basic review from what's on this device."
          : err instanceof AccountError
            ? err.message
            : "Couldn't reach ProdLi.";
    return { review: basicReview(stats), fallbackReason: reason };
  }
}

/** True on Friday afternoon through Monday when last/this week has no review yet (for the Today nudge). */
export function reviewDue(days: DayRecord[], now = new Date()): string | null {
  const dow = now.getDay();
  const due = (dow === 5 && now.getHours() >= 15) || dow === 6 || dow === 0 || dow === 1;
  if (!due) return null;
  const week = defaultReviewWeek(now);
  return days.find((d) => d.id === week)?.review ? null : week;
}
