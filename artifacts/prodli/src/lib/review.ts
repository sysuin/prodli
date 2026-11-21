// Weekly review: what got done this week, what slipped, how habits and focus
// went, where browsing time went — and, when signed in, a short AI write-up
// with priorities for next week (server: /api/ai/review, counted with briefs).
//
// Weeks run Monday–Sunday. The review is saved on the week's Monday day
// record (DayRecord.review), so it syncs like everything else.

import { SITE_CATEGORIES_KEY } from "./siteCategories";
import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet, storageGetAll } from "./storage";
import { getDayKey } from "./utils";
import { DAYS_KEY } from "./today";
import type { DayRecord, Habit, Note, Todo, WeeklyReview } from "../types";
import { basicReview, reviewContext, weekDays, weekStats, type WeekStats } from "./reviewCore";
export * from "./reviewCore";
import type { Meeting } from "../recorder/types";

/** Gathers the week's data from this device. */
export async function loadWeekStats(start: string, today = getDayKey()): Promise<WeekStats> {
  const [todos, habits, days, sessions, notes, siteCategories, all] = await Promise.all([
    storageGet<Todo[]>("todos", []),
    storageGet<Habit[]>("habits", []),
    storageGet<DayRecord[]>(DAYS_KEY, []),
    storageGet<{ completedAt: string; duration?: number }[]>("pomodoroSessions", []),
    storageGet<Note[]>("notes", []),
    storageGet<Record<string, string>>(SITE_CATEGORIES_KEY, {}),
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
  return weekStats({ start, today, todos, habits, days, sessions, tracking, meetings, notes: notes.filter((n) => !n.template), siteCategories });
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
