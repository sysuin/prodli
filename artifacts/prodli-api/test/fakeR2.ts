// In-memory stand-in for an R2 bucket: what src/backup.ts and src/videos.ts use
// (put/get/list/delete, head, ranged get and multipart uploads).
export function fakeR2() {
  const objects = new Map<string, { body: string; bytes?: Uint8Array; contentType?: string; customMetadata?: Record<string, string> }>();
  const uploads = new Map<string, { key: string; contentType?: string; parts: Map<number, Uint8Array> }>();
  let uploadSeq = 0;
  const bucket = {
    objects,
    async put(key: string, body: string, opts?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { body, customMetadata: opts?.customMetadata });
      return { key };
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const o = objects.get(key);
      if (!o) return null;
      const all = o.bytes ?? new TextEncoder().encode(o.body);
      const bytes = opts?.range ? all.slice(opts.range.offset, opts.range.offset + opts.range.length) : all;
      return { text: async () => o.body, body: new Response(bytes).body, size: all.length };
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: (o.bytes ?? new TextEncoder().encode(o.body)).length, httpMetadata: { contentType: o.contentType } } : null;
    },
    uploads,
    async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) {
      const uploadId = `up${++uploadSeq}`;
      uploads.set(uploadId, { key, contentType: opts?.httpMetadata?.contentType, parts: new Map() });
      return { key, uploadId };
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      const up = uploads.get(uploadId);
      return {
        async uploadPart(n: number, body: ArrayBuffer) {
          if (!up || up.key !== key) throw new Error("no such upload");
          up.parts.set(n, new Uint8Array(body));
          return { partNumber: n, etag: `etag${n}-${body.byteLength}` };
        },
        async complete(parts: { partNumber: number; etag: string }[]) {
          if (!up || up.key !== key) throw new Error("no such upload");
          const chunks = parts.map((p) => up.parts.get(p.partNumber)!);
          const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let o = 0;
          for (const c of chunks) (bytes.set(c, o), (o += c.length));
          objects.set(key, { body: "", bytes, contentType: up.contentType });
          uploads.delete(uploadId);
          return { key };
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
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
