// Deletion markers, the same as the extension's (key "syncTombstones"): sync
// needs to know an item was deleted on purpose, and when, or another device
// would bring it back.
import { read, write } from "./store";

export const TOMBSTONES_KEY = "syncTombstones";
export type TombCollection = "notes" | "todos" | "habits" | "meetings" | "days" | "lists" | "tabSessions" | "quickLinks" | "readLater";
export type Tombstones = Partial<Record<TombCollection, Record<string, string>>>;

const KEEP_DAYS = 90;

export const getTombstones = (): Tombstones => read<Tombstones>(TOMBSTONES_KEY, {});

export function pruneTombstones(t: Tombstones, now = Date.now()): Tombstones {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  const out: Tombstones = {};
  for (const [col, ids] of Object.entries(t) as [TombCollection, Record<string, string>][]) {
    const kept = Object.fromEntries(Object.entries(ids ?? {}).filter(([, at]) => at >= cutoff));
    if (Object.keys(kept).length) out[col] = kept;
  }
  return out;
}

export function recordDeletions(col: TombCollection, ids: string[], at = new Date().toISOString()): void {
  if (!ids.length) return;
  const t = getTombstones();
  const list = { ...(t[col] ?? {}) };
  for (const id of ids) list[id] = at;
  write(TOMBSTONES_KEY, pruneTombstones({ ...t, [col]: list }));
}
