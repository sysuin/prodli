// Shared videos: upload in parts, the public page and file (with byte ranges), plan limits, deletion.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { maxBytesFor, parseRange, PART_SIZE, partCount, partLength, VIDEO_LIMITS } from "../src/videos";
import type { Env } from "../src/app";
import { fakeR2 } from "./fakeR2";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["videos", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
});

type Bucket = ReturnType<typeof fakeR2>;
const withVideos = () => ({ ...base, VIDEOS: fakeR2() }) as Env & { VIDEOS: Bucket };
async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env, who = "v") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { headers: { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN }, id: body.user.id };
}
const bytes = (n: number, seed = 1) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255;
  return b;
};
const meta = (over: Record<string, unknown> = {}) => ({ meetingId: "mtg_1", title: "Onboarding walkthrough", date: "2026-11-27", durationSec: 120, size: PART_SIZE + 1000, mime: "video/webm;codecs=vp9,opus", ...over });

/** Uploads a whole file the way the app does: equal parts, then complete. */
async function upload(app: ReturnType<typeof makeApp>["app"], env: Env, headers: Record<string, string>, file: Uint8Array, over: Record<string, unknown> = {}) {
  const res = await app.request("/api/videos", json(meta({ size: file.length, ...over }), headers), env);
  const body = (await res.json()) as { video: { id: string; url: string; partSize: number }; uploaded: boolean };
  if (res.status !== 200) return { res, body };
  for (let n = 1; n <= partCount(file.length); n++) {
    const part = file.slice((n - 1) * PART_SIZE, n * PART_SIZE);
    const r = await app.request(`/api/videos/${body.video.id}/parts/${n}`, { method: "PUT", body: part, headers: { ...headers, "Content-Length": String(part.length) } }, env);
    expect(r.status).toBe(200);
  }
  return { res, body };
}

describe("video helpers", () => {
  it("splits files into equal parts and reads byte ranges", () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(PART_SIZE)).toBe(1);
    expect(partCount(PART_SIZE + 1)).toBe(2);
    expect(partLength(PART_SIZE + 5, 1)).toBe(PART_SIZE);
    expect(partLength(PART_SIZE + 5, 2)).toBe(5);
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
    expect(parseRange("bytes=90-", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=-5", 100)).toEqual({ offset: 95, length: 5 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ offset: 50, length: 50 });
    expect(parseRange("bytes=200-", 100)).toBe("bad");
    expect(parseRange("items=1-2", 100)).toBe("bad");
    expect(maxBytesFor(60)).toBeGreaterThan(60 * 1_000_000);
  });
});

describe("shared videos", () => {
  it("uploads in parts, completes, and serves a page and the file with byte ranges", async () => {
    const { app } = makeApp();
    const env = withVideos();
    const { headers } = await signIn(app, env);
    const file = bytes(PART_SIZE + 1000);
    const { res, body } = await upload(app, env, headers, file);
    expect(res.status).toBe(200);
    expect(body.uploaded).toBe(false);
    expect(body.video.url).toMatch(/\/v\/[\w-]+$/);
    // Not public until it's complete.
    expect((await app.request(`/v/${body.video.id}`, {}, env)).status).toBe(404);
    const done = await app.request(`/api/videos/${body.video.id}/complete`, json({ summary: { overview: "A walk through <b>onboarding</b>.", keyPoints: ["Step one"], decisions: [], actionItems: [{ task: "Fix the button", owner: "Sam", dueDate: null }], openQuestions: [] }, transcript: [{ at: 65_000, speaker: "You", text: "Here is the new flow." }] }, headers), env);
    expect(done.status).toBe(200);
    expect(((await done.json()) as { video: { status: string } }).video.status).toBe("ready");

    const page = await app.request(`/v/${body.video.id}`, {}, env);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Security-Policy")).toContain("media-src 'self'");
    expect(page.headers.get("X-Robots-Tag")).toContain("noindex");
    const html = await page.text();
    expect(html).toContain("<h1>Onboarding walkthrough</h1>");
    expect(html).toContain(`/v/${body.video.id}/video`);
    expect(html).toContain("A walk through &lt;b&gt;onboarding&lt;/b&gt;.");
    expect(html).toContain("Fix the button");
    expect(html).toContain("1:05");
    expect(html).not.toContain("<script");

    const whole = await app.request(`/v/${body.video.id}/video`, {}, env);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Type")).toBe("video/webm");
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(file);
    const part = await app.request(`/v/${body.video.id}/video`, { headers: { Range: `bytes=${PART_SIZE - 2}-${PART_SIZE + 1}` } }, env);
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe(`bytes ${PART_SIZE - 2}-${PART_SIZE + 1}/${file.length}`);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...file.slice(PART_SIZE - 2, PART_SIZE + 2)]);
    expect((await app.request(`/v/${body.video.id}/video`, { headers: { Range: `bytes=${file.length + 5}-` } }, env)).status).toBe(416);

    // Views are counted; the owner sees them.
    const list = (await (await app.request("/api/videos", { headers }, env)).json()) as { videos: { id: string; views: number }[]; limits: { videos: number | null } };
    expect(list.videos.map((v) => v.id)).toEqual([body.video.id]);
    expect(list.limits.videos).toBe(VIDEO_LIMITS.free.videos);

    // Sharing the same recording again returns the same link without a new upload.
    const again = await app.request("/api/videos", json(meta({ size: file.length }), headers), env);
    expect(((await again.json()) as { uploaded: boolean; video: { id: string } }).video.id).toBe(body.video.id);
  }, 60_000);

  it("rejects wrong parts and won't complete with parts missing", async () => {
    const { app } = makeApp();
    const env = withVideos();
    const { headers } = await signIn(app, env);
    const res = await app.request("/api/videos", json(meta(), headers), env);
    const { video } = (await res.json()) as { video: { id: string } };
    expect((await app.request(`/api/videos/${video.id}/parts/1`, { method: "PUT", body: bytes(100), headers }, env)).status).toBe(400);
    expect((await app.request(`/api/videos/${video.id}/parts/3`, { method: "PUT", body: bytes(1000), headers }, env)).status).toBe(400);
    expect((await app.request(`/api/videos/${video.id}/parts/2`, { method: "PUT", body: bytes(1000), headers }, env)).status).toBe(200);
    const early = await app.request(`/api/videos/${video.id}/complete`, json({}, headers), env);
    expect(early.status).toBe(409);
    expect((await app.request(`/api/videos/${video.id}/parts/1`, { method: "PUT", body: bytes(PART_SIZE + 1), headers: { ...headers, "Content-Length": String(PART_SIZE + 1) } }, env)).status).toBe(413);
    // Someone else can't touch it.
    const other = await signIn(app, env, "w");
    expect((await app.request(`/api/videos/${video.id}/parts/2`, { method: "PUT", body: bytes(1000), headers: other.headers }, env)).status).toBe(404);
    expect((await app.request(`/api/videos/${video.id}`, { method: "DELETE", headers: other.headers }, env)).status).toBe(404);
  });

  it("enforces the plan's length and count limits", async () => {
    const { app } = makeApp();
    const env = withVideos();
    const { headers, id } = await signIn(app, env);
    const long = await app.request("/api/videos", json(meta({ durationSec: 6 * 60, size: 1000 }), headers), env);
    expect(long.status).toBe(402);
    expect(((await long.json()) as { error: string; message: string }).message).toMatch(/up to 5 minutes/);
    expect((await app.request("/api/videos", json(meta({ durationSec: 10, size: 200_000_000 }), headers), env)).status).toBe(413);
    for (let i = 0; i < VIDEO_LIMITS.free.videos!; i++) {
      await env.DB.prepare(`INSERT INTO videos (id, user_id, meeting_id, title, duration_sec, size, mime, key, status, created_at, updated_at) VALUES (?1, ?2, ?3, 't', 10, 10, 'video/webm', ?4, 'ready', 1, 1)`).bind(`x${i}`, id, `m${i}`, `k${i}`).run();
    }
    const over = await app.request("/api/videos", json(meta({ meetingId: "mtg_new", size: 1000 }), headers), env);
    expect(over.status).toBe(402);
    expect(((await over.json()) as { error: string }).error).toBe("video_quota_exceeded");
    // Pro: longer and unlimited.
    await env.DB.prepare(`UPDATE users SET plan = 'pro' WHERE id = ?1`).bind(id).run();
    expect((await app.request("/api/videos", json(meta({ meetingId: "mtg_pro", durationSec: 40 * 60, size: 1000 }), headers), env)).status).toBe(200);
    expect((await app.request("/api/videos", json(meta({ meetingId: "mtg_pro2", durationSec: 50 * 60, size: 1000 }), headers), env)).status).toBe(402);
  });

  it("updates the notes later, stops sharing, and cleans up with the account", async () => {
    const { app } = makeApp();
    const env = withVideos();
    const { headers } = await signIn(app, env);
    const file = bytes(5000);
    const { body } = await upload(app, env, headers, file);
    await app.request(`/api/videos/${body.video.id}/complete`, json({}, headers), env);
    const upd = await app.request(`/api/videos/${body.video.id}`, { method: "PUT", body: JSON.stringify({ title: "Renamed", summary: { overview: "Later notes", keyPoints: [], decisions: [], actionItems: [], openQuestions: [] } }), headers: { ...headers, "Content-Type": "application/json" } }, env);
    expect(upd.status).toBe(200);
    expect(await (await app.request(`/v/${body.video.id}`, {}, env)).text()).toContain("Later notes");
    expect(env.VIDEOS.objects.size).toBe(1);
    expect((await app.request(`/api/videos/${body.video.id}`, { method: "DELETE", headers }, env)).status).toBe(200);
    expect(env.VIDEOS.objects.size).toBe(0);
    expect((await app.request(`/v/${body.video.id}`, {}, env)).status).toBe(404);
    // Another one, then delete the account: its file goes too.
    const second = await upload(app, env, headers, bytes(3000), { meetingId: "mtg_2" });
    await app.request(`/api/videos/${second.body.video.id}/complete`, json({}, headers), env);
    expect(env.VIDEOS.objects.size).toBe(1);
    const del = await app.request("/api/account", { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "v@example.com" }) }, env);
    expect(del.status).toBe(200);
    expect(env.VIDEOS.objects.size).toBe(0);
  });

  it("says when video links aren't set up", async () => {
    const { app } = makeApp();
    const { headers } = await signIn(app, base);
    expect((await app.request("/api/videos", json(meta(), headers), base)).status).toBe(503);
  });
});
