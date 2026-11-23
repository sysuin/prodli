// Dates and repeat rules from other apps' exports → ProdLi's dueDate
// ("YYYY-MM-DD"), dueTime ("HH:MM") and Repeat. Anything that can't be mapped
// is reported back so the importer can keep the original text on the task.

import { getDayKey } from "../utils";
import { parseTask } from "../taskParse";
import type { Repeat } from "../../types";

export interface DateParse {
  dueDate?: string;
  dueTime?: string;
  repeat?: Repeat;
  /** A repeat rule ProdLi can't express ("every! 3 days", "every 2nd tuesday"): keep it as a note. */
  unmappedRepeat?: string;
  /** Text that wasn't understood as a date at all. */
  unparsed?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
const validDay = (y: number, m: number, d: number) => {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
};
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** "15:00", "3pm", "3:30 pm", "at 9am", "15:00:00" → "HH:MM". */
export function parseTime(s: string): string | undefined {
  const t = s.trim().replace(/^at\s+/i, "");
  if (!t) return undefined;
  let m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)$/i.exec(t);
  if (m) {
    const h = +m[1];
    if (h < 1 || h > 12 || +(m[2] ?? 0) > 59) return undefined;
    return `${pad((h % 12) + (m[3].toLowerCase().startsWith("p") ? 12 : 0))}:${m[2] ?? "00"}`;
  }
  m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`;
  return undefined;
}

/**
 * An ISO instant ("2024-01-15T09:00:00+0000", "…Z", "…+05:30") as a local day
 * and time — in `timeZone` (the task's own zone, e.g. TickTick's Timezone
 * column) when given and valid, otherwise in this device's zone.
 */
export function instantToLocal(iso: string, timeZone?: string): { date: string; time: string } | null {
  const norm = iso.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return null;
  if (timeZone) {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
          .formatToParts(d)
          .map((p) => [p.type, p.value]),
      );
      return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
    } catch {
      // unknown zone: fall through to the device's
    }
  }
  return { date: getDayKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Picks the year for "Nov 20" with no year: the one closest to today (overdue tasks stay overdue). */
function nearestYear(m: number, d: number, now: Date): number {
  const y = now.getFullYear();
  const candidates = [y - 1, y, y + 1].filter((yy) => validDay(yy, m, d));
  return candidates.sort((a, b) => Math.abs(new Date(a, m, d).getTime() - now.getTime()) - Math.abs(new Date(b, m, d).getTime() - now.getTime()))[0] ?? y;
}

/** A one-off date (with an optional time). Midnight counts as "no time". */
export function parseOneDate(raw: string, now = new Date()): { dueDate: string; dueTime?: string } | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const withTime = (date: string, rest: string | undefined) => {
    const time = rest ? parseTime(rest) : undefined;
    if (rest?.trim() && !time) return null;
    return { dueDate: date, ...(time && time !== "00:00" ? { dueTime: time } : {}) };
  };

  // ISO: 2024-11-20, 2024-11-20 15:00, 2024-11-20T15:00:00Z, 2024-11-20T15:00:00+0000
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (m) {
    if (m[5]) {
      const local = instantToLocal(s.replace(" ", "T"));
      if (!local) return null;
      return { dueDate: local.date, ...(local.time !== "00:00" ? { dueTime: local.time } : {}) };
    }
    if (!validDay(+m[1], +m[2] - 1, +m[3])) return null;
    return withTime(dayKey(+m[1], +m[2] - 1, +m[3]), m[4]?.replace(/\.\d+$/, ""));
  }
  // 2024/11/20
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(.+))?$/.exec(s);
  if (m) return validDay(+m[1], +m[2] - 1, +m[3]) ? withTime(dayKey(+m[1], +m[2] - 1, +m[3]), m[4]) : null;
  // 11/20/2024 (US) · 20/11/2024 (first number > 12) · 20.11.2024 (dots: day first)
  m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})(?:,?\s+(.+))?$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[3];
    const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    const dayFirst = m[2] === "." || a > 12;
    const [mo, d] = dayFirst ? [b, a] : [a, b];
    return validDay(y, mo - 1, d) ? withTime(dayKey(y, mo - 1, d), m[5]) : null;
  }
  // Month names: "Nov 20", "Nov 20 2024", "November 20, 2024 3pm", "20 Nov 2024 15:00", "Mon 20 Nov"
  const noWeekday = s.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, "");
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  m = new RegExp(`^${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?:,?\\s+(.+))?$`, "i").exec(noWeekday);
  let parts: { mo: number; d: number; y?: number; rest?: string } | null = m ? { mo: monthOf(m[1]), d: +m[2], y: m[3] ? +m[3] : undefined, rest: m[4] } : null;
  if (!parts) {
    m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon},?(?:\\s+(\\d{4}))?(?:,?\\s+(.+))?$`, "i").exec(noWeekday);
    if (m) parts = { mo: monthOf(m[2]), d: +m[1], y: m[3] ? +m[3] : undefined, rest: m[4] };
  }
  if (parts && parts.mo >= 0) {
    const y = parts.y ?? nearestYear(parts.mo, parts.d, now);
    return validDay(y, parts.mo, parts.d) ? withTime(dayKey(y, parts.mo, parts.d), parts.rest) : null;
  }
  // Last resort: the quick-add parser ("today", "tomorrow at 5pm", "next friday"…), only if it used every word.
  const p = parseTask(`§ ${s}`, now);
  if (p.title === "§" && p.dueDate && !p.repeat) return { dueDate: p.dueDate, ...(p.dueTime ? { dueTime: p.dueTime } : {}) };
  return null;
}

/**
 * A date as written in an export: one-off ("2024-11-20", "Nov 20 3pm") or
 * repeating ("every monday", "every 2 weeks starting Nov 20", "daily at 9am").
 */
export function parseDateText(raw: string, now = new Date()): DateParse {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return {};
  const repeating = /\b(every|daily|weekly|biweekly|fortnightly|monthly|yearly|annually|weekdays)\b|^ev(?:ery)?!/i.test(s);
  if (!repeating) {
    const one = parseOneDate(s, now);
    return one ?? { unparsed: s };
  }
  // "every!" / "after": repeats counted from completion, which ProdLi doesn't do. "until"/"for 3 times": an end ProdLi can't keep.
  if (/every!|ev!|\bafter\b|\buntil\b|\bending\b|\bfor\s+\d+\s+times\b/i.test(s)) return { unmappedRepeat: s };
  const split = /^(.*?)\s+(?:starting(?:\s+on)?|from|beginning|starts?)\s+(.+)$/i.exec(s);
  const rulePart = split ? split[1] : s;
  const p = parseTask(`§ ${rulePart}`, now);
  if (!p.repeat || p.title !== "§") return { unmappedRepeat: s };
  const repeat: Repeat = { ...p.repeat };
  let dueDate = p.dueDate;
  let dueTime = p.dueTime;
  if (split) {
    const start = parseOneDate(split[2], now);
    if (!start) return { unmappedRepeat: s };
    dueDate = start.dueDate;
    dueTime = dueTime ?? start.dueTime;
  }
  if ((repeat.unit === "month" || repeat.unit === "year") && dueDate) repeat.monthDay = +dueDate.slice(8, 10);
  return { repeat, ...(dueDate ? { dueDate } : {}), ...(dueTime ? { dueTime } : {}) };
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const RRULE_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"]);

/**
 * An iCalendar RRULE (TickTick, and others) → Repeat. Returns null for rules
 * ProdLi can't express (e.g. "2nd Tuesday", several month days, hourly).
 * COUNT and UNTIL (when it stops) are not kept.
 */
export function rruleToRepeat(rule: string, dueDate?: string): Repeat | null {
  const body = rule.trim().replace(/^RRULE:/i, "");
  if (!body) return null;
  const kv: Record<string, string> = {};
  for (const part of body.split(";")) {
    const [k, v = ""] = part.split("=");
    if (!k) continue;
    kv[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  for (const k of Object.keys(kv)) if (!RRULE_KEYS.has(k)) return null;
  const every = Math.max(1, Math.floor(+(kv.INTERVAL || "1")) || 1);
  const days = kv.BYDAY ? kv.BYDAY.split(",").filter(Boolean) : [];
  if (days.some((d) => !BYDAY.includes(d))) return null; // "2TU", "-1FR"
  switch (kv.FREQ) {
    case "DAILY":
      return days.length ? null : { unit: "day", every };
    case "WEEKLY":
      return days.length ? { unit: "week", every, weekdays: [...new Set(days.map((d) => BYDAY.indexOf(d)))].sort() } : { unit: "week", every };
    case "MONTHLY": {
      if (days.length) return null;
      const md = kv.BYMONTHDAY ? kv.BYMONTHDAY.split(",") : [];
      if (md.length > 1 || (md[0] && !(+md[0] >= 1 && +md[0] <= 31))) return null;
      const monthDay = md[0] ? +md[0] : dueDate ? +dueDate.slice(8, 10) : undefined;
      return { unit: "month", every, ...(monthDay ? { monthDay } : {}) };
    }
    case "YEARLY": {
      if (days.length) return null;
      const monthDay = dueDate ? +dueDate.slice(8, 10) : undefined;
      return { unit: "year", every, ...(monthDay ? { monthDay } : {}) };
    }
    default:
      return null;
  }
}
