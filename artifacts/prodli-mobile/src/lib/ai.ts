// ProdLi's AI on the phone, through the account (ProdLi's own Claude key and
// monthly allowances on the server): the daily brief, Ask ProdLi and meeting
// summaries. The context is built on the phone from the user's data, the same
// way the extension builds it (artifacts/prodli/src/lib/today.ts, ask.ts).
import { currentStreak, getDayKey, isDone, type DailyBrief, type DayRecord, type Habit, type Note, type PieceResult, type Todo } from "../shared";
import { AccountError, getAccount, request } from "./api";
import { htmlToText } from "./html";
import { transcriptToText, type Meeting, type MeetingSummary } from "./meetings";

export interface BriefContext {
  date: string;
  weekday: string;
  now: string;
  workHours?: { start: string; end: string };
  focus?: string;
  tasks: { title: string; priority?: "high" | "medium" | "low"; due?: string; overdue?: boolean; planned?: boolean; estimateMin?: number; openSubtasks?: number }[];
  doneYesterday?: string[];
  habits?: { name: string; doneToday: boolean; streak: number }[];
  meetingActions?: { task: string; owner?: string | null; due?: string | null; meeting: string }[];
  yesterday?: { focusSessions?: number; reflection?: string };
}

const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const isForToday = (t: Todo, today: string) => !t.completed && ((!!t.plannedFor && t.plannedFor <= today) || (!!t.dueDate && t.dueDate <= today));

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Pure: the brief's input from the user's data, capped to what the server accepts. */
export function briefContext(input: { now: Date; todos: Todo[]; habits: Habit[]; meetings: Meeting[]; days: DayRecord[]; sessions?: { completedAt: string }[]; workHours?: { start: string; end: string } }): BriefContext {
  const { now } = input;
  const today = getDayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = getDayKey(y);
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const open = input.todos.filter((t) => !t.completed);
  const ranked = [...open].sort((a, b) => {
    const score = (t: Todo) => (isForToday(t, today) ? 0 : 1) * 10 + (t.priority ? rank[t.priority] : 3);
    return score(a) - score(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });
  const titles = new Set(input.todos.map((t) => t.title.trim().toLowerCase()));
  const day = input.days.find((d) => d.id === today);
  const yday = input.days.find((d) => d.id === yesterday);
  return {
    date: today,
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    now: hm(now),
    workHours: input.workHours ?? { start: "09:00", end: "18:00" },
    focus: day?.focus?.trim() ? clip(day.focus.trim()) : undefined,
    tasks: ranked.slice(0, 60).map((t) => ({
      title: clip(t.title),
      priority: t.priority,
      due: t.dueDate,
      overdue: t.dueDate && t.dueDate < today ? true : undefined,
      planned: t.plannedFor && t.plannedFor <= today ? true : undefined,
      estimateMin: t.estimateMin,
      openSubtasks: t.subtasks?.filter((s) => !s.completed).length || undefined,
    })),
    doneYesterday: input.todos.filter((t) => t.completed && t.completedAt && getDayKey(t.completedAt) === yesterday).map((t) => clip(t.title)).slice(0, 20),
    habits: input.habits.filter((h) => !h.archived).slice(0, 30).map((h) => ({ name: clip(h.name, 100), doneToday: isDone(h, today), streak: currentStreak(h, today) })),
    meetingActions: input.meetings
      .filter((m) => m.summary && now.getTime() - new Date(m.startedAt).getTime() < 14 * 86_400_000)
      .flatMap((m) => m.summary!.actionItems.map((a) => ({ task: clip(a.task), owner: a.owner, due: a.dueDate, meeting: clip(m.summary!.title || m.title, 180) })))
      .filter((a) => !titles.has(a.task.trim().toLowerCase()))
      .slice(0, 20),
    yesterday: {
      focusSessions: (input.sessions ?? []).filter((s) => getDayKey(s.completedAt) === yesterday).length || undefined,
      reflection: yday?.reflection?.trim() ? clip(yday.reflection.trim(), 900) : undefined,
    },
  };
}

/** A useful brief without AI (signed out, offline, or the allowance is used up). */
export function basicBrief(ctx: BriefContext): DailyBrief {
  const forToday = ctx.tasks.filter((t) => t.planned || t.overdue || (t.due && t.due <= ctx.date));
  const top = (forToday.length ? forToday : ctx.tasks).slice(0, 3);
  const overdue = ctx.tasks.filter((t) => t.overdue);
  const work = ctx.workHours ?? { start: "09:00", end: "18:00" };
  const planned = forToday.reduce((n, t) => n + (t.estimateMin ?? 0), 0);
  const free = Math.max(0, toMinutes(work.end) - Math.max(toMinutes(work.start), toMinutes(ctx.now)));
  const hours = (m: number) => Math.round((m / 60) * 10) / 10;
  return {
    headline: ctx.focus ? `Today's focus: ${ctx.focus}` : top.length ? `Start with: ${top[0].title}` : `A fresh ${ctx.weekday}`,
    summary: forToday.length ? `${forToday.length} task${forToday.length > 1 ? "s" : ""} for today.` : ctx.tasks.length ? `${ctx.tasks.length} open task${ctx.tasks.length > 1 ? "s" : ""}.` : "No open tasks — plan one thing that would make today a win.",
    priorities: top.map((t) => ({ title: t.title, reason: t.overdue ? "Overdue" : t.planned ? "Planned for today" : t.due === ctx.date ? "Due today" : t.priority === "high" ? "High priority" : "Next up" })),
    schedule: [],
    watchouts: [
      ...(overdue.length ? [`${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}: ${overdue.slice(0, 3).map((t) => t.title).join(", ")}`] : []),
      ...(planned > free && planned > 0 ? [`You've planned about ${hours(planned)} h of work but have about ${hours(free)} h left today.`] : []),
    ],
    habits: (ctx.habits ?? []).filter((h) => !h.doneToday).slice(0, 5).map((h) => (h.streak ? `${h.name} — keep your ${h.streak}-day streak going` : h.name)),
    tip: ctx.yesterday?.reflection ? `Yesterday you noted: “${ctx.yesterday.reflection.slice(0, 140)}”` : "Pick one task and give it a focused 25-minute Pomodoro before checking messages.",
    model: "basic",
    generatedAt: new Date().toISOString(),
    source: "basic",
  };
}

export interface BriefResult {
  brief: DailyBrief;
  fallbackReason?: string;
}

export async function writeBrief(ctx: BriefContext): Promise<BriefResult> {
  if (!getAccount()) return { brief: basicBrief(ctx), fallbackReason: "Sign in to get an AI-written brief — here's a basic one from what's on this phone." };
  try {
    const r = await request<{ brief: DailyBrief }>("/api/ai/brief", { method: "POST", body: JSON.stringify(ctx) });
    return { brief: { ...r.brief, source: "ai" } };
  } catch (err) {
    const reason =
      err instanceof AccountError && err.status === 503
        ? "ProdLi's AI briefs aren't available right now — here's a basic brief."
        : err instanceof AccountError && err.status === 0
          ? "You're offline — here's a basic brief from what's on this phone."
          : err instanceof Error
            ? err.message
            : "Couldn't reach ProdLi.";
    return { brief: basicBrief(ctx), fallbackReason: reason };
  }
}

// ── Ask ProdLi ───────────────────────────────────────────────────────────────

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}
export interface AskAction {
  type: "add_task" | "plan_today" | "add_note";
  title: string;
  details: string;
}
export interface AskAnswer {
  answer: string;
  actions: AskAction[];
  sources: number[];
}
export interface Snippet {
  kind: "note" | "meeting";
  id: string;
  title: string;
  date?: string;
  text: string;
}

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "what", "did", "we", "i", "my", "me", "about", "with", "do", "should", "how", "when", "was", "were", "are", "be", "that", "this", "at", "from"]);
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter((w) => !STOP.has(w)) ?? [];

/** Pure: the notes and meetings that best match the question (keyword overlap, newer first on ties). */
export function pickSnippets(question: string, notes: Note[], meetings: Meeting[], max = 6): Snippet[] {
  const q = new Set(words(question));
  if (!q.size) return [];
  const candidates: (Snippet & { score: number; at: string })[] = [];
  for (const n of notes) {
    if (n.template) continue;
    const text = htmlToText(n.content);
    const w = words(`${n.title} ${n.title} ${text}`);
    const score = w.filter((x) => q.has(x)).length;
    if (score) candidates.push({ kind: "note", id: n.id, title: clip(n.title, 300), date: n.updatedAt?.slice(0, 10), text: clip(text, 3000), score, at: n.updatedAt ?? "" });
  }
  for (const m of meetings) {
    const s = m.summary;
    const text = s ? [s.overview, ...s.keyPoints.map((k) => `- ${k}`), ...s.decisions.map((d) => `Decision: ${d}`), ...s.actionItems.map((a) => `Action: ${a.task}${a.owner ? ` (${a.owner})` : ""}`)].join("\n") : transcriptToText(m.transcript ?? []);
    const w = words(`${m.title} ${m.title} ${text}`);
    const score = w.filter((x) => q.has(x)).length;
    if (score) candidates.push({ kind: "meeting", id: m.id, title: clip(s?.title || m.title, 300), date: m.startedAt?.slice(0, 10), text: clip(text, 3000), score, at: m.startedAt ?? "" });
  }
  return candidates
    .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, max)
    .map(({ score: _s, at: _a, ...rest }) => rest);
}

export async function ask(question: string, history: AskTurn[], context: BriefContext, snippets: Snippet[]): Promise<AskAnswer> {
  return request<AskAnswer>("/api/ai/ask", {
    method: "POST",
    body: JSON.stringify({
      question: question.slice(0, 2000),
      history: history.slice(-10).map((h) => ({ role: h.role, text: h.text.slice(0, 4000) })),
      context,
      snippets: snippets.map(({ kind, title, date, text }) => ({ kind, title, ...(date ? { date } : {}), text })),
    }),
  });
}

// ── Transcription (in-person recording) ─────────────────────────────────────

/** One 16 kHz WAV piece → Whisper's text (ProdLi's AI; counts toward the monthly minutes). */
export function transcribePiece(wav: Uint8Array): Promise<PieceResult> {
  const body = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  return request<PieceResult>("/api/ai/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body });
}

/** Network trouble or a busy server: worth trying again. */
export const retryable = (err: unknown) => err instanceof AccountError && (err.status === 0 || err.status === 502 || err.status === 503);

// ── Meeting summaries ────────────────────────────────────────────────────────

export async function summarizeMeeting(m: Meeting): Promise<MeetingSummary> {
  if (!m.transcript?.length) throw new Error("There is no transcript to summarize.");
  const r = await request<{ summary: MeetingSummary }>("/api/ai/summarize", {
    method: "POST",
    body: JSON.stringify({ title: m.title, date: m.startedAt.slice(0, 10), transcript: transcriptToText(m.transcript), ...(m.template ? { template: m.template } : {}) }),
  });
  return r.summary;
}
