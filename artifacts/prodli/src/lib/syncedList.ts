// Lists (notes, to-dos, habits) that stay correct when ProdLi is open in
// several tabs at once.
//
// ProdLi replaces the new tab page, so people often have many ProdLi tabs open.
// Previously each tab kept its own copy of a list and saved the whole list,
// so an older tab could silently overwrite edits made in a newer one.
//
// Now every save is a merge: the tab re-reads what's stored, applies only the
// items it changed (or deleted) itself, and writes the result. Changes from
// other tabs arrive through storage events and are merged in the same way.

import { useCallback, useEffect, useRef, useState } from "react";
import { onStorageChange, storageGet, storageSet } from "./storage";

export interface SyncItem {
  id: string;
  updatedAt?: string;
  createdAt?: string;
}

const stamp = (x: SyncItem) => x.updatedAt ?? x.createdAt ?? "";

/**
 * Merges `incoming` (what's stored / what another tab wrote) into `local`.
 * - Items this tab changed (`dirty`) keep the local version unless the
 *   incoming one is newer.
 * - Items this tab deleted (`deleted`) stay deleted.
 * - Untouched items take the incoming version; if they're gone from
 *   `incoming`, another tab deleted them.
 * - Items only in `incoming` (created elsewhere) are placed right after the
 *   item that precedes them there (or first), so both tabs show the same order
 *   whether a list adds new items at the top (notes, to-dos) or bottom (habits).
 * Otherwise order follows `local`, so drag-and-drop ordering is preserved.
 */
export function mergeLists<T extends SyncItem>(local: T[], incoming: T[], dirty: ReadonlySet<string>, deleted: ReadonlySet<string>): T[] {
  const incomingById = new Map(incoming.map((i) => [i.id, i]));
  const localIds = new Set(local.map((l) => l.id));
  const kept: T[] = [];
  for (const l of local) {
    if (deleted.has(l.id)) continue;
    const inc = incomingById.get(l.id);
    if (inc) {
      kept.push(dirty.has(l.id) && stamp(inc) <= stamp(l) ? l : inc);
    } else if (dirty.has(l.id)) {
      kept.push(l); // created or edited here, not saved yet
    }
  }
  const result = kept;
  incoming.forEach((item, idx) => {
    if (localIds.has(item.id) || deleted.has(item.id)) return;
    let at = 0;
    for (let j = idx - 1; j >= 0; j--) {
      const pos = result.findIndex((r) => r.id === incoming[j].id);
      if (pos !== -1) {
        at = pos + 1;
        break;
      }
    }
    result.splice(at, 0, item);
  });
  return result;
}

export interface SyncedList<T> {
  items: T[];
  loaded: boolean;
  /** Replace the list. Changed items (by reference) get a fresh `updatedAt`. */
  setItems: (next: T[] | ((prev: T[]) => T[])) => void;
  /** Save pending changes now (also happens automatically). */
  flush: () => Promise<void>;
  /** Last save error, if any (e.g. storage full). */
  saveError: string | null;
}

export function useSyncedList<T extends SyncItem>(
  key: string,
  options: { defaultValue?: T[]; debounceMs?: number; stampUpdatedAt?: boolean; onExternalChange?: (items: T[]) => void } = {},
): SyncedList<T> {
  const { debounceMs = 0, stampUpdatedAt = true } = options;
  const [items, setState] = useState<T[]>(options.defaultValue ?? []);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const itemsRef = useRef<T[]>(items);
  const dirty = useRef(new Set<string>());
  const deleted = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const onExternal = useRef(options.onExternalChange);
  onExternal.current = options.onExternalChange;

  const apply = useCallback((next: T[]) => {
    itemsRef.current = next;
    setState(next);
  }, []);

  const persist = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    const run = async () => {
      if (dirty.current.size === 0 && deleted.current.size === 0) return;
      const dirtySnap = new Set(dirty.current);
      const deletedSnap = new Set(deleted.current);
      const localSnap = itemsRef.current;
      const stored = await storageGet<T[]>(key, []);
      const merged = mergeLists(localSnap, stored, dirtySnap, deletedSnap);
      try {
        await storageSet(key, merged);
        setSaveError(null);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't save");
        return; // keep changes marked dirty so the next save retries
      }
      // Clear only what this write covered; edits made meanwhile stay dirty.
      const snapById = new Map(localSnap.map((i) => [i.id, i]));
      const nowById = new Map(itemsRef.current.map((i) => [i.id, i]));
      for (const id of dirtySnap) if (nowById.get(id) === snapById.get(id)) dirty.current.delete(id);
      for (const id of deletedSnap) deleted.current.delete(id);
      // Pick up anything other tabs added while we were saving.
      if (itemsRef.current === localSnap) apply(merged);
      else apply(mergeLists(itemsRef.current, merged, dirty.current, deleted.current));
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [key, apply]);

  const setItems = useCallback(
    (nextOrFn: T[] | ((prev: T[]) => T[])) => {
      const prev = itemsRef.current;
      let next = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
      const prevById = new Map(prev.map((i) => [i.id, i]));
      const now = new Date().toISOString();
      next = next.map((item) => {
        const before = prevById.get(item.id);
        if (before === item) return item;
        dirty.current.add(item.id);
        deleted.current.delete(item.id);
        return stampUpdatedAt && (!before || before.updatedAt === item.updatedAt) ? { ...item, updatedAt: now } : item;
      });
      const nextIds = new Set(next.map((i) => i.id));
      for (const p of prev) {
        if (!nextIds.has(p.id)) {
          deleted.current.add(p.id);
          dirty.current.delete(p.id);
        }
      }
      apply(next);
      clearTimeout(timer.current);
      if (debounceMs > 0) timer.current = setTimeout(() => void persist(), debounceMs);
      else void persist();
    },
    [apply, persist, debounceMs, stampUpdatedAt],
  );

  useEffect(() => {
    let cancelled = false;
    void storageGet<T[]>(key, options.defaultValue ?? []).then((stored) => {
      if (cancelled) return;
      apply(mergeLists(itemsRef.current, stored, dirty.current, deleted.current));
      setLoaded(true);
    });
    const unsubscribe = onStorageChange<T[]>(key, (value) => {
      const merged = mergeLists(itemsRef.current, value ?? [], dirty.current, deleted.current);
      apply(merged);
      onExternal.current?.(merged);
    });
    // Don't lose a pending debounced save when the tab is hidden or closed.
    const flushNow = () => {
      if (dirty.current.size || deleted.current.size) void persist();
    };
    const onVisibility = () => document.visibilityState === "hidden" && flushNow();
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
      flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { items, loaded, setItems, flush: persist, saveError };
}
