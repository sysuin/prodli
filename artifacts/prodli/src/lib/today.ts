// Today: the daily brief and day planning (see docs/PLAN-ASSISTANT.md).
//
// buildContext() gathers the user's day from data already on this device
// (to-dos, habits, meetings, Time Tracker, Pomodoro, yesterday's reflection,
// optional calendar). The brief is written by ProdLi's AI when the user is
// signed in (server: /api/ai/brief), and otherwise by basicBrief() right here,
// so Today is useful without an account too.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet, storageGetAll } from "./storage";
import { getDayKey } from "./utils";
import type { CalendarEvent } from "./calendar";
import type { DailyBrief, DayRecord, Habit, Todo, TodaySettings } from "../types";
import type { Meeting } from "../recorder/types";
import { currentStreak, isDone } from "./habits";
import { buildPrep, metLabel } from "./meetingPrep";
import { breakdown, focusScore, SITE_CATEGORIES_KEY } from "./siteCategories";
import { briefLanguage, getVoiceLanguage } from "./voiceLanguage";

export const DAYS_KEY = "days";
export const TODAY_SETTINGS_KEY = "todaySettings";
export const DEFAULT_TODAY_SETTINGS: TodaySettings = { workStart: "09:00", workEnd: "18:00", reminder: "08:30", startOnToday: true, autoBrief: true, blockReminders: true };

export function getTodaySettings(): Promise<TodaySettings> {
  return storageGet<TodaySettings>(TODAY_SETTINGS_KEY, DEFAULT_TODAY_SETTINGS).then((s) => ({ ...DEFAULT_TODAY_SETTINGS, ...s }));
}

export const dayKey = (d = new Date()) => getDayKey(d);
export const yesterdayKey = (d = new Date()) => getDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
export const tomorrowKey = (d = new Date()) => getDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Fingerprint of what the brief depends on most: open tasks for today/overdue and today's events. */
export function briefBasis(todos: Todo[], events: CalendarEvent[], today = dayKey()): string {
  const tasks = todos
    .filter((t) => isForToday(t, today) || (!t.completed && t.priority === "high"))
    .map((t) => `${t.id}:${t.title}:${t.completed ? 1 : 0}:${t.dueDate ?? ""}:${t.plannedFor ?? ""}`)
    .sort();
  const evts = events.map((e) => `${e.id}:${e.start}:${e.title}`).sort();
  return `${tasks.join("|")}#${evts.join("|")}`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Open tasks that matter today: planned for today (or earlier), overdue or due today. */
export function isForToday(t: Todo, today: string): boolean {
  if (t.completed) return false;
  return (!!t.plannedFor && t.plannedFor <= today) || (!!t.dueDate && t.dueDate <= today);
}

/** Minutes of work time left today, from now (or the start of the working day) to its end. */
export function minutesLeft(settings: Pick<TodaySettings, "workStart" | "workEnd">, now = new Date()): number {
  const start = Math.max(toMinutes(settings.workStart), now.getHours() * 60 + now.getMinutes());
  return Math.max(0, toMinutes(settings.workEnd) - start);
}

export type BriefContext = {
  date: string;
  weekday: string;
  now: string;
  workHours: { start: string; end: string };
  focus?: string;
  tasks: { title: string; priority?: "high" | "medium" | "low"; due?: string; overdue?: boolean; planned?: boolean; estimateMin?: number; openSubtasks?: number }[];
  doneYesterday?: string[];
  habits?: { name: string; doneToday: boolean; streak: number }[];
  events?: { title: string; start?: string; end?: string; allDay?: boolean }[];
  meetingActions?: { task: string; owner?: string | null; due?: string | null; meeting: string }[];
  /** What ProdLi knows from earlier meetings, for today's upcoming events (lib/meetingPrep.ts). */
  meetingPrep?: { event: string; start?: string; lastMet?: string; lastSummary?: string; openItems: string[]; relatedTasks?: string[] }[];
  yesterday?: { browsingMinutes?: number; topSites?: { site: string; minutes: number }[]; focusSessions?: number; focusScore?: number; reflection?: string };
};

export function habitStreak(h: Habit, today: string): number {
  return currentStreak(h, today);
}

const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pure: the brief's input, from the user's data. Capped to what the server accepts. */
export function contextFrom(input: {
  now: Date;
  settings: TodaySettings;
  todos: Todo[];
  habits: Habit[];
  meetings: Meeting[];
  days: DayRecord[];
  events: CalendarEvent[];
  trackingYesterday?: Record<string, number>;
  sessions?: { completedAt: string }[];
  siteCategories?: Record<string, string>;
}): BriefContext {
  const { now, settings } = input;
  const today = dayKey(now);
  const yesterday = yesterdayKey(now);
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  const open = input.todos.filter((t) => !t.completed);
  const ranked = [...open].sort((a, b) => {
    const score = (t: Todo) => (isForToday(t, today) ? 0 : 1) * 10 + (t.priority ? priorityRank[t.priority] : 3);
    return score(a) - score(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });
  const todoTitles = new Set(input.todos.map((t) => t.title.trim().toLowerCase()));
  const day = input.days.find((d) => d.id === today);
  const yday = input.days.find((d) => d.id === yesterday);
  const sites = Object.entries(input.trackingYesterday ?? {}).sort((a, b) => b[1] - a[1]);
  const browsing = sites.reduce((n, [, s]) => n + s, 0);

  const ctx: BriefContext = {
    date: today,
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    now: hm(now),
    workHours: { start: settings.workStart, end: settings.workEnd },
    focus: day?.focus?.trim() ? clip(day.focus.trim()) : undefined,
    tasks: ranked.slice(0, 60).map((t) => ({
      title: clip(t.title),
      priority: t.priority,
      due: t.dueDate,
      overdue: !!t.dueDate && t.dueDate < today ? true : undefined,
      planned: t.plannedFor && t.plannedFor <= today ? true : undefined,
      estimateMin: t.estimateMin,
      openSubtasks: t.subtasks?.filter((s) => !s.completed).length || undefined,
    })),
    doneYesterday: input.todos.filter((t) => t.completed && t.completedAt && getDayKey(t.completedAt) === yesterday).map((t) => clip(t.title)).slice(0, 20),
    habits: input.habits.filter((h) => !h.archived).slice(0, 30).map((h) => ({ name: clip(h.name, 100), doneToday: isDone(h, today), streak: habitStreak(h, today) })),
    events: input.events.slice(0, 30).map((e) => ({ title: clip(e.title), start: e.start ?? undefined, end: e.end ?? undefined, allDay: e.allDay || undefined })),
    meetingActions: input.meetings
      .filter((m) => m.summary && Date.now() - new Date(m.startedAt).getTime() < 14 * 86_400_000)
      .flatMap((m) => m.summary!.actionItems.map((a) => ({ task: clip(a.task), owner: a.owner, due: a.dueDate, meeting: clip(m.summary!.title || m.title, 180) })))
      .filter((a) => !todoTitles.has(a.task.trim().toLowerCase()))
      .slice(0, 20),
    meetingPrep: buildPrep(input.events, input.meetings, input.todos, now).map((p) => ({
      event: clip(p.title),
      start: p.start ?? undefined,
      lastMet: p.last ? metLabel(p.last.date, now) : undefined,
      lastSummary: p.last?.overview ? clip(p.last.overview, 500) : undefined,
      openItems: p.openItems.map((i) => clip(i.task)),
      relatedTasks: p.relatedTasks.length ? p.relatedTasks.map((t) => clip(t.title)) : undefined,
    })),
    yesterday: {
      browsingMinutes: browsing ? Math.round(browsing / 60) : undefined,
      topSites: sites.slice(0, 5).map(([site, s]) => ({ site: clip(site, 100), minutes: Math.round(s / 60) })),
      focusSessions: (input.sessions ?? []).filter((s) => getDayKey(s.completedAt) === yesterday).length || undefined,
      focusScore: focusScore(breakdown(input.trackingYesterday, input.siteCategories)) ?? undefined,
      reflection: yday?.reflection?.trim() ? clip(yday.reflection.trim(), 900) : undefined,
    },
  };
  return ctx;
}

/** Gathers today's context from this device. */
export async function buildContext(events: CalendarEvent[], now = new Date()): Promise<BriefContext> {
  const [settings, todos, habits, days, sessions, siteCategories, all] = await Promise.all([
    getTodaySettings(),
    storageGet<Todo[]>("todos", []),
    storageGet<Habit[]>("habits", []),
    storageGet<DayRecord[]>(DAYS_KEY, []),
    storageGet<{ completedAt: string }[]>("pomodoroSessions", []),
    storageGet<Record<string, string>>(SITE_CATEGORIES_KEY, {}),
    storageGetAll(),
  ]);
  let meetings: Meeting[] = [];
  try {
    meetings = await (await import("../recorder/db")).listMeetings();
  } catch {
    // IndexedDB unavailable
  }
  const trackingYesterday = all[`tt_${yesterdayKey(now)}`] as Record<string, number> | undefined;
  return contextFrom({ now, settings, todos, habits, meetings, days, events, trackingYesterday, sessions, siteCategories });
}

/** "Last met 12 Nov · 2 open items: send the deck; book the venue" (basic brief). */
export function prepNote(p: NonNullable<BriefContext["meetingPrep"]>[number]): string {
  const n = p.openItems.length;
  return [
    p.lastMet ? `Last met ${p.lastMet}` : "",
    n ? `${n} open item${n > 1 ? "s" : ""}: ${p.openItems.slice(0, 2).join("; ")}${n > 2 ? "…" : ""}` : "",
    !n && p.relatedTasks?.length ? `Related to-do: ${p.relatedTasks[0]}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A useful brief without AI (not signed in, offline, or allowance used up). */
export function basicBrief(ctx: BriefContext): DailyBrief {
  const forToday = ctx.tasks.filter((t) => t.planned || t.overdue || (t.due && t.due <= ctx.date));
  const top = (forToday.length ? forToday : ctx.tasks).slice(0, 3);
  const overdue = ctx.tasks.filter((t) => t.overdue);
  const timed = (ctx.events ?? []).filter((e) => e.start && e.end);
  const planned = forToday.reduce((n, t) => n + (t.estimateMin ?? 0), 0);
  const free = Math.max(0, toMinutes(ctx.workHours.end) - Math.max(toMinutes(ctx.workHours.start), toMinutes(ctx.now))) - timed.reduce((n, e) => n + Math.max(0, toMinutes(e.end!) - toMinutes(e.start!)), 0);
  const watchouts = [
    ...(overdue.length ? [`${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}: ${overdue.slice(0, 3).map((t) => t.title).join(", ")}`] : []),
    ...(planned > free && planned > 0
      ? [free < 15 ? `Your working day is over, with about ${Math.round((planned / 60) * 10) / 10} h of planned work left — move it to tomorrow.` : `You've planned about ${Math.round((planned / 60) * 10) / 10} h of work but have about ${Math.round((free / 60) * 10) / 10} h free.`]
      : []),
  ];
  const events = (ctx.events ?? []).length;
  return {
    headline: ctx.focus ? `Today's focus: ${ctx.focus}` : top.length ? `Start with: ${top[0].title}` : `A fresh ${ctx.weekday}`,
    summary: [
      events ? `${events} event${events > 1 ? "s" : ""} on your calendar.` : "",
      forToday.length ? `${forToday.length} task${forToday.length > 1 ? "s" : ""} for today.` : ctx.tasks.length ? `${ctx.tasks.length} open task${ctx.tasks.length > 1 ? "s" : ""}.` : "No open tasks — plan one thing that would make today a win.",
    ]
      .filter(Boolean)
      .join(" "),
    priorities: top.map((t) => ({ title: t.title, reason: t.overdue ? "Overdue" : t.planned ? "Planned for today" : t.due === ctx.date ? "Due today" : t.priority === "high" ? "High priority" : "Next up" })),
    schedule: timed.map((e) => ({ start: e.start!, end: e.end!, title: e.title, kind: "meeting" as const })),
    watchouts,
    habits: (ctx.habits ?? []).filter((h) => !h.doneToday).slice(0, 5).map((h) => (h.streak ? `${h.name} — keep your ${h.streak}-day streak going` : h.name)),
    prep: (ctx.meetingPrep ?? []).map((p) => ({ event: p.start ? `${p.event} (${p.start})` : p.event, note: prepNote(p) })),
    tip: ctx.yesterday?.reflection
      ? `Yesterday you noted: “${ctx.yesterday.reflection.slice(0, 140)}”`
      : ctx.yesterday?.focusScore !== undefined
        ? `Yesterday's focus score was ${ctx.yesterday.focusScore}.${ctx.yesterday.focusScore < 50 ? " Try 🚫 Block distracting sites on the Pomodoro page during your focus hours." : " Start with your top priority to keep it up."}`
        : "Pick one task and give it a focused 25-minute Pomodoro before checking messages.",
    model: "basic",
    generatedAt: new Date().toISOString(),
    source: "basic",
  };
}

export interface BriefResult {
  brief: DailyBrief;
  usage?: { used: number; limit: number };
  /** Why the AI wasn't used, if it wasn't. */
  fallbackReason?: string;
}

/** The AI brief when signed in; otherwise (or if that fails) the basic one. */
export async function writeBrief(ctx: BriefContext): Promise<BriefResult> {
  if (!accountsEnabled() || !(await getProdliAccount())) return { brief: basicBrief(ctx), fallbackReason: "signed_out" };
  try {
    // Settings → Language: the brief in Hindi, Tamil… (English unless chosen).
    const language = briefLanguage(await getVoiceLanguage());
    const r = await accountRequest<{ brief: DailyBrief; usage: { used: number; limit: number } }>("/api/ai/brief", { method: "POST", body: JSON.stringify(language ? { ...ctx, language } : ctx) });
    return { brief: { ...r.brief, source: "ai" }, usage: r.usage };
  } catch (err) {
    const reason =
      err instanceof AccountError && err.status === 503
        ? "ProdLi's AI briefs aren't available right now — here's a basic brief."
        : err instanceof AccountError && err.status === 0
          ? "You're offline — here's a basic brief from what's on this device."
          : err instanceof AccountError
            ? err.message
            : "Couldn't reach ProdLi.";
    return { brief: basicBrief(ctx), fallbackReason: reason };
  }
}
