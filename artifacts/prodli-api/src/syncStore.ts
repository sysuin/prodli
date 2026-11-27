// One user's synced data: the storage logic behind the UserStore Durable
// Object (src/userStore.ts). Kept free of Cloudflare APIs so it can be tested
// with any SQLite (the tests use Node's built-in one).
//
// Model: every item is (collection, id) with an `updatedAt` stamp `u`, a
// `deleted` flag and a JSON value. Every accepted write gets the next sequence
// number `s`; devices pull "everything after the last s I've seen".
// Conflicts: the newest `u` wins — the same rule the app already uses between
// tabs and devices. Equal stamps are broken by comparing the JSON, so every
// device ends up with the same result.
// Exception: Time Tracker days and the Pomodoro counter only grow, and each
// device adds its own part, so the server merges them (larger number per
// site) instead of letting one device's copy replace another's.

import { isTrackingDayValue, stripTrackingDay, TRACKING_CLEARS_ID, type TrackingClears } from "./trackingClears";

export const COLLECTIONS = ["notes", "todos", "habits", "meetings", "pomodoroSessions", "tracking", "stats", "days", "lists", "tabSessions", "quickLinks", "readLater"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];
/** Merged by taking the larger number (per key), not replaced. */
export const MERGED_COLLECTIONS: ReadonlySet<CollectionName> = new Set(["tracking", "stats"]);

/** Free plan: total stored data per user. */
export const QUOTA_BYTES = { free: 100 * 1024 * 1024, pro: 2 * 1024 * 1024 * 1024, plus: 10 * 1024 * 1024 * 1024 } as const;
/** Durable Object SQLite rows are capped at 2 MB; stay well under it. */
export const MAX_ITEM_BYTES = 1_500_000;
/** Most changes returned in one pull (the client asks again while `more`). */
export const PAGE_BYTES = 3_000_000;
export const PAGE_ITEMS = 1000;

export interface ChangeIn {
  c: CollectionName;
  id: string;
  u: string;
  d?: boolean;
  v?: unknown;
}

export interface ChangeOut {
  c: CollectionName;
  id: string;
  u: string;
  d: boolean;
  v: unknown;
  s: number;
}

export interface SyncResult {
  /** Pass this back as `since` next time. */
  seq: number;
  /** Changes from other devices (and current versions of rejected pushes). */
  changes: ChangeOut[];
  more: boolean;
  accepted: number;
  rejected: number;
  usage: { bytes: number; quota: number };
}

export interface BackupChunk {
  rows: { c: CollectionName; id: string; u: string; v: unknown }[];
  last: number;
  done: boolean;
}

export class SyncError extends Error {
  constructor(
    readonly code: "bad_request" | "item_too_large" | "quota_exceeded",
    message: string = code,
  ) {
    super(message);
  }
}

/** The subset of Durable Object `ctx.storage.sql` this module uses. */
export interface Sql {
  exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(query: string, ...bindings: unknown[]): { toArray(): T[]; one(): T };
}
type SqlValue = string | number | null | ArrayBuffer;

const isCollection = (c: unknown): c is CollectionName => typeof c === "string" && (COLLECTIONS as readonly string[]).includes(c);
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** Validates a client's list of changes; throws SyncError("bad_request"). */
export function parseChanges(raw: unknown): ChangeIn[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 5000) throw new SyncError("bad_request", "changes must be an array (max 5000)");
  return raw.map((x) => {
    const ch = x as Partial<ChangeIn> | null;
    if (!ch || !isCollection(ch.c) || typeof ch.id !== "string" || !ch.id || ch.id.length > 200 || typeof ch.u !== "string" || !STAMP.test(ch.u)) {
      throw new SyncError("bad_request", "malformed change");
    }
    if (!ch.d && ch.v === undefined) throw new SyncError("bad_request", "change without a value");
    return { c: ch.c, id: ch.id, u: ch.u, d: !!ch.d, v: ch.d ? null : ch.v };
  });
}

export class SyncStore {
  constructor(private readonly sql: Sql) {
    sql.exec(`CREATE TABLE IF NOT EXISTS items (
      c TEXT NOT NULL, id TEXT NOT NULL, u TEXT NOT NULL, d INTEGER NOT NULL DEFAULT 0,
      v TEXT, size INTEGER NOT NULL DEFAULT 0, s INTEGER NOT NULL, PRIMARY KEY (c, id))`);
    sql.exec(`CREATE INDEX IF NOT EXISTS items_by_seq ON items (s)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
  }

  /** The Time Tracker's clears record (src/trackingClears.ts), if any. */
  private trackingClears(): TrackingClears | null {
    const v = this.sql.exec<{ v: string | null }>(`SELECT v FROM items WHERE c = 'tracking' AND id = ? AND d = 0`, TRACKING_CLEARS_ID).toArray()[0]?.v;
    return v ? (JSON.parse(v) as TrackingClears) : null;
  }

  seq(): number {
    return this.sql.exec<{ n: number }>(`SELECT n FROM meta WHERE k = 'seq'`).toArray()[0]?.n ?? 0;
  }

  bytes(): number {
    return Number(this.sql.exec<{ b: number | null }>(`SELECT SUM(size) AS b FROM items`).one().b ?? 0);
  }

  /** Applies `changes` (newest wins), then returns what changed after `since`. */
  sync(since: number, changes: ChangeIn[], quota: number): SyncResult {
    let seq = this.seq();
    let bytes = this.bytes();
    let accepted = 0;
    const rejected: { c: string; id: string }[] = [];
    const mine = new Set<string>();

    const echo = new Set<string>(); // merged here: send the result back even though this device wrote it
    for (const ch of changes) {
      // Time Tracker: sites cleared after a day stay cleared, whatever an older device still sends.
      if (ch.c === "tracking" && ch.id !== TRACKING_CLEARS_ID && !ch.d && isTrackingDayValue(ch.v)) ch.v = stripTrackingDay(ch.id, ch.v, this.trackingClears(), false);
      let json = ch.d ? null : JSON.stringify(ch.v);
      if (json && json.length > MAX_ITEM_BYTES) throw new SyncError("item_too_large", `${ch.c}/${ch.id} is larger than ${MAX_ITEM_BYTES} bytes`);
      const cur = this.sql.exec<{ u: string; d: number; v: string | null; size: number }>(`SELECT u, d, v, size FROM items WHERE c = ? AND id = ?`, ch.c, ch.id).toArray()[0];
      let u = ch.u;
      if (MERGED_COLLECTIONS.has(ch.c) && cur && !cur.d && cur.v !== null && json !== null) {
        const merged = JSON.stringify(maxMerge(JSON.parse(cur.v), ch.v));
        if (merged === cur.v) {
          if (merged !== json) rejected.push(ch); // the device is behind: send it the server's numbers
          continue;
        }
        if (merged !== json) echo.add(`${ch.c}\u0000${ch.id}`);
        json = merged;
        u = ch.u > cur.u ? ch.u : cur.u;
      } else if (cur && !newer(ch.u, json, cur.u, cur.v)) {
        rejected.push(ch);
        continue;
      }
      const size = (json?.length ?? 0) + ch.id.length + 40;
      const grow = size - (cur?.size ?? 0);
      if (grow > 0 && bytes + grow > quota) throw new SyncError("quota_exceeded");
      seq += 1;
      this.sql.exec(
        `INSERT INTO items (c, id, u, d, v, size, s) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (c, id) DO UPDATE SET u = excluded.u, d = excluded.d, v = excluded.v, size = excluded.size, s = excluded.s`,
        ch.c, ch.id, u, ch.d ? 1 : 0, json, size, seq,
      );
      bytes += grow;
      accepted += 1;
      if (ch.c === "tracking" && ch.id === TRACKING_CLEARS_ID && json) {
        // A clear: remove those sites from the stored days now (including the day of the clear).
        const clears = JSON.parse(json) as TrackingClears;
        for (const row of this.sql.exec<{ id: string; v: string; size: number }>(`SELECT id, v, size FROM items WHERE c = 'tracking' AND d = 0 AND id != ? AND v IS NOT NULL`, TRACKING_CLEARS_ID).toArray()) {
          const day = JSON.parse(row.v) as unknown;
          if (!isTrackingDayValue(day)) continue;
          const next = stripTrackingDay(row.id, day, clears, true);
          if (next === day) continue;
          const v = JSON.stringify(next);
          const size = v.length + row.id.length + 40;
          seq += 1;
          this.sql.exec(`UPDATE items SET v = ?, size = ?, u = ?, s = ? WHERE c = 'tracking' AND id = ?`, v, size, u, seq, row.id);
          bytes += size - row.size;
        }
      }
      const key = `${ch.c}\u0000${ch.id}`;
      if (!echo.has(key)) mine.add(key);
    }
    if (accepted) this.sql.exec(`INSERT INTO meta (k, n) VALUES ('seq', ?) ON CONFLICT (k) DO UPDATE SET n = excluded.n`, seq);

    // Changes after `since`, minus what this request itself just wrote.
    const out: ChangeOut[] = [];
    let cursor = since;
    let budget = PAGE_BYTES;
    let more = false;
    const rows = this.sql
      .exec<{ c: CollectionName; id: string; u: string; d: number; v: string | null; s: number }>(`SELECT c, id, u, d, v, s FROM items WHERE s > ? ORDER BY s LIMIT ?`, since, PAGE_ITEMS + 1)
      .toArray();
    for (const [i, r] of rows.entries()) {
      if (i === PAGE_ITEMS || (out.length > 0 && budget - (r.v?.length ?? 0) < 0)) {
        more = true;
        break;
      }
      cursor = r.s;
      if (mine.has(`${r.c}\u0000${r.id}`)) continue;
      budget -= r.v?.length ?? 0;
      out.push(toChange(r));
    }
    if (!more) cursor = Math.max(cursor, seq);

    // The server's version of every rejected push, so the device can catch up
    // even if it has already seen that sequence number.
    const seen = new Set(out.map((o) => `${o.c}\u0000${o.id}`));
    for (const r of rejected) {
      if (seen.has(`${r.c}\u0000${r.id}`)) continue;
      const row = this.sql.exec<{ c: CollectionName; id: string; u: string; d: number; v: string | null; s: number }>(`SELECT c, id, u, d, v, s FROM items WHERE c = ? AND id = ?`, r.c, r.id).toArray()[0];
      if (row) out.push(toChange(row));
    }

    return { seq: cursor, changes: out, more, accepted, rejected: rejected.length, usage: { bytes, quota } };
  }

  /** Every live item, grouped by collection (for "Download my data"). */
  exportAll(): Record<CollectionName, unknown[]> {
    const out = Object.fromEntries(COLLECTIONS.map((c) => [c, [] as unknown[]])) as Record<CollectionName, unknown[]>;
    for (const r of this.sql.exec<{ c: CollectionName; id: string; v: string }>(`SELECT c, id, v FROM items WHERE d = 0 ORDER BY c, id`).toArray()) {
      out[r.c]?.push(r.c === "tracking" || r.c === "stats" ? { id: r.id, value: JSON.parse(r.v) } : JSON.parse(r.v));
    }
    return out;
  }

  /**
   * Live (not deleted) items of one collection, or the one with `id`, for the
   * read-only API (src/readApi.ts). `drop` leaves out top-level fields (meeting
   * transcripts) inside SQLite, so they're never copied out when not needed.
   */
  readLive(c: CollectionName, opts: { id?: string; drop?: string[] } = {}): unknown[] {
    const paths = (opts.drop ?? []).filter((k) => /^[A-Za-z]{1,40}$/.test(k)).map((k) => `$.${k}`);
    const value = paths.length ? `json_remove(v, ${paths.map(() => "?").join(", ")})` : "v";
    const byId = opts.id !== undefined;
    const rows = this.sql.exec<{ v: string }>(`SELECT ${value} AS v FROM items WHERE c = ? AND d = 0${byId ? " AND id = ?" : ""}`, ...paths, c, ...(byId ? [opts.id] : [])).toArray();
    return rows.map((r) => JSON.parse(r.v) as unknown);
  }

  /** Live items after sequence number `after`, up to ~`maxBytes` (for backups). */
  backupChunk(after: number, maxBytes: number): BackupChunk {
    const rows: { c: CollectionName; id: string; u: string; v: unknown }[] = [];
    let last = after;
    let bytes = 0;
    for (;;) {
      const page = this.sql.exec<{ c: CollectionName; id: string; u: string; v: string; s: number }>(`SELECT c, id, u, v, s FROM items WHERE s > ? AND d = 0 ORDER BY s LIMIT 200`, last).toArray();
      if (!page.length) return { rows, last, done: true };
      for (const r of page) {
        rows.push({ c: r.c, id: r.id, u: r.u, v: JSON.parse(r.v) });
        last = r.s;
        bytes += r.v.length;
        if (bytes >= maxBytes) return { rows, last, done: false };
      }
    }
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.sql.exec<{ c: string; n: number }>(`SELECT c, COUNT(*) AS n FROM items WHERE d = 0 GROUP BY c`).toArray()) out[r.c] = r.n;
    return out;
  }
}

/** Larger number wins, per key for objects (Time Tracker: site → seconds). Same rule as the app's syncCore.maxMerge. */
export function maxMerge(a: unknown, b: unknown): unknown {
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = k in out ? maxMerge(out[k], v) : v;
    return out;
  }
  return a === undefined || a === null ? b : a;
}

/** Does the incoming version win over the stored one? */
export function newer(u: string, json: string | null, curU: string, curJson: string | null): boolean {
  if (u !== curU) return u > curU;
  return (json ?? "") > (curJson ?? "");
}

function toChange(r: { c: CollectionName; id: string; u: string; d: number; v: string | null; s: number }): ChangeOut {
  return { c: r.c, id: r.id, u: r.u, d: !!r.d, v: r.v === null ? null : JSON.parse(r.v), s: r.s };
}
