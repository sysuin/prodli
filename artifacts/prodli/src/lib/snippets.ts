// Saved snippets (Settings → Dictation → Snippets): text you reuse — an
// address, a calendar link, a canned reply. Say the cue while dictating, pick
// one with "Insert a snippet" (right-click in a text box, or its shortcut), or
// copy one from the palette ("s addr"). Pure helpers: no Chrome APIs, so the
// injected picker (snippets/picker.ts) can import them.

import type { Snippet } from "../dictation/core";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

/** Snippets matching the text (cue first, then the text itself), best first. Empty query: all, in saved order. */
export function matchSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = norm(query);
  const valid = snippets.filter((s) => s.cue.trim() && s.text);
  if (!q) return valid;
  const score = (s: Snippet) => {
    const cue = norm(s.cue);
    if (cue === q) return 0;
    if (cue.startsWith(q)) return 1;
    if (cue.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    if (cue.includes(q)) return 3;
    if (norm(s.text).includes(q)) return 4;
    return 9;
  };
  return valid
    .map((s, i) => ({ s, i, sc: score(s) }))
    .filter((x) => x.sc < 9)
    .sort((a, b) => a.sc - b.sc || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Fills placeholders when a snippet is inserted: {date} (Nov 24, 2026),
 * {isodate} (2026-11-24), {time} (3:05 PM), {day} (Tuesday). Unknown ones stay as typed.
 */
export function fillSnippet(text: string, now = new Date(), locale?: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const values: Record<string, string> = {
    date: now.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }),
    isodate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: now.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }).replace(/[\u202f\u00a0]/g, " "),
    day: now.toLocaleDateString(locale, { weekday: "long" }),
  };
  return text.replace(/\{(date|isodate|time|day)\}/gi, (_, k: string) => values[k.toLowerCase()]);
}
