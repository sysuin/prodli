// Meeting prep: for today's upcoming calendar events, what ProdLi already knows
// from earlier meetings: the last time you met (summary, decisions, open
// questions), action items still open, and to-dos that mention the people.
//
// Everything runs on this device from data already here (calendar events and
// recorded meetings); nothing is sent anywhere. A past meeting matches an event
// by, in order of strength: the same Google Meet link (recurring meetings keep
// theirs), a matching title, or the same people (attendee names vs. the
// speakers in the transcript).

import type { CalendarEvent } from "./calendar";
import type { Meeting } from "../recorder/types";
import type { Todo } from "../types";

export type PrepMatch = "link" | "title" | "people";

export interface MeetingPrep {
  eventId: string;
  title: string;
  start: string | null;
  end: string | null;
  matchedBy: PrepMatch;
  /** How many earlier ProdLi meetings matched. */
  pastCount: number;
  last: { id: string; title: string; date: string; overview: string; decisions: string[]; openQuestions: string[] } | null;
  /** Action items from those meetings that aren't done. `todoId` when it's already a to-do. */
  openItems: { task: string; owner: string | null; due: string | null; meetingId: string; todoId?: string }[];
  /** Open to-dos that mention someone in the meeting. */
  relatedTasks: { id: string; title: string }[];
}

const LOOKBACK_DAYS = 120;
const MAX_ITEMS = 6;
const GENERIC = new Set(["meeting", "meet", "call", "sync", "chat", "with", "and", "the", "for", "weekly", "daily", "monthly", "catch", "up", "catchup", "google", "zoom", "teams", "video", "re", "a", "of", "on", "to"]);

/** "https://meet.google.com/abc-defg-hij?authuser=0" → "abc-defg-hij". */
export function meetCode(url: string | null | undefined): string | null {
  const m = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i.exec(url ?? "");
  return m ? m[1].toLowerCase() : null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Distinctive words of a title (generic words like "meeting" or "weekly" dropped). */
export function titleWords(title: string): Set<string> {
  return new Set(norm(title).split(" ").filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w)));
}

/** Same meeting by name: identical distinctive words, or most of them shared (and at least two). */
export function titlesMatch(a: string, b: string): boolean {
  if (/^google meet · /i.test(a) || /^google meet · /i.test(b)) return false;
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  if (shared === x.size && shared === y.size) return true;
  return shared >= 2 && shared / Math.max(x.size, y.size) >= 0.6;
}

/** A person's first name, from a display name or an email ("priya.shah@x.com" → "priya"). */
export function firstName(p: { name?: string; email?: string }): string | null {
  const raw = p.name?.trim() || p.email?.split("@")[0]?.replace(/[._+-]+/g, " ") || "";
  const first = norm(raw).split(" ")[0] ?? "";
  return first.length >= 3 && !/\d/.test(first) ? first : null;
}

/** First names of the people who spoke in a meeting ("You" excluded). */
export function speakerNames(m: Meeting): Set<string> {
  const names = new Set<string>();
  for (const e of m.transcript ?? []) {
    const n = firstName({ name: e.speaker });
    if (n && n !== "you" && n !== "unknown" && n !== "speaker") names.add(n);
  }
  return names;
}

/** How an event and a past meeting match, if they do. */
export function matchMeeting(event: CalendarEvent, m: Meeting): PrepMatch | null {
  // Filed under this event, or another in its series, when it was recorded (lib/calendarLink.ts).
  if (m.calendarEvent && (m.calendarEvent.id === event.id || m.calendarEvent.id.split("_")[0] === event.id.split("_")[0])) return "link";
  const code = meetCode(event.meetLink);
  if (code && (m.meetingCode?.toLowerCase() === code || meetCode(m.url) === code)) return "link";
  if (titlesMatch(event.title, m.title) || (m.summary?.title && titlesMatch(event.title, m.summary.title))) return "title";
  const people = [...new Set((event.attendees ?? []).map(firstName).filter((n): n is string => !!n))];
  if (people.length) {
    const spoke = speakerNames(m);
    const shared = people.filter((n) => spoke.has(n)).length;
    if (shared >= Math.min(2, people.length)) return "people";
  }
  return null;
}

const RANK: Record<PrepMatch, number> = { link: 3, title: 2, people: 1 };

/** Pure: prep for each of today's timed events that hasn't ended and has some history. */
export function buildPrep(events: CalendarEvent[], meetings: Meeting[], todos: Todo[], now = new Date()): MeetingPrep[] {
  const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const since = now.getTime() - LOOKBACK_DAYS * 86_400_000;
  const past = meetings
    .filter((m) => m.status === "ready" && new Date(m.startedAt).getTime() >= since && new Date(m.startedAt).getTime() < now.getTime())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byTitle = new Map<string, Todo>();
  for (const t of todos) {
    const k = norm(t.title);
    const prev = byTitle.get(k);
    // An open to-do wins over a done one with the same title.
    if (!prev || (prev.completed && !t.completed)) byTitle.set(k, t);
  }
  const open = todos.filter((t) => !t.completed);

  const out: MeetingPrep[] = [];
  for (const e of events) {
    if (e.allDay || !e.start || (e.end ?? e.start) <= nowHM) continue;
    const matches = past.map((m) => ({ m, how: matchMeeting(e, m) })).filter((x): x is { m: Meeting; how: PrepMatch } => !!x.how);
    if (!matches.length && !(e.attendees ?? []).length) continue;
    const best = matches.reduce<PrepMatch | null>((b, x) => (!b || RANK[x.how] > RANK[b] ? x.how : b), null);
    // Keep the strongest kind of match only (a recurring link beats a shared first name).
    const used = best ? matches.filter((x) => x.how === best).map((x) => x.m) : [];
    const lastWithSummary = used.find((m) => m.summary);

    const seen = new Set<string>();
    const openItems: MeetingPrep["openItems"] = [];
    for (const m of used.slice(0, 5)) {
      for (const a of m.summary?.actionItems ?? []) {
        const k = norm(a.task);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const todo = byTitle.get(k);
        if (todo?.completed) continue;
        openItems.push({ task: a.task, owner: a.owner, due: a.dueDate, meetingId: m.id, todoId: todo?.id });
      }
    }

    const people = [...new Set((e.attendees ?? []).map(firstName).filter((n): n is string => !!n))];
    const linked = new Set(openItems.map((i) => i.todoId).filter(Boolean));
    const relatedTasks = people.length
      ? open
          .filter((t) => !linked.has(t.id) && people.some((n) => new RegExp(`(^|[^\\p{L}])${n}([^\\p{L}]|$)`, "u").test(norm(t.title))))
          .slice(0, 4)
          .map((t) => ({ id: t.id, title: t.title }))
      : [];

    if (!lastWithSummary && !openItems.length && !relatedTasks.length) continue;
    out.push({
      eventId: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      matchedBy: best ?? "people",
      pastCount: used.length,
      last: lastWithSummary
        ? {
            id: lastWithSummary.id,
            title: lastWithSummary.summary!.title || lastWithSummary.title,
            date: lastWithSummary.startedAt,
            overview: lastWithSummary.summary!.overview,
            decisions: lastWithSummary.summary!.decisions.slice(0, 3),
            openQuestions: lastWithSummary.summary!.openQuestions.slice(0, 3),
          }
        : null,
      openItems: openItems.slice(0, MAX_ITEMS),
      relatedTasks,
    });
  }
  return out.slice(0, 8);
}

/** "12 Nov" style, or "yesterday"/"today". */
export function metLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** What "✨ Prep with AI" sends (server: prodli-api/src/prep.ts PrepInputSchema). Null without a past meeting. */
export function aiPrepInput(p: MeetingPrep, today: string) {
  if (!p.last) return null;
  return {
    event: { title: p.title.slice(0, 300), ...(p.start ? { start: p.start } : {}), date: today },
    history: [
      {
        title: p.last.title.slice(0, 300),
        date: p.last.date.slice(0, 10),
        overview: p.last.overview.slice(0, 2000),
        decisions: p.last.decisions.slice(0, 10).map((d) => d.slice(0, 400)),
        openItems: p.openItems.slice(0, 15).map((i) => ({ task: i.task.slice(0, 300), owner: i.owner?.slice(0, 120) ?? null })),
        openQuestions: p.last.openQuestions.slice(0, 10).map((q) => q.slice(0, 400)),
      },
    ],
    relatedTasks: p.relatedTasks.slice(0, 10).map((t) => t.title.slice(0, 300)),
  };
}

export interface AiPrep {
  goal: string;
  recap: string;
  followUps: string[];
  questions: string[];
  agenda: string[];
}

/**
 * Earlier meetings in the same series as `m` (Pro: "Earlier in this series"):
 * the same Meet code, or a matching title. Newest first, at most `max`.
 */
export function meetingSeries(m: Meeting, meetings: Meeting[], max = 6): Meeting[] {
  const code = m.meetingCode?.toLowerCase() ?? meetCode(m.url);
  const names = [m.title, m.summary?.title].filter((x): x is string => !!x);
  return meetings
    .filter((o) => o.id !== m.id && o.startedAt < m.startedAt && o.status !== "recording")
    .filter((o) => (code && (o.meetingCode?.toLowerCase() === code || meetCode(o.url) === code)) || names.some((n) => titlesMatch(n, o.title) || (!!o.summary?.title && titlesMatch(n, o.summary.title))))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, max);
}
