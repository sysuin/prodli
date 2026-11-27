// Writing check: pure text helpers (unit-tested), bundled into the in-page
// checker. Paragraphs, cache keys, placing the on-device model's suggestions,
// your dictionary and dismissed suggestions, and keeping suggestions in place
// as you edit.

import type { CheckIssue, CheckLevel, EnglishVariant, IssueType } from "./types";

export interface Paragraph {
  text: string;
  /** Where it starts in the field's text. */
  start: number;
}

/** Shortest text worth checking (a single word rarely has anything to fix in context). */
export const MIN_CHECK_CHARS = 4;
export const MAX_PARAGRAPH_CHARS = 2000;

/** The field's text as lines; empty lines and very short ones are skipped. Long lines are cut into ~2000-character pieces at a sentence end. */
export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    let rest = line;
    let start = at;
    while (rest.length > MAX_PARAGRAPH_CHARS) {
      const cut = Math.max(rest.lastIndexOf(". ", MAX_PARAGRAPH_CHARS), rest.lastIndexOf(" ", MAX_PARAGRAPH_CHARS), 1);
      out.push({ text: rest.slice(0, cut + 1), start });
      start += cut + 1;
      rest = rest.slice(cut + 1);
    }
    if (rest.trim().length >= MIN_CHECK_CHARS) out.push({ text: rest, start });
    at += line.length + 1;
  }
  return out;
}

/** cyrb53, base 36: cache keys for checked paragraphs. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const paragraphKey = (text: string, level: CheckLevel, variant?: EnglishVariant) => `${level}|${variant ?? ""}|${hash(text)}`;

/** Mostly Latin letters: something Chrome's on-device model (English-first) can check. Other scripts go to ProdLi's AI. */
export function looksEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin / letters.length >= 0.95;
}

/** Where `original` is in the text: right after `before` when that matches, otherwise the first free occurrence. -1 if it isn't there. */
export function locate(text: string, original: string, before: string, taken: [number, number][]): number {
  if (!original) return -1;
  const free = (s: number) => !taken.some(([a, b]) => s < b && s + original.length > a);
  const starts: number[] = [];
  for (let i = text.indexOf(original); i >= 0; i = text.indexOf(original, i + 1)) starts.push(i);
  if (!starts.length) return -1;
  const b = before.trim();
  if (b) {
    const hit = starts.find((s) => free(s) && text.slice(0, s).trimEnd().endsWith(b));
    if (hit !== undefined) return hit;
  }
  return starts.find(free) ?? -1;
}

const TYPES = new Set<IssueType>(["spelling", "grammar", "punctuation", "word_choice", "clarity", "tone"]);

/** A model's suggestions (text, not offsets) → placed, non-overlapping issues, in order. */
export function placeIssues(text: string, raw: { original?: unknown; before?: unknown; replacement?: unknown; type?: unknown; explanation?: unknown }[], max = 10): CheckIssue[] {
  const taken: [number, number][] = [];
  const out: CheckIssue[] = [];
  for (const r of raw) {
    if (out.length >= max) break;
    const original = typeof r.original === "string" ? r.original : "";
    const replacement = typeof r.replacement === "string" ? r.replacement : "";
    if (!original || original === replacement) continue;
    const start = locate(text, original, typeof r.before === "string" ? r.before : "", taken);
    if (start < 0) continue;
    taken.push([start, start + original.length]);
    const type = TYPES.has(r.type as IssueType) ? (r.type as IssueType) : "grammar";
    out.push({ start, end: start + original.length, original, replacement, type, explanation: typeof r.explanation === "string" ? r.explanation.slice(0, 160) : "" });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const dismissKey = (i: Pick<CheckIssue, "original" | "replacement">) => `${i.original}\u0000${i.replacement}`;

/** Leaves out words in your dictionary and suggestions you dismissed. */
export function filterIssues(issues: CheckIssue[], dictionary: string[], dismissed: Set<string>): CheckIssue[] {
  const words = new Set(dictionary.map((w) => w.toLowerCase()));
  return issues.filter((i) => !dismissed.has(dismissKey(i)) && !(i.type === "spelling" && words.has(i.original.trim().toLowerCase())));
}

/**
 * After the text from `from` to `to` was replaced by text `delta` characters
 * longer (or shorter): issues after it move, issues it touched go.
 */
export function shiftIssues(issues: CheckIssue[], from: number, to: number, delta: number): CheckIssue[] {
  return issues.filter((i) => i.end <= from || i.start >= to).map((i) => (i.start >= to ? { ...i, start: i.start + delta, end: i.end + delta } : i));
}

/** Applies every suggestion to a paragraph's text (from the end, so offsets stay right). */
export function applyAll(text: string, issues: CheckIssue[]): string {
  let out = text;
  for (const i of [...issues].sort((a, b) => b.start - a.start)) {
    if (out.slice(i.start, i.end) === i.original) out = out.slice(0, i.start) + i.replacement + out.slice(i.end);
  }
  return out;
}
