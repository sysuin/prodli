// Focus blocking: distracting sites are blocked on a schedule and while a
// Pomodoro focus session runs. A blocked tab is sent to ProdLi's pause page
// (index.html#blocked), which has a big "Close tab" button and a slow
// "Continue anyway" (wait 10 s, then 5 minutes allowed). Uses the existing
// `tabs` permission only: no access to page content, no network rules.

export interface BlockSchedule {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** "HH:MM"; if end is before start the window runs past midnight. */
  start: string;
  end: string;
}

export interface FocusBlockSettings {
  enabled: boolean;
  /** Domains like "youtube.com" (subdomains included). */
  sites: string[];
  schedules: BlockSchedule[];
  duringPomodoro: boolean;
  /** No "Continue anyway", and blocking can't be loosened while it's on. */
  strict?: boolean;
}

export type BlockReason = "pomodoro" | "schedule" | "limit";

export const FOCUS_BLOCK_KEY = "focusBlock";
/** chrome.storage.session: domain → allowed until (ms), from "Continue anyway". */
export const FOCUS_PASSES_KEY = "focusPasses";
/** chrome.storage.local: day → domain → times the pause page was shown. */
export const FOCUS_STATS_KEY = "focusBlockStats";
export const PASS_MINUTES = 5;
export const WAIT_SECONDS = 10;

export const DEFAULT_FOCUS_BLOCK: FocusBlockSettings = {
  enabled: false,
  sites: [],
  schedules: [],
  duringPomodoro: true,
};

export const SUGGESTED_SITES = ["youtube.com", "x.com", "reddit.com", "instagram.com", "facebook.com", "tiktok.com", "netflix.com", "news.ycombinator.com"];

/** "https://www.YouTube.com/watch?v=1" → "youtube.com"; null if it isn't a site. */
export function normalizeSite(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** Does `domain` (e.g. "m.youtube.com") fall under `site` ("youtube.com")? */
export const siteMatches = (domain: string, site: string) => domain === site || domain.endsWith(`.${site}`);

export function domainOf(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The schedule that's on at `now`, if any. */
export function activeSchedule(schedules: BlockSchedule[], now = new Date()): BlockSchedule | null {
  const day = now.getDay();
  const yesterday = (day + 6) % 7;
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const s of schedules) {
    const a = minutes(s.start);
    const b = minutes(s.end);
    if (a === b) continue;
    if (a < b ? s.days.includes(day) && cur >= a && cur < b : (s.days.includes(day) && cur >= a) || (s.days.includes(yesterday) && cur < b)) return s;
  }
  return null;
}

export interface BlockContext {
  now?: Date;
  /** A Pomodoro focus (work) phase is running. */
  pomodoroFocus: boolean;
  /** Sites whose daily Time Tracker limit is used up and set to redirect. */
  limitReached?: string[];
  passes?: Record<string, number>;
}

/** Why `domain` is blocked right now, or null. */
export function blockReason(domain: string | null, s: FocusBlockSettings, ctx: BlockContext): BlockReason | null {
  if (!domain) return null;
  const now = ctx.now ?? new Date();
  const pass = Object.entries(ctx.passes ?? {}).find(([site]) => siteMatches(domain, site));
  if (pass && pass[1] > now.getTime()) return null;
  if (ctx.limitReached?.some((site) => siteMatches(domain, site))) return "limit";
  if (!s.enabled || !s.sites.some((site) => siteMatches(domain, site))) return null;
  if (s.duringPomodoro && ctx.pomodoroFocus) return "pomodoro";
  if (activeSchedule(s.schedules, now)) return "schedule";
  return null;
}

/** Is blocking on at all right now (for the status line)? */
export function blockingNow(s: FocusBlockSettings, pomodoroFocus: boolean, now = new Date()): BlockReason | null {
  if (!s.enabled || !s.sites.length) return null;
  if (s.duringPomodoro && pomodoroFocus) return "pomodoro";
  return activeSchedule(s.schedules, now) ? "schedule" : null;
}

export function pausePageUrl(base: string, url: string, reason: BlockReason): string {
  return `${base}#blocked?u=${encodeURIComponent(url)}&r=${reason}`;
}

export function parsePausePage(hash: string): { url: string; domain: string; reason: BlockReason } | null {
  if (!hash.startsWith("#blocked")) return null;
  const p = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const url = p.get("u") ?? "";
  const domain = domainOf(url);
  const r = p.get("r");
  if (!domain || (r !== "pomodoro" && r !== "schedule" && r !== "limit")) return null;
  return { url, domain, reason: r };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function scheduleLabel(s: BlockSchedule): string {
  const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const d = days.join(",") === "1,2,3,4,5" ? "Weekdays" : days.length === 7 ? "Every day" : days.map((x) => DAY_NAMES[x]).join(", ");
  return `${d} ${s.start}–${s.end}`;
}
