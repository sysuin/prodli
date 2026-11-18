// Smart add: "Pay rent tomorrow !high" → title "Pay rent", due tomorrow, high
// priority. Understands:
//   dates      today · tomorrow (tmr) · monday…sunday (next one) · next week ·
//              in 3 days / in 2 weeks · Nov 20 / 20 Nov / November 20 · 2026-11-20
//   priority   !high !h !1 p1 · !med !m !2 p2 · !low !l !3 p3
//   plan       #today or ☀️ → planned for today
//   repeat     every day / daily · every weekday · every monday and thursday ·
//              every week / weekly · every 2 weeks / every other week ·
//              every month / monthly · every year / yearly · every 3 days
//   time       at 3pm · 3:30pm · 9am · at 15:00 · noon  (a reminder at that time)
//   list       #Work (an existing list, or a new one)   · label  @errands (any number)
// Words are only taken when they stand alone, and the parsed meaning is shown
// before saving, so nothing surprising happens.
import { getDayKey } from "./utils";
import { firstOccurrence, repeatLabel, timeLabel } from "./recurrence";
import type { Repeat } from "../types";

export interface ParsedTask {
  title: string;
  dueDate?: string;
  priority?: "high" | "medium" | "low";
  planToday?: boolean;
  repeat?: Repeat;
  /** "HH:MM" */
  dueTime?: string;
  /** "#Work" → "Work" (the caller finds or creates the list). */
  listName?: string;
  /** "@errands" → ["errands"] */
  labels?: string[];
  /** Human-readable bits that were understood, for the preview. */
  matched: string[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const label = (d: Date, now: Date) => {
  const diff = Math.round((addDays(d, 0).getTime() - addDays(now, 0).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric" });
};

export function parseTask(input: string, now = new Date()): ParsedTask {
  let text = ` ${input} `;
  const out: ParsedTask = { title: "", matched: [] };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = text.match(re);
    if (m && fn(m)) text = text.replace(m[0], " ");
  };
  const setDate = (d: Date) => {
    if (out.dueDate || Number.isNaN(d.getTime())) return false;
    out.dueDate = getDayKey(d);
    out.matched.push(`📅 ${label(d, now)}`);
    return true;
  };

  // Priority
  take(/\s(?:!(high|h|1)|p1)(?=\s)/i, () => ((out.priority = "high"), out.matched.push("High priority"), true));
  if (!out.priority) take(/\s(?:!(medium|med|m|2)|p2)(?=\s)/i, () => ((out.priority = "medium"), out.matched.push("Medium priority"), true));
  if (!out.priority) take(/\s(?:!(low|l|3)|p3)(?=\s)/i, () => ((out.priority = "low"), out.matched.push("Low priority"), true));
  // Plan for today
  take(/\s(?:#today|☀️|☀)(?=\s)/i, () => ((out.planToday = true), out.matched.push("☀️ Planned for today"), true));

  // Labels (@errands) and a list (#Work). "#today" is the plan-for-today shortcut above.
  for (let i = 0; i < 10; i++) {
    const before = text;
    take(/\s@([\p{L}][\p{L}\p{N}_-]{0,30})(?=\s)/u, (m) => {
      const l = m[1].toLowerCase();
      out.labels = [...new Set([...(out.labels ?? []), l])];
      return true;
    });
    if (text === before) break;
  }
  if (out.labels?.length) out.matched.push(out.labels.map((l) => `@${l}`).join(" "));
  take(/\s#([\p{L}][\p{L}\p{N}_-]{0,40})(?=\s)/u, (m) => {
    out.listName = m[1];
    out.matched.push(`📁 ${m[1]}`);
    return true;
  });

  // Repeat (before dates: "every monday" isn't a one-off Monday)
  const wdName = "(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?";
  const unitOf = (u: string): Repeat["unit"] => (u.toLowerCase().startsWith("d") ? "day" : u.toLowerCase().startsWith("w") ? "week" : u.toLowerCase().startsWith("m") ? "month" : "year");
  const setRepeat = (r: Repeat) => {
    if (out.repeat) return false;
    out.repeat = r;
    return true;
  };
  take(/\severy\s+other\s+(day|week|month|year)(?=\s)/i, (m) => setRepeat({ unit: unitOf(m[1]), every: 2 }));
  take(/\s(?:every\s+(?:weekday|workday|work\s+day)|on\s+weekdays|weekdays)(?=\s)/i, () => setRepeat({ unit: "week", every: 1, weekdays: [1, 2, 3, 4, 5] }));
  take(/\severy\s+(\d{1,2})\s+(days?|weeks?|months?|years?)(?=\s)/i, (m) => +m[1] > 0 && setRepeat({ unit: unitOf(m[2]), every: +m[1] }));
  take(new RegExp(`\\severy\\s+(${wdName}(?:\\s*(?:,|and|&)\\s*${wdName})*)(?=\\s)`, "i"), (m) => {
    const days = [...m[1].toLowerCase().matchAll(/(sun|mon|tue|wed|thu|fri|sat)/g)].map((x) => WEEKDAYS.findIndex((w) => w.startsWith(x[1])));
    return days.length > 0 && setRepeat({ unit: "week", every: 1, weekdays: [...new Set(days)].sort() });
  });
  take(/\severy\s+(day|week|month|year)(?=\s)/i, (m) => setRepeat({ unit: unitOf(m[1]), every: 1 }));
  take(/\s(daily|everyday|weekly|biweekly|fortnightly|monthly|yearly|annually)(?=\s)/i, (m) => {
    const w = m[1].toLowerCase();
    return setRepeat(w === "biweekly" || w === "fortnightly" ? { unit: "week", every: 2 } : { unit: w === "daily" || w === "everyday" ? "day" : w === "weekly" ? "week" : w === "monthly" ? "month" : "year", every: 1 });
  });

  // Time of day (a reminder at that time)
  const setTime = (h: number, min: number) => {
    if (out.dueTime || h > 23 || min > 59) return false;
    out.dueTime = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    return true;
  };
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s)/i, (m) => {
    const h = +m[1];
    if (h < 1 || h > 12) return false;
    const pm = m[3].toLowerCase().startsWith("p");
    return setTime((h % 12) + (pm ? 12 : 0), +(m[2] ?? 0));
  });
  take(/\s(?:at\s+)?(noon|midday)(?=\s)/i, () => setTime(12, 0));
  take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => setTime(+m[1], +m[2]));
  take(/\sat\s+(\d{1,2})(?=\s)/i, (m) => {
    const h = +m[1];
    if (h < 1 || h > 12) return false;
    return setTime(h < 8 ? h + 12 : h, 0); // "at 3" means 3 pm; "at 9" means 9 am
  });

  // Dates (first match wins)
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => setDate(new Date(+m[1], +m[2] - 1, +m[3])));
  take(/\s(?:on\s+|by\s+|due\s+)?(today|tod)(?=\s)/i, () => setDate(now));
  take(/\s(?:on\s+|by\s+|due\s+)?(tomorrow|tmrw?|tmr)(?=\s)/i, () => setDate(addDays(now, 1)));
  take(/\snext\s+week(?=\s)/i, () => setDate(addDays(now, ((8 - now.getDay()) % 7) || 7)));
  take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (m) => setDate(addDays(now, +m[1] * (m[2].toLowerCase().startsWith("week") ? 7 : 1))));
  // A bare weekday only counts at the end ("Lunch with Sam friday"), or after on/by/due/next,
  // so titles like "Read Monday Morning Leadership" stay as they are.
  const wd = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?";
  take(new RegExp(`\\s(?:(?:on|by|due|next)\\s+${wd}(?=\\s)|${wd}(?=\\s+$))`, "i"), (m) => {
    const name = (m[1] ?? m[2]).toLowerCase().slice(0, 3);
    const target = WEEKDAYS.findIndex((w) => w.startsWith(name));
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "friday" on a Friday means next Friday
    return setDate(addDays(now, diff));
  });
  const fromMonthDay = (mon: string, day: string) => {
    const mi = monthIndex(mon);
    if (mi < 0) return false;
    let d = new Date(now.getFullYear(), mi, +day);
    if (d.getMonth() !== mi) return false;
    if (d < addDays(now, 0)) d = new Date(now.getFullYear() + 1, mi, +day);
    return setDate(d);
  };
  const mon = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  take(new RegExp(`\\s(?:on\\s+|by\\s+|due\\s+)?${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, "i"), (m) => fromMonthDay(m[1], m[2]));
  take(new RegExp(`\\s(?:on\\s+|by\\s+|due\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}(?=\\s)`, "i"), (m) => fromMonthDay(m[2], m[1]));

  // A repeating task starts on its first day; a time with no date means today (or tomorrow if it has passed).
  if (out.repeat && !out.dueDate) out.dueDate = firstOccurrence(out.repeat, getDayKey(now));
  if (out.repeat && (out.repeat.unit === "month" || out.repeat.unit === "year") && out.dueDate) out.repeat.monthDay = +out.dueDate.slice(8, 10);
  if (out.dueTime && !out.dueDate) {
    const [h, m] = out.dueTime.split(":").map(Number);
    out.dueDate = getDayKey(h * 60 + m > now.getHours() * 60 + now.getMinutes() ? now : addDays(now, 1));
  }
  if (out.repeat) out.matched.push(`🔁 ${repeatLabel(out.repeat)}`);
  if (out.dueTime) out.matched.push(`⏰ ${timeLabel(out.dueTime)}`);
  if ((out.repeat || out.dueTime) && out.dueDate && !out.matched.some((x) => x.startsWith("📅"))) out.matched.unshift(`📅 ${label(new Date(`${out.dueDate}T12:00:00`), now)}`);

  out.title = text.replace(/\s+/g, " ").trim();
  // Never leave an empty title: if everything was a keyword, keep the text as typed.
  if (!out.title) return { title: input.trim(), matched: [] };
  return out;
}
