// Web preview (expo start --web): the browser's localStorage.
import type { KV } from "./kv";

const ls = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
const PREFIX = "prodli:";

export const kv: KV = {
  get: (k) => ls()?.getItem(PREFIX + k) ?? null,
  set: (k, v) => {
    try {
      ls()?.setItem(PREFIX + k, v);
    } catch (err) {
      console.warn("ProdLi: couldn't save", k, err);
    }
  },
  remove: (k) => ls()?.removeItem(PREFIX + k),
  keys: () => {
    const s = ls();
    if (!s) return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },
  flush: async () => {},
};
