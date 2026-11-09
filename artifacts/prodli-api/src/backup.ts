// Phase 5: nightly backups of every user's synced data to R2 ("prodli-backups",
// objects expire after 30 days via a bucket lifecycle rule), plus the restore
// used by the admin endpoint and the restore drill (docs/LAUNCH-CHECKLIST.md).
//
// Layout: users/<userId>/<YYYY-MM-DD>/part-0001.ndjson … — one JSON line per
// item ({c, id, u, v}), written in ~4 MB parts so even a 100 MB account never
// has to fit in memory at once.
//
// Durable Objects and D1 also keep 30 days of point-in-time recovery on
// Cloudflare's side; these files are an independent copy we control.

import type { Env } from "./app";
import type { BackupChunk, ChangeIn } from "./syncStore";

const PART_BYTES = 4 * 1024 * 1024;
/** Back up unchanged accounts at least weekly, so a copy always exists within the 30-day expiry. */
const REFRESH_MS = 7 * 86_400_000;
/** Stop starting new users after this long; the rest go first tomorrow (oldest backup first). */
const RUN_BUDGET_MS = 10 * 60_000;

const storeFor = (env: Env, userId: string) => env.USER_STORE.get(env.USER_STORE.idFromName(userId));
export const backupPrefix = (userId: string) => `users/${userId}/`;

export interface BackupRun {
  backedUp: number;
  skipped: number;
  failed: number;
  remaining: boolean;
}

/** Backs up one user if their data changed (or the last copy is getting old). */
export async function backupUser(env: Env, userId: string, now: number, force = false): Promise<"done" | "skipped"> {
  if (!env.BACKUPS) throw new Error("BACKUPS bucket not bound");
  const stub = storeFor(env, userId);
  const seq = await stub.seq();
  const prev = await env.DB.prepare(`SELECT seq, at FROM backups WHERE user_id = ?1`).bind(userId).first<{ seq: number; at: number }>();
  if (!force && (seq === 0 || (prev && prev.seq === seq && now - prev.at < REFRESH_MS))) return "skipped";

  const prefix = `${backupPrefix(userId)}${new Date(now).toISOString().slice(0, 10)}/`;
  let after = 0;
  let part = 0;
  for (;;) {
    const chunk = (await stub.backupChunk(after, PART_BYTES)) as BackupChunk;
    if (chunk.rows.length || part === 0) {
      part += 1;
      const body = chunk.rows.map((r) => JSON.stringify(r)).join("\n");
      await env.BACKUPS.put(`${prefix}part-${String(part).padStart(4, "0")}.ndjson`, body, {
        httpMetadata: { contentType: "application/x-ndjson" },
        customMetadata: { seq: String(seq), done: String(chunk.done) },
      });
    }
    after = chunk.last;
    if (chunk.done) break;
  }
  await env.DB.prepare(
    `INSERT INTO backups (user_id, seq, at, key) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, at = excluded.at, key = excluded.key`,
  )
    .bind(userId, seq, now, prefix)
    .run();
  return "done";
}

/** The nightly cron: users whose backup is oldest go first. */
export async function runBackups(env: Env, now: number, clock: () => number = Date.now): Promise<BackupRun> {
  const run: BackupRun = { backedUp: 0, skipped: 0, failed: 0, remaining: false };
  const started = clock();
  let offset = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT u.id FROM users u LEFT JOIN backups b ON b.user_id = u.id ORDER BY COALESCE(b.at, 0) ASC, u.id LIMIT 200 OFFSET ?1`,
    )
      .bind(offset)
      .all<{ id: string }>();
    if (!results.length) break;
    for (const { id } of results) {
      if (clock() - started > RUN_BUDGET_MS) {
        run.remaining = true;
        return run;
      }
      try {
        (await backupUser(env, id, now)) === "done" ? run.backedUp++ : run.skipped++;
      } catch (err) {
        run.failed++;
        console.error(JSON.stringify({ msg: "backup_failed", user: id, error: err instanceof Error ? err.message : String(err) }));
      }
    }
    offset += results.length;
  }
  console.log(JSON.stringify({ msg: "backups_done", ...run }));
  return run;
}

/** Account deleted: remove its backups now rather than waiting for them to expire. */
export async function deleteBackups(env: Env, userId: string): Promise<void> {
  if (!env.BACKUPS) return;
  // List everything first, then delete (never delete while paging a listing).
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.BACKUPS.list({ prefix: backupPrefix(userId), cursor });
    keys.push(...list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < keys.length; i += 1000) await env.BACKUPS.delete(keys.slice(i, i + 1000));
}

/** Dates (YYYY-MM-DD) with a backup for this user, newest first. */
export async function listBackups(env: Env, userId: string): Promise<string[]> {
  if (!env.BACKUPS) return [];
  const dates = new Set<string>();
  let cursor: string | undefined;
  do {
    const list = await env.BACKUPS.list({ prefix: backupPrefix(userId), cursor });
    for (const o of list.objects) dates.add(o.key.slice(backupPrefix(userId).length, backupPrefix(userId).length + 10));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return [...dates].sort().reverse();
}

/** Puts a backup back. "merge" keeps anything newer on the server; "overwrite" makes the backup's versions win. */
export async function restoreUser(env: Env, userId: string, date: string, mode: "merge" | "overwrite", now: number): Promise<{ items: number; accepted: number }> {
  if (!env.BACKUPS) throw new Error("BACKUPS bucket not bound");
  const prefix = `${backupPrefix(userId)}${date}/`;
  const list = await env.BACKUPS.list({ prefix });
  if (!list.objects.length) throw new Error("no backup for that date");
  const stamp = new Date(now).toISOString();
  let items = 0;
  let accepted = 0;
  for (const o of list.objects.sort((a, b) => a.key.localeCompare(b.key))) {
    const text = await (await env.BACKUPS.get(o.key))!.text();
    const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChangeIn);
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({ c: r.c, id: r.id, u: mode === "overwrite" ? stamp : r.u, v: r.v }));
      items += batch.length;
      accepted += await storeFor(env, userId).restore(batch, "restore");
    }
  }
  return { items, accepted };
}
