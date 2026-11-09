// In-memory stand-in for an R2 bucket (just what src/backup.ts uses).
export function fakeR2() {
  const objects = new Map<string, { body: string; customMetadata?: Record<string, string> }>();
  const bucket = {
    objects,
    async put(key: string, body: string, opts?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { body, customMetadata: opts?.customMetadata });
      return { key };
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { text: async () => o.body } : null;
    },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string } = {}) {
      // Like R2, the cursor continues after the last key listed (deleting listed keys is safe).
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
      const page = keys.slice(0, 2); // tiny pages to exercise paging
      const truncated = keys.length > 2;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page[page.length - 1] : undefined };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  return bucket as unknown as R2Bucket & { objects: typeof objects };
}
