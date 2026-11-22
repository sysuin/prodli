// Growth numbers for the founder, built only from data ProdLi already keeps to
// run the service (accounts, sessions, monthly AI usage counts, share links,
// subscriptions), plus the anonymous uninstall survey. Nothing here reads notes,
// meetings or any other content, and the report has counts only: no emails,
// names or user ids.

import { AI_MONTHLY_LIMIT } from "./ai";

export const UNINSTALL_REASONS = ["not_using", "missing_feature", "meeting_notes", "too_complex", "bugs", "privacy", "switched", "other"] as const;
export type UninstallReason = (typeof UNINSTALL_REASONS)[number];

const MAX_DETAILS = 500;
const VERSION = /^\d{1,3}(\.\d{1,4}){0,3}$/;

export type UninstallFeedback = { reason: UninstallReason; details: string; version: string };

/** Checks and trims an answer from prodli.com/goodbye; null when it isn't one. */
export function parseUninstallFeedback(body: unknown): UninstallFeedback | null {
  if (!body || typeof body !== "object") return null;
  const { reason, details, version } = body as Record<string, unknown>;
  if (typeof reason !== "string" || !(UNINSTALL_REASONS as readonly string[]).includes(reason)) return null;
  const text = typeof details === "string" ? details.replace(/\s+/g, " ").trim().slice(0, MAX_DETAILS) : "";
  const v = typeof version === "string" && VERSION.test(version) ? version : "";
  return { reason: reason as UninstallReason, details: text, version: v };
}

/** Answers are kept for 2 years (privacy policy, "How long we keep data"). */
export const UNINSTALL_FEEDBACK_DAYS = 730;

export async function pruneUninstallFeedback(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM uninstall_feedback WHERE created_at < ?").bind(now - UNINSTALL_FEEDBACK_DAYS * 86_400_000).run();
}

export async function saveUninstallFeedback(db: D1Database, f: UninstallFeedback, now: number): Promise<void> {
  await db.prepare("INSERT INTO uninstall_feedback (reason, details, version, created_at) VALUES (?, ?, ?, ?)").bind(f.reason, f.details, f.version, now).run();
}

const DAY = 86_400_000;
const month = (t: number) => new Date(t).toISOString().slice(0, 7);
/** Monday 00:00 UTC of the week containing t. */
const weekStart = (t: number) => {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
};

export interface FunnelReport {
  generatedAt: string;
  accounts: { total: number; last7Days: number; last30Days: number; activeLast7Days: number; activeLast30Days: number };
  /** New accounts per week (Monday, UTC), oldest first, the last 12 weeks. */
  signupsByWeek: { week: string; accounts: number }[];
  /** Accounts with a live session on each kind of app. */
  surfaces: Record<"extension" | "web" | "mobile" | "desktop", number>;
  meetings: {
    /** Accounts that have ever had an AI meeting summary. */
    everSummarized: number;
    thisMonth: { month: string; accountsWithSummary: number; summaries: number; freeAccountsAtLimit: number };
    lastMonth: { month: string; accountsWithSummary: number; summaries: number };
  };
  shares: { links: number; createdLast30Days: number; views: number };
  pro: { active: number; monthly: number; yearly: number; cancelling: number; checkoutsStarted: number };
  uninstalls: { last90Days: number; byReason: Record<string, number>; recentDetails: { at: string; reason: string; details: string; version: string }[] };
}

/** The founder's funnel report (GET /api/admin/funnel). Counts only. */
export async function funnelReport(db: D1Database, now: number): Promise<FunnelReport> {
  const num = async (sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);
  const thisMonth = month(now);
  const lastMonth = month(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 15));
  const firstWeek = weekStart(now) - 11 * 7 * DAY;

  const [total, last7, last30, active7, active30] = await Promise.all([
    num("SELECT COUNT(*) AS n FROM users"),
    num("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", now - 7 * DAY),
    num("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", now - 30 * DAY),
    num("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", now - 7 * DAY),
    num("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", now - 30 * DAY),
  ]);

  const created = await db.prepare("SELECT created_at FROM users WHERE created_at >= ?").bind(firstWeek).all<{ created_at: number }>();
  const weeks = Array.from({ length: 12 }, (_, i) => firstWeek + i * 7 * DAY);
  const perWeek = new Map(weeks.map((w) => [w, 0]));
  for (const r of created.results ?? []) {
    const w = weekStart(r.created_at);
    if (perWeek.has(w)) perWeek.set(w, perWeek.get(w)! + 1);
  }

  const surfaceRows = await db
    .prepare("SELECT client, COUNT(DISTINCT user_id) AS n FROM sessions WHERE expires_at > ? GROUP BY client")
    .bind(now)
    .all<{ client: string; n: number }>();
  const surfaces = { extension: 0, web: 0, mobile: 0, desktop: 0 };
  for (const r of surfaceRows.results ?? []) if (r.client in surfaces) surfaces[r.client as keyof typeof surfaces] = Number(r.n);

  const usage = async (m: string) =>
    ((await db.prepare("SELECT COUNT(*) AS accounts, COALESCE(SUM(count), 0) AS summaries FROM ai_usage WHERE month = ? AND count > 0").bind(m).first()) as { accounts: number; summaries: number } | null) ?? {
      accounts: 0,
      summaries: 0,
    };
  const [everSummarized, nowUsage, prevUsage, atLimit] = await Promise.all([
    num("SELECT COUNT(DISTINCT user_id) AS n FROM ai_usage WHERE count > 0"),
    usage(thisMonth),
    usage(lastMonth),
    num("SELECT COUNT(*) AS n FROM ai_usage a JOIN users u ON u.id = a.user_id WHERE a.month = ? AND a.count >= ? AND u.plan = 'free'", thisMonth, AI_MONTHLY_LIMIT.free),
  ]);

  const [links, linksRecent, views] = await Promise.all([
    num("SELECT COUNT(*) AS n FROM shares"),
    num("SELECT COUNT(*) AS n FROM shares WHERE created_at >= ?", now - 30 * DAY),
    num("SELECT COALESCE(SUM(views), 0) AS n FROM shares"),
  ]);

  const live = "status IN ('active', 'past_due')";
  const [proActive, proMonthly, proYearly, cancelling, checkouts] = await Promise.all([
    num(`SELECT COUNT(*) AS n FROM subscriptions WHERE ${live}`),
    num(`SELECT COUNT(*) AS n FROM subscriptions WHERE ${live} AND billing_interval = 'month'`),
    num(`SELECT COUNT(*) AS n FROM subscriptions WHERE ${live} AND billing_interval = 'year'`),
    num(`SELECT COUNT(*) AS n FROM subscriptions WHERE ${live} AND cancel_at IS NOT NULL`),
    num("SELECT COUNT(*) AS n FROM billing_customers"),
  ]);

  const since90 = now - 90 * DAY;
  const reasons = await db
    .prepare("SELECT reason, COUNT(*) AS n FROM uninstall_feedback WHERE created_at >= ? GROUP BY reason ORDER BY n DESC")
    .bind(since90)
    .all<{ reason: string; n: number }>();
  const recent = await db
    .prepare("SELECT reason, details, version, created_at FROM uninstall_feedback WHERE created_at >= ? AND details != '' ORDER BY created_at DESC LIMIT 25")
    .bind(since90)
    .all<{ reason: string; details: string; version: string; created_at: number }>();
  const byReason: Record<string, number> = {};
  let uninstalls = 0;
  for (const r of reasons.results ?? []) {
    byReason[r.reason] = Number(r.n);
    uninstalls += Number(r.n);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    accounts: { total, last7Days: last7, last30Days: last30, activeLast7Days: active7, activeLast30Days: active30 },
    signupsByWeek: weeks.map((w) => ({ week: new Date(w).toISOString().slice(0, 10), accounts: perWeek.get(w)! })),
    surfaces,
    meetings: {
      everSummarized,
      thisMonth: { month: thisMonth, accountsWithSummary: Number(nowUsage.accounts), summaries: Number(nowUsage.summaries), freeAccountsAtLimit: atLimit },
      lastMonth: { month: lastMonth, accountsWithSummary: Number(prevUsage.accounts), summaries: Number(prevUsage.summaries) },
    },
    shares: { links, createdLast30Days: linksRecent, views },
    pro: { active: proActive, monthly: proMonthly, yearly: proYearly, cancelling, checkoutsStarted: checkouts },
    uninstalls: {
      last90Days: uninstalls,
      byReason,
      recentDetails: (recent.results ?? []).map((r) => ({ at: new Date(r.created_at).toISOString().slice(0, 10), reason: r.reason, details: r.details, version: r.version })),
    },
  };
}
