// node --test worker/  (pnpm --filter @workspace/prodli-site test)
import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadKey, handleDownload, parseRange } from "./downloads.js";

const enc = new TextEncoder();
function fakeBucket(files) {
  const obj = (key, range) => {
    const data = enc.encode(files[key]);
    let slice = data;
    if (range) {
      const start = "suffix" in range ? data.length - range.suffix : range.offset;
      const end = "suffix" in range ? data.length : range.length !== undefined ? range.offset + range.length : data.length;
      slice = data.slice(start, end);
    }
    return { size: data.length, httpEtag: `"${key}"`, range, body: new Blob([slice]).stream(), json: async () => JSON.parse(files[key]) };
  };
  return {
    get: async (key, opts = {}) => (key in files ? obj(key, opts.range) : null),
    head: async (key) => (key in files ? { size: enc.encode(files[key]).length, httpEtag: `"${key}"` } : null),
  };
}
const req = (path, init = {}) => new Request(`https://prodli.com${path}`, init);
const latest = JSON.stringify({ version: "1.0.0", mac: "ProdLi-1.0.0-mac.dmg", windowsX64: "ProdLi-Setup-1.0.0-x64.exe", windowsArm64: "ProdLi-Setup-1.0.0-arm64.exe" });
const env = { DOWNLOADS: fakeBucket({ "desktop/latest.json": latest, "desktop/ProdLi-1.0.0-mac.dmg": "DMGDATA0123456789", "desktop/latest-mac.yml": "version: 1.0.0\n" }) };

test("keys stay inside desktop/", () => {
  assert.equal(downloadKey("/download/desktop/latest.yml"), "desktop/latest.yml");
  for (const bad of ["/download/desktop/../secret", "/download/desktop/a/b.exe", "/download/desktop/.env", "/download/desktop/", "/download/other/x.exe", "/download/desktop/%2e%2e"]) assert.equal(downloadKey(bad), null, bad);
});

test("ranges", () => {
  assert.deepEqual(parseRange("bytes=0-9"), { offset: 0, length: 10 });
  assert.deepEqual(parseRange("bytes=5-"), { offset: 5 });
  assert.deepEqual(parseRange("bytes=-4"), { suffix: 4 });
  assert.equal(parseRange("bytes=-"), null);
  assert.equal(parseRange("items=1-2"), null);
  assert.equal(parseRange(null), null);
});

test("other paths are not handled", async () => {
  assert.equal(await handleDownload(req("/privacy"), env), null);
  assert.equal(await handleDownload(req("/download"), env), null); // the page itself
});

test("shortcuts redirect to the latest installer, or to the page before the first release", async () => {
  const mac = await handleDownload(req("/download/mac"), env);
  assert.equal(mac.status, 302);
  assert.equal(mac.headers.get("Location"), "https://prodli.com/download/desktop/ProdLi-1.0.0-mac.dmg");
  const win = await handleDownload(req("/download/windows-arm64"), env);
  assert.equal(win.headers.get("Location"), "https://prodli.com/download/desktop/ProdLi-Setup-1.0.0-arm64.exe");
  const none = await handleDownload(req("/download/windows"), { DOWNLOADS: fakeBucket({}) });
  assert.equal(none.headers.get("Location"), "https://prodli.com/download");
  const unbound = await handleDownload(req("/download/mac"), {});
  assert.equal(unbound.headers.get("Location"), "https://prodli.com/download");
});

test("files: whole, ranges, HEAD, types and caching", async () => {
  const whole = await handleDownload(req("/download/desktop/ProdLi-1.0.0-mac.dmg"), env);
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), "DMGDATA0123456789");
  assert.equal(whole.headers.get("Content-Type"), "application/x-apple-diskimage");
  assert.match(whole.headers.get("Content-Disposition"), /attachment; filename="ProdLi-1.0.0-mac.dmg"/);
  const part = await handleDownload(req("/download/desktop/ProdLi-1.0.0-mac.dmg", { headers: { Range: "bytes=3-6" } }), env);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Range"), "bytes 3-6/17");
  assert.equal(await part.text(), "DATA");
  const head = await handleDownload(req("/download/desktop/latest-mac.yml", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "15");
  assert.equal(head.headers.get("Cache-Control"), "public, max-age=60");
  assert.equal((await handleDownload(req("/download/desktop/missing.exe"), env)).status, 404);
  assert.equal((await handleDownload(req("/download/desktop/x.exe", { method: "POST" }), env)).status, 405);
});
