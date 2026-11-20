// Meetings → "📊 Insights" (Pro): where your meeting time goes, from the
// meetings recorded on this account over the last weeks. Everything is worked
// out on this device from the saved meetings; nothing is sent anywhere.

import type { Meeting } from "../recorder/types";
import type { CallPlatform } from "../recorder/calls";
import { isPlaceholderTitle } from "../recorder/calls";
import { meetCode, titlesMatch } from "./meetingPrep";
import { talkStats } from "../recorder/speakers";

export const INSIGHT_WEEKS = 8;
const DAY = 86_400_000;

export interface WeekBar {
  /** Monday of the week, YYYY-MM-DD (local). */
  weekStart: string;
  minutes: number;
  count: number;
}

export interface SeriesLoad {
  title: string;
  count: number;
  minutes: number;
  /** The most recent meeting in the series (to open it). */
  latestId: string;
}

export interface MeetingInsights {
  weeks: WeekBar[];
  thisWeek: { minutes: number; count: number };
  lastWeek: { minutes: number; count: number };
  total: { minutes: number; count: number };
  avgMinutes: number;
  /** 0 = Monday … 6 = Sunday; null with no meetings. */
  busiestDay: number | null;
  byPlatform: { platform: CallPlatform; minutes: number; count: number }[];
  /** Meetings that happen again and again (2+ times), most time first. */
  series: SeriesLoad[];
  decisions: number;
  actionItems: number;
  actionItemsDone: number;
  /** Your average share of the talking, where talk time was recorded; null if none. */
  talkShare: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday 00:00 (local) of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const minutesOf = (m: Meeting) => Math.max(0, Math.round((m.durationSec || 0) / 60));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function meetingInsights(meetings: Meeting[], now = new Date(), weeksBack = INSIGHT_WEEKS): MeetingInsights {
  const thisMonday = weekStart(now);
  const from = new Date(thisMonday);
  from.setDate(from.getDate() - 7 * (weeksBack - 1));
  const inRange = meetings.filter((m) => m.status !== "recording" && new Date(m.startedAt) >= from && new Date(m.startedAt).getTime() <= now.getTime() + DAY);

  const weeks: WeekBar[] = Array.from({ length: weeksBack }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + 7 * i);
    return { weekStart: dayKey(d), minutes: 0, count: 0 };
  });
  const dayMinutes = [0, 0, 0, 0, 0, 0, 0];
  const platforms = new Map<string, { minutes: number; count: number }>();
  let decisions = 0;
  let actionItems = 0;
  let actionItemsDone = 0;
  const shares: number[] = [];

  for (const m of inRange) {
    const start = new Date(m.startedAt);
    const mins = minutesOf(m);
    const w = weeks.find((x) => x.weekStart === dayKey(weekStart(start)));
    if (w) {
      w.minutes += mins;
      w.count += 1;
    }
    dayMinutes[(start.getDay() + 6) % 7] += mins;
    const key = m.platform;
    const p = platforms.get(key) ?? { minutes: 0, count: 0 };
    p.minutes += mins;
    p.count += 1;
    platforms.set(key, p);
    if (m.summary) {
      decisions += m.summary.decisions.length;
      actionItems += m.summary.actionItems.length;
      const done = new Set((m.doneActions ?? []).map(norm));
      actionItemsDone += m.summary.actionItems.filter((a) => done.has(norm(a.task))).length;
    }
    const talk = talkStats(m.speakerActivity);
    if (talk) shares.push(talk.youShare);
  }

  const total = { minutes: weeks.reduce((a, w) => a + w.minutes, 0), count: weeks.reduce((a, w) => a + w.count, 0) };
  const maxDay = Math.max(...dayMinutes);
  return {
    weeks,
    thisWeek: { minutes: weeks[weeks.length - 1].minutes, count: weeks[weeks.length - 1].count },
    lastWeek: weeks.length > 1 ? { minutes: weeks[weeks.length - 2].minutes, count: weeks[weeks.length - 2].count } : { minutes: 0, count: 0 },
    total,
    avgMinutes: total.count ? Math.round(total.minutes / total.count) : 0,
    busiestDay: maxDay > 0 ? dayMinutes.indexOf(maxDay) : null,
    byPlatform: [...platforms].map(([platform, v]) => ({ platform: platform as CallPlatform, ...v })).sort((a, b) => b.minutes - a.minutes),
    series: recurring(inRange),
    decisions,
    actionItems,
    actionItemsDone,
    talkShare: shares.length ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : null,
  };
}

/** Groups meetings that are the same series (same Meet code, the same title, or matching titles); keeps the ones held 2+ times. */
function recurring(meetings: Meeting[]): SeriesLoad[] {
  const groups: { code: string | null; title: string; items: Meeting[] }[] = [];
  const newestFirst = [...meetings].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const m of newestFirst) {
    const code = m.meetingCode?.toLowerCase() ?? meetCode(m.url);
    const title = !isPlaceholderTitle(m.title) ? m.title : m.summary?.title ?? "";
    const g = groups.find((x) => (code && x.code === code) || (!!title && !!x.title && (norm(title) === norm(x.title) || titlesMatch(title, x.title))));
    if (g) {
      g.items.push(m);
      if (!g.code && code) g.code = code;
    } else groups.push({ code, title, items: [m] });
  }
  return groups
    .filter((g) => g.items.length >= 2)
    .map((g) => ({ title: g.title || g.items[0].title, count: g.items.length, minutes: g.items.reduce((a, m) => a + minutesOf(m), 0), latestId: g.items[0].id }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count)
    .slice(0, 5);
}

export const hours = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`);

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
