// The app's data on this device: JSON values under the same keys the extension
// uses ("notes", "todos", "habits", …), so the sync engine and the shared logic
// see exactly the shapes they expect. Values are cached in memory; screens
// subscribe with useStored() and re-render when a value changes.
import { useCallback, useSyncExternalStore } from "react";
import { kv } from "./kv";

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<(key: string) => void>();

export function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const raw = kv.get(key);
  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, value);
  return value;
}

function notify(key: string) {
  for (const cb of listeners.get(key) ?? []) cb();
  for (const cb of anyListeners) cb(key);
}

export function write<T>(key: string, value: T): void {
  cache.set(key, value);
  kv.set(key, JSON.stringify(value));
  notify(key);
}

/** Read–modify–write in one step. */
export function update<T>(key: string, fallback: T, fn: (current: T) => T): T {
  const next = fn(read(key, fallback));
  write(key, next);
  return next;
}

export function remove(key: string): void {
  cache.delete(key);
  kv.remove(key);
  notify(key);
}

export function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  return () => set!.delete(cb);
}

export function onAnyChange(cb: (key: string) => void): () => void {
  anyListeners.add(cb);
  return () => anyListeners.delete(cb);
}

export function flush(): Promise<void> {
  return kv.flush();
}

/** Tests: forget the in-memory cache (the KV keeps its values). */
export function resetCache(): void {
  cache.clear();
}

/** The current value of `key`, re-rendering when it changes. */
export function useStored<T>(key: string, fallback: T): T {
  const sub = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  return useSyncExternalStore(sub, () => read(key, fallback), () => read(key, fallback));
}
