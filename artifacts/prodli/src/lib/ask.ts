// Ask ProdLi (chat). The question is answered by ProdLi's AI (server:
// /api/ai/ask) from the user's own data. To keep what's sent small and
// relevant, the device picks a few snippets from notes and meetings that match
// the question (pickSnippets), plus the same day context as the daily brief.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet } from "./storage";
import { buildContext } from "./today";
import type { Note } from "../types";
import type { Meeting } from "../recorder/types";

export interface AskAction {
  type: "add_task" | "plan_today" | "add_note";
  title: string;
  details: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  actions?: AskAction[];
  error?: boolean;
  /** Notes and meetings the answer used (click to open). */
  sources?: AskSource[];
}

export interface AskSource {
  kind: "note" | "meeting";
  id: string;
  title: string;
  date?: string;
}

export interface Snippet {
  kind: "note" | "meeting";
  title: string;
  date?: string;
  text: string;
  /** The note or meeting it came from (kept on the device, not sent). */
  id?: string;
}

const STOP = new Set("a an and are as at be by can did do for from had has have how i if in is it me my of on or our should so that the this to was we what when where which who why will with you your".split(" "));

export function terms(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu) ?? [])].filter((t) => !STOP.has(t) && t.length > 1);
}

const plain = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/h\d|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

const count = (text: string, ts: string[]) => {
  const lower = text.toLowerCase();
  return ts.reduce((n, t) => n + (lower.split(t).length - 1), 0);
};

/** Pure: the notes and meetings most relevant to the question (title matches count most). */
export function pickSnippets(question: string, notes: Note[], meetings: Meeting[], max = 8, perItem = 1500): Snippet[] {
  const ts = terms(question);
  const wantsMeetings = /\b(meeting|call|standup|sync|decid|action item|discuss)/i.test(question);
  const scored: { score: number; s: Snippet; at: string }[] = [];

  for (const n of notes) {
    const body = plain(n.content);
    const score = count(n.title, ts) * 3 + count(body, ts);
    if (score > 0) scored.push({ score, at: n.updatedAt, s: { kind: "note", id: n.id, title: n.title.slice(0, 300), date: n.updatedAt.slice(0, 10), text: excerpt(body, ts, perItem) } });
  }
  const sortedMeetings = [...meetings].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const [i, m] of sortedMeetings.entries()) {
    const s = m.summary;
    const summaryText = s ? [s.overview, ...s.keyPoints.map((k) => `- ${k}`), ...s.decisions.map((d) => `Decision: ${d}`), ...s.actionItems.map((a) => `Action: ${a.task}${a.owner ? ` (${a.owner})` : ""}`)].join("\n") : "";
    const transcript = m.transcript.map((e) => `${e.speaker}: ${e.text}`).join("\n");
    const title = s?.title || m.title;
    let score = count(title, ts) * 3 + count(summaryText, ts) * 2 + count(transcript, ts);
    if (wantsMeetings && i < 2) score += 2; // "the last meeting"
    if (score <= 0) continue;
    const matchingLines = transcript.split("\n").filter((l) => ts.some((t) => l.toLowerCase().includes(t))).slice(0, 12).join("\n");
    const text = [summaryText, matchingLines && `Transcript:\n${matchingLines}`].filter(Boolean).join("\n").slice(0, perItem) || transcript.slice(0, perItem);
    scored.push({ score, at: m.startedAt, s: { kind: "meeting", id: m.id, title: title.slice(0, 300), date: m.startedAt.slice(0, 10), text } });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, max)
    .map((x) => x.s);
}

/** The part of `text` around the first matching term. */
function excerpt(text: string, ts: string[], max: number): string {
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const first = Math.min(...ts.map((t) => lower.indexOf(t)).filter((i) => i >= 0), Infinity);
  const start = Number.isFinite(first) ? Math.max(0, first - Math.floor(max / 3)) : 0;
  return (start > 0 ? "…" : "") + text.slice(start, start + max) + (start + max < text.length ? "…" : "");
}

type AskStub = (body: { question: string; snippets: Omit<Snippet, "id">[] }) => Promise<{ answer: string; actions: AskAction[]; sources: number[] }>;
const askStub = (): AskStub | undefined => (import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliAskStub?: AskStub }).__prodliAskStub : undefined);

export async function canAsk(): Promise<boolean> {
  if (askStub()) return true; // test builds only
  return accountsEnabled() && !!(await getProdliAccount());
}

export interface AskResult {
  answer: string;
  actions: AskAction[];
  sources: AskSource[];
  usage?: { used: number; limit: number };
}

export async function askProdli(question: string, history: ChatTurn[]): Promise<AskResult> {
  const [context, allNotes] = await Promise.all([buildContext([]), storageGet<Note[]>("notes", [])]);
  const notes = allNotes.filter((n) => !n.template); // templates aren't content
  let meetings: Meeting[] = [];
  try {
    meetings = await (await import("../recorder/db")).listMeetings();
  } catch {
    // IndexedDB unavailable
  }
  const snippets = pickSnippets(question, notes, meetings);
  const body = {
    question: question.slice(0, 2000),
    history: history.filter((h) => !h.error).slice(-8).map((h) => ({ role: h.role, text: h.text.slice(0, 4000) })),
    context,
    snippets: snippets.map(({ id: _id, ...s }) => s),
  };
  try {
    const stub = askStub();
    const r = stub ? await stub(body) : await accountRequest<Omit<AskResult, "sources"> & { sources?: number[] }>("/api/ai/ask", { method: "POST", body: JSON.stringify(body) });
    return { ...r, sources: sourcesFrom(r.sources ?? [], snippets) };
  } catch (err) {
    if (err instanceof AccountError && err.status === 503) throw new AccountError("Ask ProdLi isn't available right now. Try again later.", 503);
    throw err;
  }
}

/** The answer's snippet numbers (1-based) → the notes and meetings they came from. */
export function sourcesFrom(numbers: number[], snippets: Snippet[]): AskSource[] {
  const out: AskSource[] = [];
  for (const n of numbers) {
    const s = snippets[n - 1];
    if (s?.id && !out.some((o) => o.id === s.id)) out.push({ kind: s.kind, id: s.id, title: s.title, date: s.date });
  }
  return out;
}



export const SUGGESTIONS = ["What should I focus on now?", "What's overdue?", "Summarize my last meeting", "Plan my afternoon", "What did I get done yesterday?"];

/** Opens the Ask ProdLi panel from anywhere in the app (App.tsx listens), optionally asking right away. */
export const ASK_EVENT = "prodli-ask";
export function openAsk(question?: string): void {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question } }));
}
