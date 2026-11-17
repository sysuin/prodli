// Writing help ("✨ Improve" on selected text in Notes). The selection goes to
// ProdLi's server (/api/ai/rewrite) as Markdown and comes back as Markdown, so
// bold, links, lists and checklists survive. The user always sees the
// suggestion first; nothing changes until they click Replace or Insert below.
// Plan: docs/PLAN-WRITING-ASSIST.md. Server: artifacts/prodli-api/src/write.ts.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";

export const REWRITE_ACTIONS = [
  { id: "fix", label: "Fix spelling & grammar", icon: "✓" },
  { id: "shorter", label: "Make shorter", icon: "✂" },
  { id: "clearer", label: "Make clearer", icon: "💡" },
  { id: "formal", label: "More formal", icon: "👔" },
  { id: "friendly", label: "Friendlier", icon: "😊" },
] as const;
export type RewriteAction = (typeof REWRITE_ACTIONS)[number]["id"];

/** Same limit as the server (prodli-api/src/write.ts MAX_REWRITE_CHARS), about 1,000 words. */
export const MAX_REWRITE_CHARS = 6000;

export const SIGN_IN_FOR_WRITING = "Sign in to your ProdLi account (👤, free) to use writing help.";
export const TOO_LONG = "That's too much text at once. Select a shorter part (up to about 1,000 words).";

export class RewriteError extends Error {}

export interface RewriteResult {
  text: string;
  changed: boolean;
  usage?: { used: number; limit: number };
}

const MESSAGES: Record<string, string> = {
  write_quota_exceeded: "You've used this month's writing help. It resets on the 1st, or get more with ProdLi Pro (👤 Account).",
  ai_unavailable: "Writing help isn't available right now. Try again in a little while.",
  ai_busy: "Writing help is busy right now. Try again in a minute.",
  ai_failed: "Something went wrong. Try again.",
  ai_refused: "ProdLi can't rewrite this text.",
  ai_truncated: "The rewrite was cut off. Try a shorter selection.",
  too_large: TOO_LONG,
  bad_request: "There's no text to improve. Select some words first.",
};

type Stub = (action: RewriteAction, markdown: string) => Promise<RewriteResult>;

/** Rewrites Markdown through the user's ProdLi account. Throws RewriteError with a message to show. */
export async function rewriteText(action: RewriteAction, markdown: string): Promise<RewriteResult> {
  const text = markdown.trim();
  if (!text) throw new RewriteError(MESSAGES.bad_request);
  if (text.length > MAX_REWRITE_CHARS) throw new RewriteError(TOO_LONG);
  // Test builds only: the end-to-end tests stand in for the server.
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliRewriteStub?: Stub }).__prodliRewriteStub;
    if (stub) return stub(action, text);
  }
  if (!accountsEnabled()) throw new RewriteError("Writing help isn't available in this copy of ProdLi.");
  if (!(await getProdliAccount())) throw new RewriteError(SIGN_IN_FOR_WRITING);
  try {
    return await accountRequest<RewriteResult>("/api/ai/rewrite", { method: "POST", body: JSON.stringify({ action, text }) }, MESSAGES);
  } catch (err) {
    throw new RewriteError(err instanceof AccountError ? err.message : MESSAGES.ai_failed);
  }
}

/**
 * Markdown from the model → Editor HTML. Highlights travel as `==text==`
 * (see markdownExport.ts), which Markdown itself doesn't know, so they are
 * turned back into <mark> first.
 */
export async function rewriteToHtml(markdown: string): Promise<string> {
  const { markdownToNoteHtml } = await import("./editorHtml");
  return markdownToNoteHtml(markdown.replace(/==(?=\S)([^=\n]*?\S)==/g, "<mark>$1</mark>"));
}

/** Markdown → plain text, for showing what changed and for Copy. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/gm, "$1")
    .replace(/^(\s*)[-*+]\s+/gm, "$1")
    .replace(/^(\s*)\d+[.)]\s+/gm, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/==(?=\S)([^=\n]*?\S)==/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!~=>|])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DiffPart {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Word-level differences between two texts, or null when they're too long to compare quickly. */
export function wordDiff(before: string, after: string): DiffPart[] | null {
  const a = before.match(/\s+|[^\s]+/g) ?? [];
  const b = after.match(/\s+|[^\s]+/g) ?? [];
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > 4_000_000) return null;
  // Longest common subsequence, filled from the end so the walk below goes forwards.
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  // Whitespace alone isn't worth marking as a change.
  return parts.flatMap((p): DiffPart[] => (p.kind === "same" || p.text.trim() ? [p] : p.kind === "added" ? [{ kind: "same", text: p.text }] : []));
}

/** Opens writing help in Notes from anywhere (the command palette); EditorSection listens. */
export const IMPROVE_EVENT = "prodli-improve";
export function openImprove(action?: RewriteAction): void {
  window.dispatchEvent(new CustomEvent(IMPROVE_EVENT, { detail: { action } }));
}

// ── Follow-up email from a meeting (phase 2) ──────────────────────────────────
// Only the meeting's summary is sent (/api/ai/follow-up), never the transcript.
// Counts toward the same monthly writing allowance as ✨ Improve.

export type FollowUpTone = "formal" | "friendly";

export interface FollowUpMeeting {
  title: string;
  /** e.g. "2026-11-17" */
  date: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { task: string; owner: string | null; dueDate: string | null }[];
  openQuestions: string[];
}

export interface FollowUpResult {
  subject: string;
  body: string;
  usage?: { used: number; limit: number };
}

const FOLLOW_UP_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  ai_refused: "ProdLi can't write a follow-up for this meeting.",
  ai_truncated: "The email was cut off. Try again.",
  too_large: "These meeting notes are too long for a follow-up email.",
  bad_request: "This meeting has no summary to write from yet.",
};

type FollowUpStub = (tone: FollowUpTone, meeting: FollowUpMeeting) => Promise<FollowUpResult>;

/** The parts of a meeting summary the email is written from, trimmed to the server's limits. */
export function followUpMeeting(summary: { title: string; overview: string; keyPoints: string[]; decisions: string[]; actionItems: { task: string; owner: string | null; dueDate: string | null }[]; openQuestions: string[] }, fallbackTitle: string, startedAt: string): FollowUpMeeting {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const list = (items: string[] | undefined, n: number) => (items ?? []).slice(0, n).map((i) => cut(i, 600));
  return {
    title: cut(summary.title || fallbackTitle, 300),
    date: startedAt.slice(0, 10),
    overview: cut(summary.overview, 4000),
    keyPoints: list(summary.keyPoints, 30),
    decisions: list(summary.decisions, 30),
    actionItems: (summary.actionItems ?? []).slice(0, 40).map((a) => ({ task: cut(a.task, 600), owner: a.owner ? cut(a.owner, 120) : null, dueDate: a.dueDate ? cut(a.dueDate, 40) : null })),
    openQuestions: list(summary.openQuestions, 30),
  };
}

/** Drafts a follow-up email through the user's ProdLi account. Throws RewriteError with a message to show. */
export async function draftFollowUp(tone: FollowUpTone, meeting: FollowUpMeeting): Promise<FollowUpResult> {
  if (!meeting.overview.trim()) throw new RewriteError(FOLLOW_UP_MESSAGES.bad_request);
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliFollowUpStub?: FollowUpStub }).__prodliFollowUpStub;
    if (stub) return stub(tone, meeting);
  }
  if (!accountsEnabled()) throw new RewriteError("Writing help isn't available in this copy of ProdLi.");
  if (!(await getProdliAccount())) throw new RewriteError(SIGN_IN_FOR_WRITING);
  try {
    return await accountRequest<FollowUpResult>("/api/ai/follow-up", { method: "POST", body: JSON.stringify({ tone, meeting }) }, FOLLOW_UP_MESSAGES);
  } catch (err) {
    throw new RewriteError(err instanceof AccountError ? err.message : MESSAGES.ai_failed);
  }
}

/**
 * A mailto: link with the subject and body filled in, or null when it would be
 * too long for email apps to accept reliably (then the user copies instead).
 */
export const MAX_MAILTO_LENGTH = 1800;
export function mailtoHref(subject: string, body: string): string | null {
  // Email apps expect CRLF line breaks in mailto bodies.
  const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
  return href.length <= MAX_MAILTO_LENGTH ? href : null;
}
