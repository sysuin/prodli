// Shared videos (🎥 Record a video → Get a share link): the recording is
// uploaded to R2 in fixed-size parts and gets a page at /v/<id> with the
// video, its notes and transcript. Anyone with the link can watch (unlisted,
// like Loom); it stays until the owner stops sharing or deletes their account.
// Limits per plan (decided 2026-11-27): Free 25 videos up to 5 min each, Pro
// unlimited up to 45 min, Pro Plus up to 2 h. Plan: docs/PLAN-SCREEN-RECORDER.md.

import { z } from "zod/v4";
import { esc, list, minutes, section, PAGE_STYLE } from "./shares";

export const VIDEO_LIMITS = {
  free: { videos: 25 as number | null, maxSec: 5 * 60 },
  pro: { videos: null as number | null, maxSec: 45 * 60 },
  plus: { videos: null as number | null, maxSec: 2 * 60 * 60 },
} as const;
export const videoLimit = (plan: string) => VIDEO_LIMITS[plan as keyof typeof VIDEO_LIMITS] ?? VIDEO_LIMITS.free;

/** Every part but the last is exactly this size (R2 wants equal parts). */
export const PART_SIZE = 10 * 1024 * 1024;
/** Generous ceiling on the file size for its length (about 12 Mbit/s, plus room for the header). */
export const maxBytesFor = (sec: number) => Math.ceil(sec * 1_500_000) + 8 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 400_000;

const line = (n: number) => z.string().max(n);

export const CreateVideoSchema = z.object({
  meetingId: z.string().min(1).max(100),
  title: line(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSec: z.number().int().min(1).max(VIDEO_LIMITS.plus.maxSec),
  size: z.number().int().min(1),
  mime: z.string().regex(/^video\/(webm|mp4)(;[a-z0-9=,. -]*)?$/i),
});
export type CreateVideoInput = z.infer<typeof CreateVideoSchema>;

/** What the page shows besides the video. Sent at the end of the upload, and again when the notes are ready. */
export const VideoDetailsSchema = z.object({
  title: line(300).optional(),
  summary: z
    .object({
      overview: line(4000),
      keyPoints: z.array(line(600)).max(30),
      decisions: z.array(line(600)).max(20),
      actionItems: z.array(z.object({ task: line(400), owner: line(120).nullable(), dueDate: z.string().max(10).nullable() })).max(40),
      openQuestions: z.array(line(600)).max(20),
    })
    .nullable()
    .optional(),
  transcript: z
    .array(z.object({ at: z.number().int().min(0), speaker: line(80), text: line(2000) }))
    .max(4000)
    .optional(),
});
export type VideoDetails = z.infer<typeof VideoDetailsSchema>;

export interface VideoRow {
  id: string;
  user_id: string;
  meeting_id: string;
  title: string;
  duration_sec: number;
  size: number;
  mime: string;
  key: string;
  upload_id: string | null;
  parts: string;
  status: "uploading" | "ready";
  payload: string;
  created_at: number;
  updated_at: number;
  views: number;
}

export const partCount = (size: number) => Math.max(1, Math.ceil(size / PART_SIZE));
export const partLength = (size: number, n: number) => (n < partCount(size) ? PART_SIZE : size - (partCount(size) - 1) * PART_SIZE);

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class VideoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 402 | 403 | 404 | 409 | 413 | 429 = 400,
  ) {
    super(message);
  }
}

export async function countVideos(db: D1Database, userId: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM videos WHERE user_id = ?1`).bind(userId).first<{ n: number }>())?.n ?? 0;
}

export const getVideo = (db: D1Database, userId: string, id: string) => db.prepare(`SELECT * FROM videos WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first<VideoRow>();

/** Starts the upload of a recording (or returns its link if it's already shared). Checks the plan's limits. */
export async function createVideo(db: D1Database, bucket: R2Bucket, userId: string, plan: string, input: CreateVideoInput, now: number): Promise<{ row: VideoRow; uploaded: boolean }> {
  const limit = videoLimit(plan);
  if (input.durationSec > limit.maxSec) {
    throw new VideoError("video_too_long", plan === "free" ? `Free accounts can share videos up to ${limit.maxSec / 60} minutes. ProdLi Pro shares up to 45 minutes.` : `Videos up to ${minutes(limit.maxSec)} can be shared on your plan.`, 402);
  }
  if (input.size > maxBytesFor(input.durationSec)) throw new VideoError("too_large", "This video file is larger than expected for its length.", 413);
  const existing = await db.prepare(`SELECT * FROM videos WHERE user_id = ?1 AND meeting_id = ?2`).bind(userId, input.meetingId).first<VideoRow>();
  if (existing?.status === "ready" && existing.size === input.size) return { row: existing, uploaded: true };
  if (!existing && limit.videos !== null && (await countVideos(db, userId)) >= limit.videos) {
    throw new VideoError("video_quota_exceeded", `Free accounts can share ${limit.videos} videos. Stop sharing one, or get ProdLi Pro for unlimited videos.`, 402);
  }
  // A new file for this recording (or a restart): drop the old one.
  if (existing) await removeObject(bucket, existing);
  const id = existing?.id ?? newId();
  const key = `v/${userId}/${id}-${now}`;
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: input.mime.split(";")[0] } });
  if (existing) {
    await db
      .prepare(`UPDATE videos SET title = ?1, duration_sec = ?2, size = ?3, mime = ?4, key = ?5, upload_id = ?6, parts = '[]', status = 'uploading', updated_at = ?7 WHERE id = ?8`)
      .bind(input.title, input.durationSec, input.size, input.mime, key, upload.uploadId, now, id)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO videos (id, user_id, meeting_id, title, duration_sec, size, mime, key, upload_id, parts, status, payload, created_at, updated_at, views) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', 'uploading', ?10, ?11, ?11, 0)`)
      .bind(id, userId, input.meetingId, input.title, input.durationSec, input.size, input.mime, key, upload.uploadId, JSON.stringify({ date: input.date }), now)
      .run();
  }
  return { row: (await getVideo(db, userId, id))!, uploaded: false };
}

/** Stores one part. Every part but the last must be exactly PART_SIZE. */
export async function uploadPart(db: D1Database, bucket: R2Bucket, row: VideoRow, n: number, body: ArrayBuffer): Promise<void> {
  if (row.status !== "uploading" || !row.upload_id) throw new VideoError("not_uploading", "This video is already uploaded.", 409);
  if (!Number.isInteger(n) || n < 1 || n > partCount(row.size)) throw new VideoError("bad_part", "That part isn't part of this video.");
  if (body.byteLength !== partLength(row.size, n)) throw new VideoError("bad_part", "That part has the wrong size.");
  const part = await bucket.resumeMultipartUpload(row.key, row.upload_id).uploadPart(n, body);
  const parts = (JSON.parse(row.parts) as R2UploadedPart[]).filter((p) => p.partNumber !== n);
  parts.push({ partNumber: part.partNumber, etag: part.etag });
  await db.prepare(`UPDATE videos SET parts = ?1 WHERE id = ?2`).bind(JSON.stringify(parts), row.id).run();
}

/** Finishes the upload: the link works from now on. */
export async function completeVideo(db: D1Database, bucket: R2Bucket, row: VideoRow, details: VideoDetails, now: number): Promise<VideoRow> {
  if (row.status === "ready") return updateDetails(db, row, details, now);
  if (!row.upload_id) throw new VideoError("not_uploading", "This video isn't being uploaded.", 409);
  const parts = (JSON.parse(row.parts) as R2UploadedPart[]).sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== partCount(row.size)) throw new VideoError("missing_parts", "Some of the video hasn't been uploaded yet.", 409);
  await bucket.resumeMultipartUpload(row.key, row.upload_id).complete(parts);
  await db.prepare(`UPDATE videos SET status = 'ready', upload_id = NULL, parts = '[]', updated_at = ?1 WHERE id = ?2`).bind(now, row.id).run();
  return updateDetails(db, { ...row, status: "ready", upload_id: null }, details, now);
}

/** New title or notes for the page (the notes are written after the recording). */
export async function updateDetails(db: D1Database, row: VideoRow, details: VideoDetails, now: number): Promise<VideoRow> {
  const payload = { ...(JSON.parse(row.payload) as Record<string, unknown>) };
  if (details.summary !== undefined) payload.summary = details.summary;
  if (details.transcript !== undefined) payload.transcript = details.transcript;
  const json = JSON.stringify(payload);
  if (json.length > MAX_PAYLOAD_BYTES) throw new VideoError("too_large", "These notes are too long to show with the video.", 413);
  await db.prepare(`UPDATE videos SET title = ?1, payload = ?2, updated_at = ?3 WHERE id = ?4`).bind(details.title ?? row.title, json, now, row.id).run();
  return (await getVideo(db, row.user_id, row.id))!;
}

async function removeObject(bucket: R2Bucket, row: VideoRow): Promise<void> {
  if (row.upload_id) await bucket.resumeMultipartUpload(row.key, row.upload_id).abort().catch(() => undefined);
  await bucket.delete(row.key).catch(() => undefined);
}

/** Stops sharing: removes the file and the page. */
export async function deleteVideo(db: D1Database, bucket: R2Bucket, row: VideoRow): Promise<void> {
  await removeObject(bucket, row);
  await db.prepare(`DELETE FROM videos WHERE id = ?1`).bind(row.id).run();
}

/** Account deletion: every shared video's file. (The rows go with the user.) */
export async function deleteUserVideos(db: D1Database, bucket: R2Bucket | undefined, userId: string): Promise<void> {
  const { results } = await db.prepare(`SELECT * FROM videos WHERE user_id = ?1`).bind(userId).all<VideoRow>();
  for (const row of results) if (bucket) await removeObject(bucket, row);
  await db.prepare(`DELETE FROM videos WHERE user_id = ?1`).bind(userId).run();
}

export const listVideos = async (db: D1Database, userId: string) => (await db.prepare(`SELECT * FROM videos WHERE user_id = ?1 ORDER BY created_at DESC`).bind(userId).all<VideoRow>()).results;

export async function openVideo(db: D1Database, id: string): Promise<VideoRow | null> {
  const row = await db.prepare(`SELECT * FROM videos WHERE id = ?1 AND status = 'ready'`).bind(id).first<VideoRow>();
  return row ?? null;
}

export const countView = (db: D1Database, id: string) => db.prepare(`UPDATE videos SET views = views + 1 WHERE id = ?1`).bind(id).run();

/** "bytes=a-b" / "bytes=a-" / "bytes=-n" → offset and length within `size`, or null when absent or unsatisfiable. */
export function parseRange(header: string | null | undefined, size: number): { offset: number; length: number } | null | "bad" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "bad";
  let start: number;
  let end: number;
  if (!m[1]) {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return "bad";
  return { offset: start, length: end - start + 1 };
}

/** The video file, with byte ranges (players seek with them). */
export async function streamVideo(bucket: R2Bucket, row: VideoRow, rangeHeader: string | null): Promise<Response> {
  const head = await bucket.head(row.key);
  if (!head) return new Response("Not found", { status: 404 });
  const size = head.size;
  const range = parseRange(rangeHeader, size);
  const base = { "Content-Type": row.mime.split(";")[0], "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
  if (range === "bad") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  const obj = await bucket.get(row.key, range ? { range } : undefined);
  if (!obj || !("body" in obj)) return new Response("Not found", { status: 404 });
  if (!range) return new Response(obj.body, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  return new Response(obj.body, { status: 206, headers: { ...base, "Content-Length": String(range.length), "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` } });
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The public page: the video, then its notes and transcript (escaped; no scripts). */
export function renderVideoPage(row: VideoRow, origin: string): string {
  const p = JSON.parse(row.payload) as { date?: string; summary?: VideoDetails["summary"]; transcript?: VideoDetails["transcript"] };
  const s = p.summary;
  const date = p.date ? new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const title = esc(row.title || "Video");
  const notes = s
    ? [
        s.overview ? `<p>${esc(s.overview)}</p>` : "",
        section("Key points", list(s.keyPoints)),
        section("Decisions", list(s.decisions)),
        section("Action items", s.actionItems.length ? `<ul>${s.actionItems.map((a) => `<li>${esc(a.task)}${a.owner || a.dueDate ? ` <span class="who">— ${esc([a.owner, a.dueDate].filter(Boolean).join(", "))}</span>` : ""}</li>`).join("")}</ul>` : ""),
        section("Open questions", list(s.openQuestions)),
      ].join("")
    : "";
  const transcript = p.transcript?.length
    ? `<details><summary>Transcript</summary><div class="tr">${p.transcript.map((t) => `<p><span class="ts">${clock(t.at)}</span> ${t.speaker ? `<strong>${esc(t.speaker)}:</strong> ` : ""}${esc(t.text)}</p>`).join("")}</div></details>`
    : "";
  const src = `${origin}/v/${encodeURIComponent(row.id)}/video`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} · Video</title><meta property="og:type" content="video.other"><meta property="og:title" content="${title}"><meta property="og:video" content="${esc(src)}"><style>${PAGE_STYLE}${VIDEO_STYLE}</style></head><body><main class="wide"><article><h1>${title}</h1><p class="meta">${esc(date)}${row.duration_sec ? ` · ${esc(minutes(row.duration_sec))}` : ""}</p><video controls playsinline preload="metadata" src="${esc(src)}"></video>${notes}${transcript}</article><footer>Video shared with <a href="https://prodli.com" rel="noopener">ProdLi</a>: screen recordings with AI notes, free to start.</footer></main></body></html>`;
}

const VIDEO_STYLE = `main.wide{max-width:960px}video{display:block;width:100%;max-height:72vh;background:#000;border:3px solid #000;margin:8px 0 12px}details{margin-top:20px;border-top:2px solid #000;padding-top:8px}summary{cursor:pointer;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.08em}.tr p{margin:6px 0}.ts{font:12px ui-monospace,Menlo,monospace;color:#777;margin-right:4px}@media (prefers-color-scheme:dark){video,details{border-color:#eee}.ts{color:#aaa}}`;

export function renderVideoMissing(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Video not available</title><style>${PAGE_STYLE}</style></head><body><main><article><h1>This video isn't available</h1><p>The person who shared it may have stopped sharing, or it's still uploading. Try again in a minute.</p></article><footer><a href="https://prodli.com" rel="noopener">ProdLi</a></footer></main></body></html>`;
}

export const VIDEO_PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** What the app gets back about a video. */
export const videoJson = (origin: string, r: VideoRow) => ({
  id: r.id,
  url: `${origin}/v/${r.id}`,
  meetingId: r.meeting_id,
  title: r.title,
  durationSec: r.duration_sec,
  size: r.size,
  status: r.status,
  partSize: PART_SIZE,
  parts: r.status === "uploading" ? (JSON.parse(r.parts) as R2UploadedPart[]).map((p) => p.partNumber) : [],
  views: r.views,
  createdAt: r.created_at,
});
