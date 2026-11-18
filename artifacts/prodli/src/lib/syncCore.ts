// Pure logic of ProdLi sync (no storage, no network), unit-tested in
// tests/unit/syncCore.test.ts. The I/O lives in prodliSync.ts.
//
// Each device remembers a "shadow": for every item, a fingerprint of the
// version the server is known to have. Anything whose local fingerprint
// differs has changed here and is pushed. Items in the shadow that are gone
// locally were deleted here.
//
// Two kinds of collections:
// - "lww" (notes, to-dos, habits, meetings, Pomodoro sessions): whole items;
//   the newest `updatedAt` wins — the rule the app already uses between tabs.
// - "max" (Time Tracker days, the Pomodoro counter): numbers that only grow;
//   devices merge by taking the larger number per site, so nothing is
//   double-counted and nothing is lost.

export type Coll = "notes" | "todos" | "habits" | "meetings" | "pomodoroSessions" | "tracking" | "stats" | "days" | "lists" | "tabSessions";
export type Kind = "lww" | "max";

export interface LocalItem {
  /** updatedAt (ISO). For "max" collections this is ignored. */
  u: string;
  v: unknown;
}

export interface Change {
  c: Coll;
  id: string;
  u: string;
  d?: boolean;
  v?: unknown;
}

export interface Incoming {
  c: Coll;
  id: string;
  u: string;
  d: boolean;
  v: unknown;
  s?: number;
}

/** Keep under the server's 1.5 MB per-item cap (JSON length). */
export const MAX_ITEM_CHARS = 1_400_000;
const EPOCH = "1970-01-01T00:00:00.000Z";

/** JSON with sorted object keys, so equal values always fingerprint the same. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** FNV-1a (two seeds → 64 bits) — a fingerprint, not security. */
export function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193);
    b = Math.imul(b ^ ch, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** Any stamp the app has stored (ISO string, number, missing) → ISO string the server accepts. */
export function normStamp(x: unknown): string {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(x)) return x;
  const t = typeof x === "number" ? x : typeof x === "string" ? Date.parse(x) : NaN;
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : EPOCH;
}

export const shadowKey = (c: Coll, id: string) => `${c}/${id}`;

/** Fingerprint of a version: for "lww" the stamp + value; for "max" the value only. */
export function versionHash(kind: Kind, u: string, deleted: boolean, v: unknown): string {
  if (deleted) return `x${u}`;
  return kind === "max" ? fingerprint(stable(v)) : `${u}~${fingerprint(stable(v))}`;
}

/** Larger number wins, per key for objects (Time Tracker: site → seconds). */
export function maxMerge(a: unknown, b: unknown): unknown {
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = k in out ? maxMerge(out[k], v) : v;
    return out;
  }
  return a === undefined || a === null ? b : a;
}

export interface CollectionState {
  c: Coll;
  kind: Kind;
  /** Deleting here deletes everywhere (false for append-only/history data). */
  deletable: boolean;
  local: Map<string, LocalItem>;
  /**
   * Only a recorded deletion (tombstone) counts as "deleted here"; an item that is
   * merely missing locally is fetched again instead. For collections where every
   * user deletion records a tombstone (meetings), so a failed read, a half-applied
   * pull or cleared storage can never delete anything on other devices.
   */
  requireTombstone?: boolean;
  /** Present here but not sent right now (e.g. a meeting being recorded or summarized): never a deletion. */
  held?: Set<string>;
}

/**
 * What changed on this device since the last sync.
 * `deletedAt`: when items were deleted here (tombstones), so the deletion
 * carries its real time; otherwise `now`.
 */
export function localChanges(
  cols: CollectionState[],
  shadow: Record<string, string>,
  deletedAt: Partial<Record<Coll, Record<string, string>>>,
  now: string,
): { changes: Change[]; tooLarge: string[]; missing: string[] } {
  const changes: Change[] = [];
  const tooLarge: string[] = [];
  /** Synced before but gone here without a recorded deletion: to fetch again. */
  const missing: string[] = [];
  for (const col of cols) {
    for (const [id, item] of col.local) {
      const key = shadowKey(col.c, id);
      if (shadow[key] === versionHash(col.kind, item.u, false, item.v)) continue;
      if (stable(item.v).length > MAX_ITEM_CHARS) {
        tooLarge.push(key);
        continue;
      }
      changes.push({ c: col.c, id, u: col.kind === "max" ? now : item.u, v: item.v });
    }
    if (!col.deletable) continue;
    const prefix = `${col.c}/`;
    const gone = new Set<string>();
    for (const key of Object.keys(shadow)) {
      if (!key.startsWith(prefix) || shadow[key].startsWith("x")) continue;
      const id = key.slice(prefix.length);
      if (col.local.has(id) || col.held?.has(id)) continue;
      if (col.requireTombstone && !deletedAt[col.c]?.[id]) missing.push(key);
      else gone.add(id);
    }
    // Deleted here before this device ever synced: tell the server too.
    for (const id of Object.keys(deletedAt[col.c] ?? {})) if (!col.local.has(id) && shadow[shadowKey(col.c, id)] === undefined) gone.add(id);
    for (const id of gone) changes.push({ c: col.c, id, u: normStamp(deletedAt[col.c]?.[id] ?? now), d: true });
  }
  return { changes, tooLarge, missing };
}

/** The fingerprint to remember after the server accepted `ch`. */
export function pushedHash(kind: Kind, ch: Change): string {
  return versionHash(kind, ch.u, !!ch.d, ch.v);
}

export type Decision =
  | { action: "none" }
  | { action: "delete" }
  | { action: "put"; value: unknown };

/**
 * What to do with a version that came from the server.
 * `again`: this device still has something newer to send.
 */
export function decide(kind: Kind, inc: Incoming, local: LocalItem | undefined): { decision: Decision; shadow: string; again: boolean } {
  const shadow = versionHash(kind, inc.u, inc.d, inc.v);
  if (kind === "max") {
    if (inc.d) return { decision: { action: "none" }, shadow, again: false };
    const merged = maxMerge(local?.v, inc.v);
    const changedHere = !local || stable(merged) !== stable(local.v);
    return { decision: changedHere ? { action: "put", value: merged } : { action: "none" }, shadow, again: stable(merged) !== stable(inc.v) };
  }
  if (!local) return { decision: inc.d ? { action: "none" } : { action: "put", value: inc.v }, shadow, again: false };
  // Edited here after the server's version: keep ours, and send it.
  if (local.u > inc.u) return { decision: { action: "none" }, shadow, again: true };
  if (inc.d) return { decision: { action: "delete" }, shadow, again: false };
  // Same stamp: the server has already settled the tie; take its version.
  if (stable(local.v) === stable(inc.v)) return { decision: { action: "none" }, shadow, again: false };
  return { decision: { action: "put", value: inc.v }, shadow, again: false };
}

/** Splits changes into requests of at most ~3 MB / 1000 items. */
export function batches(changes: Change[], maxChars = 3_000_000, maxItems = 1000): Change[][] {
  const out: Change[][] = [];
  let cur: Change[] = [];
  let size = 0;
  for (const ch of changes) {
    const n = ch.v === undefined ? 100 : stable(ch.v).length + 100;
    if (cur.length && (size + n > maxChars || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(ch);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
