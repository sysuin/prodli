// Shared meeting notes: a read-only page at /s/<id> with a meeting's summary
// (never the transcript or audio), for people who weren't in the meeting.
//
// The app sends a snapshot of the summary; it's stored in D1 (`shares`) until
// the link expires (7 or 30 days, or never with Pro), the user stops sharing,
// or the account is deleted. One link per meeting: sharing again updates it.
// The page is plain HTML with no scripts (strict CSP) and isn't indexed.

import { z } from "zod/v4";

export const MAX_SHARE_BYTES = 60_000;
const line = (n: number) => z.string().max(n);

export const ShareInputSchema = z.object({
  meetingId: z.string().min(1).max(100),
  title: line(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSec: z.number().int().min(0).max(24 * 3600),
  expiresDays: z.union([z.literal(7), z.literal(30), z.null()]),
  summary: z.object({
    overview: line(4000),
    keyPoints: z.array(line(600)).max(30),
    decisions: z.array(line(600)).max(20),
    actionItems: z.array(z.object({ task: line(400), owner: line(120).nullable(), dueDate: z.string().max(10).nullable() })).max(40),
    openQuestions: z.array(line(600)).max(20),
    customSections: z.array(z.object({ heading: line(80), points: z.array(line(600)).max(20) })).max(8).optional(),
  }),
});
export type ShareInput = z.infer<typeof ShareInputSchema>;

export interface ShareRow {
  id: string;
  user_id: string;
  meeting_id: string;
  title: string;
  payload: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  views: number;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Creates the meeting's link, or updates it (same id) if it's already shared. */
export async function saveShare(db: D1Database, userId: string, input: ShareInput, now: number): Promise<ShareRow> {
  const expires = input.expiresDays ? now + input.expiresDays * 86_400_000 : null;
  const payload = JSON.stringify({ title: input.title, date: input.date, durationSec: input.durationSec, summary: input.summary });
  const existing = await db.prepare(`SELECT id FROM shares WHERE user_id = ?1 AND meeting_id = ?2`).bind(userId, input.meetingId).first<{ id: string }>();
  const id = existing?.id ?? newId();
  if (existing) {
    await db.prepare(`UPDATE shares SET title = ?1, payload = ?2, updated_at = ?3, expires_at = ?4 WHERE id = ?5`).bind(input.title, payload, now, expires, id).run();
  } else {
    await db.prepare(`INSERT INTO shares (id, user_id, meeting_id, title, payload, created_at, updated_at, expires_at, views) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, 0)`).bind(id, userId, input.meetingId, input.title, payload, now, expires).run();
  }
  return (await db.prepare(`SELECT * FROM shares WHERE id = ?1`).bind(id).first<ShareRow>())!;
}

export async function listShares(db: D1Database, userId: string, now: number): Promise<ShareRow[]> {
  const { results } = await db.prepare(`SELECT * FROM shares WHERE user_id = ?1 AND (expires_at IS NULL OR expires_at > ?2) ORDER BY updated_at DESC`).bind(userId, now).all<ShareRow>();
  return results;
}

export async function deleteShare(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM shares WHERE id = ?1 AND user_id = ?2`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** A live share (not expired), counting the view. */
export async function openShare(db: D1Database, id: string, now: number): Promise<ShareRow | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return null;
  const row = await db.prepare(`SELECT * FROM shares WHERE id = ?1 AND (expires_at IS NULL OR expires_at > ?2)`).bind(id, now).first<ShareRow>();
  if (row) await db.prepare(`UPDATE shares SET views = views + 1 WHERE id = ?1`).bind(id).run();
  return row ?? null;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
export const section = (heading: string, body: string) => (body ? `<h2>${esc(heading)}</h2>${body}` : "");
export const minutes = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.max(1, Math.round(sec / 60))} min`);

export const PAGE_STYLE = `body{margin:0;background:#F4EBDD;color:#111;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px 48px}article{background:#FFFBF4;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:28px}h1{font-size:28px;line-height:1.2;margin:0 0 6px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 6px;border-bottom:2px solid #000;padding-bottom:4px}.meta{color:#555;font-size:14px;margin:0 0 12px}ul{padding-left:20px;margin:0}li{margin:4px 0}.who{color:#555;font-size:14px}footer{text-align:center;font-size:13px;color:#555;margin-top:24px}footer a{color:#111;font-weight:700}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}article{background:#1f1f1f;border-color:#eee;box-shadow:6px 6px 0 #FF4FA3}h2{border-color:#eee}.meta,.who,footer{color:#bbb}footer a{color:#fff}}`;

/** The public page (escaped; no scripts). */
export function renderSharePage(row: ShareRow): string {
  const p = JSON.parse(row.payload) as { title: string; date: string; durationSec: number; summary: ShareInput["summary"] };
  const s = p.summary;
  const date = new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const actions = s.actionItems.length
    ? `<ul>${s.actionItems.map((a) => `<li>${esc(a.task)}${a.owner || a.dueDate ? ` <span class="who">— ${esc([a.owner, a.dueDate].filter(Boolean).join(", "))}</span>` : ""}</li>`).join("")}</ul>`
    : "";
  const body = [
    s.overview ? `<p>${esc(s.overview)}</p>` : "",
    ...(s.customSections ?? []).map((c) => section(c.heading, list(c.points))),
    section("Key points", list(s.keyPoints)),
    section("Decisions", list(s.decisions)),
    section("Action items", actions),
    section("Open questions", list(s.openQuestions)),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(p.title || "Meeting notes")} · Meeting notes</title><style>${PAGE_STYLE}</style></head><body><main><article><h1>${esc(p.title || "Meeting notes")}</h1><p class="meta">${esc(date)}${p.durationSec ? ` · ${esc(minutes(p.durationSec))}` : ""}</p>${body}</article><footer>Meeting notes shared with <a href="https://prodli.com" rel="noopener">ProdLi</a>, AI notes for any meeting, without a bot.</footer></main></body></html>`;
}

export function renderShareMissing(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Link not available</title><style>${PAGE_STYLE}</style></head><body><main><article><h1>This link isn't available</h1><p>The meeting notes may have expired, or the person who shared them stopped sharing.</p></article><footer><a href="https://prodli.com" rel="noopener">ProdLi</a></footer></main></body></html>`;
}

export const SHARE_PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
};
