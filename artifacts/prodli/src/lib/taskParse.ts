// Smart add: "Pay rent tomorrow !high" → title "Pay rent", due tomorrow, high
// priority. Understands:
//   dates      today · tomorrow (tmr) · monday…sunday (next one) · next week ·
//              in 3 days / in 2 weeks · Nov 20 / 20 Nov / November 20 · 2026-11-20
//   priority   !high !h !1 p1 · !med !m !2 p2 · !low !l !3 p3
//   plan       #today or ☀️ → planned for today
// Words are only taken when they stand alone, and the parsed meaning is shown
// before saving, so nothing surprising happens.
import { getDayKey } from "./utils";

export interface ParsedTask {
  title: string;
  dueDate?: string;
  priority?: "high" | "medium" | "low";
  planToday?: boolean;
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

  out.title = text.replace(/\s+/g, " ").trim();
  // Never leave an empty title: if everything was a keyword, keep the text as typed.
  if (!out.title) return { title: input.trim(), matched: [] };
  return out;
}
