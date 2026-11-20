// iOS and Android: a SQLite key-value table (expo-sqlite/kv-store). Reads are
// synchronous (the app reads each key once at most; store.ts caches it), and
// writes are coalesced and done in the background so typing never waits on
// the disk.
import Storage from "expo-sqlite/kv-store";
import type { KV } from "./kv";

const pending = new Map<string, string | null>();
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const batch = [...pending];
    pending.clear();
    writing = writing.then(async () => {
      for (const [k, v] of batch) {
        try {
          if (v === null) await Storage.removeItemAsync(k);
          else await Storage.setItemAsync(k, v);
        } catch (err) {
          console.warn("ProdLi: couldn't save", k, err);
        }
      }
    });
  }, 120);
}

export const kv: KV = {
  get(k) {
    if (pending.has(k)) return pending.get(k) ?? null;
    return Storage.getItemSync(k);
  },
  set(k, v) {
    pending.set(k, v);
    schedule();
  },
  remove(k) {
    pending.set(k, null);
    schedule();
  },
  keys() {
    const all = new Set(Storage.getAllKeysSync());
    for (const [k, v] of pending) v === null ? all.delete(k) : all.add(k);
    return [...all];
  },
  async flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const batch = [...pending];
      pending.clear();
      writing = writing.then(async () => {
        for (const [k, v] of batch) v === null ? await Storage.removeItemAsync(k) : await Storage.setItemAsync(k, v);
      });
    }
    await writing;
  },
};
