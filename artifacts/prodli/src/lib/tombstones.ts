// Deletion markers ("tombstones") so cross-device sync knows an item was
// deleted on purpose — otherwise another computer would bring it back.

import { storageGet, storageSet } from "./storage";

export const TOMBSTONES_KEY = "syncTombstones";
export type Collection = "notes" | "todos" | "habits" | "meetings" | "days" | "lists";
/** collection → item id → ISO time it was deleted */
export type Tombstones = Partial<Record<Collection, Record<string, string>>>;

const KEEP_DAYS = 90;

export async function getTombstones(): Promise<Tombstones> {
  return storageGet<Tombstones>(TOMBSTONES_KEY, {});
}

export function pruneTombstones(t: Tombstones, now = Date.now()): Tombstones {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  const out: Tombstones = {};
  for (const [col, ids] of Object.entries(t) as [Collection, Record<string, string>][]) {
    const kept = Object.fromEntries(Object.entries(ids ?? {}).filter(([, at]) => at >= cutoff));
    if (Object.keys(kept).length) out[col] = kept;
  }
  return out;
}

/** Union of two tombstone sets, keeping the latest deletion time per item. */
export function mergeTombstones(a: Tombstones, b: Tombstones): Tombstones {
  const out: Tombstones = {};
  for (const col of ["notes", "todos", "habits", "meetings", "days", "lists"] as Collection[]) {
    const merged: Record<string, string> = { ...(a[col] ?? {}) };
    for (const [id, at] of Object.entries(b[col] ?? {})) if (!merged[id] || merged[id] < at) merged[id] = at;
    if (Object.keys(merged).length) out[col] = merged;
  }
  return pruneTombstones(out);
}

export async function recordDeletions(col: Collection, ids: string[], at = new Date().toISOString()): Promise<void> {
  if (!ids.length) return;
  const t = await getTombstones();
  const list = { ...(t[col] ?? {}) };
  for (const id of ids) list[id] = at;
  await storageSet(TOMBSTONES_KEY, pruneTombstones({ ...t, [col]: list }));
}
