// The read-only personal API: what /api/v1/* and the MCP server (src/mcp.ts)
// return from a user's synced data (their UserStore). Nothing here writes.
//
// Items are whatever the user's devices synced (shapes in artifacts/prodli
// src/types.ts and src/recorder/types.ts), so every field is checked before
// it's used. Deleted items are tombstones in the store (d = 1) and never read.

import type { CollectionName } from "./syncStore";

/** Reads live items of one collection (UserStore.readLive). */
export type Reader = (c: CollectionName, opts?: { id?: string; drop?: string[] }) => Promise<unknown[]>;

// ── Arguments ────────────────────────────────────────────────────────────────
// One JSON Schema per operation, shared by the REST routes and the MCP tools
// (which publish it as the tool's inputSchema). check() validates against it.

type Prop =
  | { type: "string"; description: string; enum?: string[]; pattern?: string; maxLength?: number; default?: string }
  | { type: "integer"; description: string; minimum: number; maximum: number; default: number }
  | { type: "boolean"; description: string; default: boolean };
export interface ArgSchema {
  type: "object";
  properties: Record<string, Prop>;
  required?: string[];
  additionalProperties: false;
}

const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const day = (description: string): Prop => ({ type: "string", description, pattern: DAY_PATTERN, maxLength: 10 });
const timezone: Prop = { type: "string", description: "IANA time zone, e.g. \"America/New_York\". Decides what \"today\" is. Default: UTC.", maxLength: 64 };
const limit = (def: number, max: number): Prop => ({ type: "integer", description: `Most results to return (1–${max}).`, minimum: 1, maximum: max, default: def });
const id = (what: string): Prop => ({ type: "string", description: `The ${what}'s id (from the list results).`, maxLength: 200 });

export const SCHEMAS = {
  list_todos: {
    type: "object",
    properties: {
      status: { type: "string", description: "open (default), done, or all.", enum: ["open", "done", "all"], default: "open" },
      list: { type: "string", description: "Only this list (its name or id). \"inbox\" = to-dos without a list.", maxLength: 100 },
      label: { type: "string", description: "Only to-dos with this label (without the @).", maxLength: 60 },
      limit: limit(100, 500),
    },
    additionalProperties: false,
  },
  search_notes: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for in titles and text. Empty = most recent notes.", maxLength: 200 },
      limit: limit(20, 100),
    },
    additionalProperties: false,
  },
  get_note: { type: "object", properties: { id: id("note") }, required: ["id"], additionalProperties: false },
  list_meetings: {
    type: "object",
    properties: { since: day("Only meetings on or after this day (YYYY-MM-DD)."), limit: limit(20, 100) },
    additionalProperties: false,
  },
  get_meeting: {
    type: "object",
    properties: { id: id("meeting"), transcript: { type: "boolean", description: "Include the full transcript (can be long).", default: false } },
    required: ["id"],
    additionalProperties: false,
  },
  get_today: { type: "object", properties: { date: day("The day to show (YYYY-MM-DD). Default: today in `timezone`."), timezone }, additionalProperties: false },
  list_habits: {
    type: "object",
    properties: {
      date: day("The day to report on (YYYY-MM-DD). Default: today in `timezone`."),
      timezone,
      include_archived: { type: "boolean", description: "Also list archived habits.", default: false },
    },
    additionalProperties: false,
  },
} satisfies Record<string, ArgSchema>;
export type Operation = keyof typeof SCHEMAS;

export class ArgError extends Error {}

/** Validates (and fills defaults for) `raw` against an operation's schema. Throws ArgError. */
export function check(op: Operation, raw: unknown): Record<string, string | number | boolean | undefined> {
  const schema: ArgSchema = SCHEMAS[op];
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ArgError("arguments must be an object");
  const input = raw as Record<string, unknown>;
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const key of Object.keys(input)) if (!(key in schema.properties)) throw new ArgError(`unknown argument "${key}"`);
  for (const [key, p] of Object.entries(schema.properties)) {
    let v = input[key];
    if (v === undefined || v === null || v === "") {
      if (schema.required?.includes(key)) throw new ArgError(`"${key}" is required`);
      out[key] = "default" in p ? p.default : undefined;
      continue;
    }
    if (p.type === "integer") {
      if (typeof v === "string" && /^-?\d+$/.test(v)) v = Number(v);
      if (typeof v !== "number" || !Number.isInteger(v) || v < p.minimum || v > p.maximum) throw new ArgError(`"${key}" must be a whole number from ${p.minimum} to ${p.maximum}`);
    } else if (p.type === "boolean") {
      if (v === "true" || v === "1") v = true;
      else if (v === "false" || v === "0") v = false;
      if (typeof v !== "boolean") throw new ArgError(`"${key}" must be true or false`);
    } else {
      if (typeof v !== "string") throw new ArgError(`"${key}" must be a string`);
      v = v.trim();
      if (p.maxLength !== undefined && (v as string).length > p.maxLength) throw new ArgError(`"${key}" is too long (max ${p.maxLength} characters)`);
      if (p.enum && !p.enum.includes(v as string)) throw new ArgError(`"${key}" must be one of: ${p.enum.join(", ")}`);
      if (p.pattern && !new RegExp(p.pattern).test(v as string)) throw new ArgError(`"${key}" must look like YYYY-MM-DD`);
    }
    out[key] = v as string | number | boolean;
  }
  return out;
}

// ── Small helpers ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === "string" && x ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
const isDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);

/** Is this a time zone the runtime knows? */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" of `at` in `tz`. */
export function dayIn(at: number | string, tz = "UTC"): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "0000-00-00";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const shift = (d: string, n: number) => new Date(utc(d) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(utc(d)).getUTCDay();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The day asked for, or today in the time zone. Throws ArgError for an unknown zone. */
export function resolveDay(date: unknown, tz: unknown, now: number): { date: string; timezone: string } {
  const zone = typeof tz === "string" && tz ? tz : "UTC";
  if (!validTimeZone(zone)) throw new ArgError(`unknown time zone "${zone}"`);
  return { date: isDay(date) ? date : dayIn(now, zone), timezone: zone };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/**
 * A note's HTML (from the Editor) as readable, Markdown-ish plain text:
 * headings (#), lists (-), checklists (- [x]), links "text (url)", tables (| a | b |).
 * Text without tags is returned as it is.
 */
export function htmlToText(html: string): string {
  if (!/<[a-z!/][^>]*>/i.test(html)) return html.trim();
  let s = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<colgroup\b[\s\S]*?<\/colgroup>/gi, "");
  // Tables: one line per row.
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]).replace(/\|/g, "/"));
    return `\n| ${cells.join(" | ")} |`;
  });
  s = s
    .replace(/<li\b[^>]*data-checked="(true|false)"[^>]*>/gi, (_m, c: string) => `\n- [${c === "true" ? "x" : " "}] `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    // The Editor wraps list text in <label><input></label><div><p>…; keep it on the bullet's line.
    .replace(/(\n- (?:\[[ x]\] )?)(?:\s*<(?:p|div|label|span|input)\b[^>]*>|\s*<\/(?:label|span)>)+/gi, "$1")
    .replace(/(?:\s*<\/(?:p|div|label|span)>)*\s*<\/li>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const text = stripTags(inner).replace(/^↗\s*/, "");
      const url = decodeEntities(href);
      return /^https?:\/\//i.test(url) && text && text !== url ? `${text} (${url})` : text || url;
    })
    .replace(/<\/?(?:p|div|ul|ol|blockquote|pre|table|tbody|thead|section|article|details|summary|figure)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── To-dos ───────────────────────────────────────────────────────────────────

export interface TodoOut {
  id: string;
  title: string;
  completed: boolean;
  priority: "high" | "medium" | "low" | null;
  dueDate: string | null;
  dueTime: string | null;
  list: string | null;
  labels: string[];
  plannedFor: string | null;
  estimateMin: number | null;
  timeBlock: { day: string; start: string } | null;
  subtasks: { title: string; completed: boolean }[];
  repeats: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

interface ListRef {
  id: string;
  name: string;
}

async function readLists(read: Reader): Promise<ListRef[]> {
  return (await read("lists"))
    .filter(isObj)
    .filter((l) => l.kind === "list" && str(l.id) && str(l.name))
    .map((l) => ({ id: l.id as string, name: l.name as string }));
}

function repeatLabel(r: unknown): string | null {
  if (!isObj(r) || !["day", "week", "month", "year"].includes(r.unit as string)) return null;
  const every = num(r.every) && (r.every as number) > 1 ? (r.every as number) : 1;
  const unit = r.unit as string;
  const base = every === 1 ? { day: "daily", week: "weekly", month: "monthly", year: "yearly" }[unit]! : `every ${every} ${unit}s`;
  const days = Array.isArray(r.weekdays) ? r.weekdays.filter((d): d is number => typeof d === "number" && d >= 0 && d < 7) : [];
  return unit === "week" && days.length ? `${base} on ${days.map((d) => WEEKDAYS[d]).join(", ")}` : base;
}

function toTodo(t: Obj, lists: Map<string, string>): TodoOut {
  const priority = t.priority === "high" || t.priority === "medium" || t.priority === "low" ? t.priority : null;
  const block = isObj(t.block) && isDay(t.block.day) && typeof t.block.start === "string" ? { day: t.block.day, start: t.block.start } : null;
  return {
    id: t.id as string,
    title: str(t.title) ?? "(untitled)",
    completed: t.completed === true,
    priority,
    dueDate: isDay(t.dueDate) ? t.dueDate : null,
    dueTime: str(t.dueTime) ?? null,
    list: (str(t.listId) && lists.get(t.listId as string)) || null,
    labels: strs(t.labels),
    plannedFor: isDay(t.plannedFor) ? t.plannedFor : null,
    estimateMin: num(t.estimateMin) ?? null,
    timeBlock: block,
    subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).filter(isObj).map((s) => ({ title: str(s.title) ?? "", completed: s.completed === true })),
    repeats: repeatLabel(t.repeat),
    completedAt: str(t.completedAt) ?? null,
    createdAt: str(t.createdAt) ?? null,
  };
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const openOrder = (a: TodoOut, b: TodoOut) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
  (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") ||
  (a.priority ? PRIORITY_RANK[a.priority] : 3) - (b.priority ? PRIORITY_RANK[b.priority] : 3) ||
  (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
  a.title.localeCompare(b.title);

async function readTodos(read: Reader): Promise<{ todos: TodoOut[]; raw: Obj[]; lists: ListRef[] }> {
  const [items, lists] = await Promise.all([read("todos"), readLists(read)]);
  const names = new Map(lists.map((l) => [l.id, l.name]));
  const raw = items.filter(isObj).filter((t) => str(t.id));
  return { todos: raw.map((t) => toTodo(t, names)), raw, lists };
}

export type TodoList = { todos: TodoOut[]; total: number; status: string; list: string | null };

export async function listTodos(read: Reader, args: Record<string, unknown>): Promise<TodoList> {
  const { todos, raw, lists } = await readTodos(read);
  const status = (args.status as string) ?? "open";
  let pick = todos.filter((t) => (status === "all" ? true : status === "done" ? t.completed : !t.completed));
  let listName: string | null = null;
  const wanted = typeof args.list === "string" ? args.list : "";
  if (wanted) {
    const list = wanted.toLowerCase() === "inbox" ? null : (lists.find((l) => l.id === wanted) ?? lists.find((l) => l.name.toLowerCase() === wanted.toLowerCase()));
    if (list === undefined) throw new ArgError(`no list named "${wanted}". Lists: ${lists.map((l) => l.name).join(", ") || "(none)"}, or "inbox"`);
    // Inbox: no list, or a list that no longer exists (the app shows those in the Inbox too).
    const inList = (t: Obj) => (list ? t.listId === list.id : !str(t.listId) || !lists.some((l) => l.id === t.listId));
    const ids = new Set(raw.filter(inList).map((t) => t.id));
    pick = pick.filter((t) => ids.has(t.id));
    listName = list ? list.name : "Inbox";
  }
  const label = typeof args.label === "string" ? args.label.replace(/^@/, "").toLowerCase() : "";
  if (label) pick = pick.filter((t) => t.labels.some((l) => l.toLowerCase() === label));
  pick.sort(status === "done" ? (a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") : openOrder);
  return { todos: pick.slice(0, (args.limit as number) ?? 100), total: pick.length, status, list: listName };
}

// ── Notes ────────────────────────────────────────────────────────────────────

export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  pinned: boolean;
  dailyFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface NoteOut extends Omit<NoteSummary, "excerpt"> {
  text: string;
}

const noteTitle = (n: Obj) => str(n.title)?.trim() || "Untitled";
const isNote = (n: unknown): n is Obj => isObj(n) && !!str(n.id) && n.template !== true;

function excerpt(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 200) return flat;
  const lower = flat.toLowerCase();
  const at = words.length ? Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), flat.length)) : 0;
  const start = at > 60 ? at - 60 : 0;
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 200).trim()}…`;
}

export async function searchNotes(read: Reader, args: Record<string, unknown>): Promise<{ notes: NoteSummary[]; total: number; query: string }> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { n: NoteSummary; score: number }[] = [];
  for (const n of (await read("notes")).filter(isNote)) {
    const title = noteTitle(n);
    const text = htmlToText(str(n.content) ?? "");
    const hay = `${title}\n${text}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const inTitle = words.filter((w) => title.toLowerCase().includes(w)).length;
    scored.push({
      n: { id: n.id as string, title, excerpt: excerpt(text, words), pinned: n.pinned === true, dailyFor: isDay(n.dailyFor) ? n.dailyFor : null, createdAt: str(n.createdAt) ?? null, updatedAt: str(n.updatedAt) ?? null },
      score: words.length ? inTitle : n.pinned === true ? 1 : 0,
    });
  }
  scored.sort((a, b) => b.score - a.score || (b.n.updatedAt ?? "").localeCompare(a.n.updatedAt ?? ""));
  return { notes: scored.slice(0, (args.limit as number) ?? 20).map((s) => s.n), total: scored.length, query };
}

export async function getNote(read: Reader, noteId: string): Promise<NoteOut | null> {
  const n = (await read("notes", { id: noteId })).find(isNote);
  if (!n) return null;
  return { id: n.id as string, title: noteTitle(n), text: htmlToText(str(n.content) ?? ""), pinned: n.pinned === true, dailyFor: isDay(n.dailyFor) ? n.dailyFor : null, createdAt: str(n.createdAt) ?? null, updatedAt: str(n.updatedAt) ?? null };
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export interface MeetingSummaryOut {
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { task: string; owner: string | null; dueDate: string | null; done: boolean }[];
  openQuestions: string[];
  sections: { heading: string; points: string[] }[];
}
export interface MeetingOut {
  id: string;
  title: string;
  startedAt: string | null;
  durationSec: number;
  platform: string | null;
  summary: MeetingSummaryOut | null;
}
export interface MeetingDetail extends MeetingOut {
  yourNotes: string | null;
  transcript?: { at: string; speaker: string; text: string }[];
}

/** Big fields a meeting list never needs (transcripts can be megabytes). */
const MEETING_HEAVY = ["transcript", "speechTranscript", "captionTranscript", "speakerActivity", "coaching", "marks"];

function toMeeting(m: Obj): MeetingOut {
  const s = isObj(m.summary) ? m.summary : null;
  const done = new Set(strs(m.doneActions));
  return {
    id: m.id as string,
    title: str(m.title) ?? (s && str(s.title)) ?? "Meeting",
    startedAt: str(m.startedAt) ?? null,
    durationSec: Math.max(0, Math.round(num(m.durationSec) ?? 0)),
    platform: str(m.platform) ?? null,
    summary: s
      ? {
          overview: str(s.overview) ?? "",
          keyPoints: strs(s.keyPoints),
          decisions: strs(s.decisions),
          actionItems: (Array.isArray(s.actionItems) ? s.actionItems : []).filter(isObj).filter((a) => str(a.task)).map((a) => ({ task: a.task as string, owner: str(a.owner) ?? null, dueDate: str(a.dueDate) ?? null, done: done.has(a.task as string) })),
          openQuestions: strs(s.openQuestions),
          sections: (Array.isArray(s.customSections) ? s.customSections : []).filter(isObj).filter((x) => str(x.heading)).map((x) => ({ heading: x.heading as string, points: strs(x.points) })),
        }
      : null,
  };
}

const isMeeting = (m: unknown): m is Obj => isObj(m) && !!str(m.id);

export async function listMeetings(read: Reader, args: Record<string, unknown>): Promise<{ meetings: MeetingOut[]; total: number }> {
  const since = isDay(args.since) ? args.since : "";
  const all = (await read("meetings", { drop: MEETING_HEAVY }))
    .filter(isMeeting)
    .map(toMeeting)
    .filter((m) => !since || (m.startedAt ?? "").slice(0, 10) >= since)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return { meetings: all.slice(0, (args.limit as number) ?? 20), total: all.length };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export async function getMeeting(read: Reader, meetingId: string, transcript: boolean): Promise<MeetingDetail | null> {
  const m = (await read("meetings", { id: meetingId, drop: transcript ? ["speechTranscript", "captionTranscript", "speakerActivity"] : MEETING_HEAVY })).find(isMeeting);
  if (!m) return null;
  const out: MeetingDetail = { ...toMeeting(m), yourNotes: str(m.userNotes)?.trim() || null };
  if (transcript) {
    out.transcript = (Array.isArray(m.transcript) ? m.transcript : [])
      .filter(isObj)
      .filter((e) => str(e.text))
      .map((e) => ({ at: clock(num(e.startMs) ?? 0), speaker: str(e.speaker) ?? "", text: (e.text as string).trim() }));
  }
  return out;
}

// ── Habits ───────────────────────────────────────────────────────────────────
// Same rules as the app (artifacts/prodli src/lib/habits.ts).

export interface HabitOut {
  id: string;
  name: string;
  emoji: string;
  kind: "check" | "count" | "timed" | "quit";
  target: number | null;
  unit: string | null;
  onDays: string[] | null;
  archived: boolean;
  today: { scheduled: boolean; done: boolean; amount: number | null };
  streak: number;
  last7: { date: string; done: boolean | null }[];
}

function habitRules(h: Obj, tz: string) {
  const kind = (["check", "count", "timed", "quit"] as const).find((k) => k === h.kind) ?? "check";
  const created = str(h.createdAt) ? dayIn(h.createdAt as string, tz) : "0000-00-00";
  const days = Array.isArray(h.days) ? h.days.filter((d): d is number => typeof d === "number" && d >= 0 && d < 7) : [];
  const skipped = new Set(strs(h.skipped));
  const completed = new Set(strs(h.completedDays));
  const log = isObj(h.log) ? h.log : {};
  const target = kind === "quit" ? Math.max(0, num(h.target) ?? 0) : Math.max(1, num(h.target) ?? 1);
  const amount = (d: string) => num(log[d]) ?? 0;
  const scheduled = (d: string) => d >= created && !skipped.has(d) && (!days.length || days.includes(weekday(d)));
  const done = (d: string) => (kind === "quit" ? d >= created && amount(d) <= target : kind === "check" ? completed.has(d) : amount(d) >= target || completed.has(d));
  const streak = (today: string) => {
    let n = 0;
    let d = done(today) ? today : shift(today, -1);
    for (let i = 0; i < 3660 && d >= created; i++, d = shift(d, -1)) {
      if (!scheduled(d)) continue;
      if (!done(d)) break;
      n++;
    }
    return n;
  };
  return { kind, target, days, amount, scheduled, done, streak };
}

function toHabit(h: Obj, date: string, tz: string): HabitOut {
  const r = habitRules(h, tz);
  return {
    id: h.id as string,
    name: str(h.name) ?? "Habit",
    emoji: str(h.emoji) ?? "",
    kind: r.kind,
    target: r.kind === "check" ? null : r.target,
    unit: str(h.unit) ?? (r.kind === "timed" ? "min" : null),
    onDays: r.days.length ? r.days.map((d) => WEEKDAYS[d]) : null,
    archived: h.archived === true,
    today: { scheduled: r.scheduled(date), done: r.done(date), amount: r.kind === "check" ? null : r.amount(date) },
    streak: r.streak(date),
    last7: Array.from({ length: 7 }, (_, i) => shift(date, i - 6)).map((d) => ({ date: d, done: r.scheduled(d) ? r.done(d) : null })),
  };
}

export async function listHabits(read: Reader, args: Record<string, unknown>, now: number): Promise<{ date: string; timezone: string; habits: HabitOut[] }> {
  const { date, timezone } = resolveDay(args.date, args.timezone, now);
  const habits = (await read("habits"))
    .filter(isObj)
    .filter((h) => str(h.id) && (args.include_archived === true || h.archived !== true))
    .map((h) => toHabit(h, date, timezone));
  return { date, timezone, habits };
}

// ── Today ────────────────────────────────────────────────────────────────────

export interface TodayOut {
  date: string;
  timezone: string;
  focus: string | null;
  timeBlocks: { start: string; end: string; title: string; todoId: string }[];
  todos: (TodoOut & { why: "planned" | "due" | "overdue" })[];
  habits: { name: string; emoji: string; done: boolean; streak: number }[];
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function getToday(read: Reader, args: Record<string, unknown>, now: number): Promise<TodayOut> {
  const { date, timezone } = resolveDay(args.date, args.timezone, now);
  const [{ todos }, dayRecords, habitItems] = await Promise.all([readTodos(read), read("days", { id: date, drop: ["brief", "review"] }), read("habits")]);
  const open = todos.filter((t) => !t.completed);
  const timeBlocks = open
    .filter((t) => t.timeBlock?.day === date && /^\d{2}:\d{2}$/.test(t.timeBlock.start))
    .map((t) => {
      const start = toMin(t.timeBlock!.start);
      return { start: t.timeBlock!.start, end: toHM(start + (t.estimateMin ?? 30)), title: t.title, todoId: t.id };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  const why = (t: TodoOut): TodayOut["todos"][number]["why"] | null =>
    t.plannedFor === date || t.timeBlock?.day === date ? "planned" : t.dueDate === date ? "due" : t.dueDate && t.dueDate < date ? "overdue" : null;
  const rank = { planned: 0, due: 1, overdue: 2 } as const;
  const list = open
    .map((t) => ({ ...t, why: why(t) }))
    .filter((t): t is TodoOut & { why: "planned" | "due" | "overdue" } => t.why !== null)
    .sort((a, b) => rank[a.why] - rank[b.why] || openOrder(a, b));
  const record = dayRecords.find(isObj);
  const habits = habitItems
    .filter(isObj)
    .filter((h) => str(h.id) && h.archived !== true)
    .map((h) => toHabit(h, date, timezone))
    .filter((h) => h.today.scheduled)
    .map((h) => ({ name: h.name, emoji: h.emoji, done: h.today.done, streak: h.streak }));
  return { date, timezone, focus: (record && str(record.focus)?.trim()) || null, timeBlocks, todos: list, habits };
}
