// Key-value storage on this device. The default (this file) keeps values in
// memory and is what unit tests use; the app uses kv.native.ts (SQLite, on
// iOS and Android) or kv.web.ts (localStorage, the web preview). Metro picks
// the platform file automatically.
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  /** Waits until every write has reached the disk. */
  flush(): Promise<void>;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
    flush: async () => {},
  };
}

export const kv: KV = memoryKV();
