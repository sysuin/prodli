// Read later and "Summarize page to ProdLi notes".
// Read later items are the synced "readLater" collection. A page summary reads
// the page's text only when the user right-clicks and picks it (activeTab +
// scripting: just that tab, just that moment), sends it to ProdLi's AI, and
// saves a note with the source link. Without an account, the note gets an
// excerpt instead of an AI summary.

import { safeUrl, escapeHtml } from "./capture";
import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet, storageSet } from "./storage";
import { generateId } from "./utils";
import type { Note, ReadLaterItem } from "../types";

export const READ_LATER_KEY = "readLater";
export const MAX_PAGE_CHARS = 24_000;

/** Adds a page to Read later (no duplicates of unread pages). Returns the item, or null for non-web addresses. */
export async function addReadLater(url: string | undefined, title: string | undefined, now = new Date()): Promise<ReadLaterItem | null> {
  const u = safeUrl(url);
  if (!u) return null;
  const items = await storageGet<ReadLaterItem[]>(READ_LATER_KEY, []);
  const existing = items.find((i) => i.url === u && !i.readAt);
  if (existing) return existing;
  const stamp = now.toISOString();
  const item: ReadLaterItem = { id: generateId(), url: u, title: (title?.trim() || new URL(u).hostname).slice(0, 300), createdAt: stamp, updatedAt: stamp };
  await storageSet(READ_LATER_KEY, [item, ...items]);
  return item;
}

/**
 * Runs inside the page (chrome.scripting): the readable text, preferring the
 * article or main content and skipping navigation, headers and footers.
 * Must be self-contained (it's serialized into the page).
 */
export function extractPageText(max: number): { title: string; text: string } {
  const pick = document.querySelector("article") ?? document.querySelector("main") ?? document.querySelector("[role=main]") ?? document.body;
  const clone = pick.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg, [aria-hidden=true]").forEach((el) => el.remove());
  const text = (clone.innerText || clone.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, text: text.slice(0, max) };
}

export interface PageSummary {
  tldr: string;
  points: string[];
}

/** The note for a saved page: title, source, then the AI summary or an excerpt. */
export function pageNoteHtml(page: { title: string; url: string; text: string }, summary: PageSummary | null, reason?: string): string {
  const url = safeUrl(page.url);
  const parts = [`<h1>${escapeHtml(page.title || "Saved page")}</h1>`];
  if (url) parts.push(`<p>Source: <a href="${escapeHtml(url)}">${escapeHtml(new URL(url).hostname.replace(/^www\./, ""))}</a></p>`);
  if (summary) {
    parts.push(`<h2>Summary</h2><p>${escapeHtml(summary.tldr)}</p>`);
    if (summary.points.length) parts.push(`<h2>Key points</h2><ul>${summary.points.map((p) => `<li><p>${escapeHtml(p)}</p></li>`).join("")}</ul>`);
  } else {
    if (reason) parts.push(`<p><em>${escapeHtml(reason)}</em></p>`);
    const excerpt = page.text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 40).slice(0, 4);
    if (excerpt.length) parts.push(`<h2>Excerpt</h2>${excerpt.map((p) => `<p>${escapeHtml(p.slice(0, 600))}</p>`).join("")}`);
  }
  return parts.join("");
}

/** Summarises a page's text through the ProdLi account, or returns why it couldn't. */
export async function summarizePageText(page: { title: string; url: string; text: string }): Promise<{ summary: PageSummary | null; reason?: string }> {
  if (!page.text.trim()) return { summary: null, reason: "This page has no readable text." };
  if (!accountsEnabled() || !(await getProdliAccount())) return { summary: null, reason: "Sign in to ProdLi (free) to add an AI summary of saved pages." };
  try {
    const r = await accountRequest<{ summary: PageSummary }>(
      "/api/ai/summarize-page",
      { method: "POST", body: JSON.stringify({ title: page.title.slice(0, 300), url: page.url.slice(0, 2000), text: page.text.slice(0, MAX_PAGE_CHARS) }) },
      { write_quota_exceeded: "You've used this month's writing help, so this note has an excerpt instead of a summary." },
    );
    return { summary: r.summary };
  } catch (err) {
    return { summary: null, reason: err instanceof AccountError ? err.message : "The summary didn't work this time, so here's an excerpt." };
  }
}

/** Saves the page (with its summary or excerpt) as a note. */
export async function savePageNote(page: { title: string; url: string; text: string }, now = new Date()): Promise<{ note: Note; summarized: boolean }> {
  const { summary, reason } = await summarizePageText(page);
  const stamp = now.toISOString();
  const note: Note = { id: generateId(), title: (page.title || "Saved page").slice(0, 120), content: pageNoteHtml(page, summary, reason), createdAt: stamp, updatedAt: stamp, autoTitle: false };
  const notes = await storageGet<Note[]>("notes", []);
  await storageSet("notes", [note, ...notes]);
  return { note, summarized: !!summary };
}
