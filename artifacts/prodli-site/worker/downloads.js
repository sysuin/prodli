// Desktop app downloads and updates, served by prodli.com's Worker from the R2
// bucket "prodli-downloads" (uploaded by .github/workflows/desktop.yml on a
// desktop-v* tag; the bucket itself stays private).
//
//   /download/mac              → the latest Mac installer (.dmg)
//   /download/windows          → the latest Windows installer (x64)
//   /download/windows-arm64    → the latest Windows installer (Arm)
//   /download/desktop/<file>   → a file: installers, and the update feed the app
//                                checks (latest.yml, latest-mac.yml, blockmaps)
//   /download/desktop/latest.json  → what the download page shows
//
// Range requests are supported (the updater downloads only the changed blocks).

const FILE = /^\/download\/desktop\/([A-Za-z0-9._-]{1,120})$/;
const SHORTCUTS = { "/download/mac": "mac", "/download/windows": "windowsX64", "/download/windows-arm64": "windowsArm64" };

/** The R2 key for a request path, or null. Never a path outside desktop/. */
export function downloadKey(pathname) {
  const m = FILE.exec(pathname);
  if (!m || m[1].startsWith(".")) return null;
  return `desktop/${m[1]}`;
}

/** Parses "bytes=a-b" / "bytes=a-" / "bytes=-n" into R2's range option, or null. */
export function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === "" ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}

const contentType = (key) =>
  key.endsWith(".dmg") ? "application/x-apple-diskimage" : key.endsWith(".exe") ? "application/vnd.microsoft.portable-executable" : key.endsWith(".zip") ? "application/zip" : key.endsWith(".json") ? "application/json; charset=utf-8" : key.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream";

/** Feed and manifest files change with each release; installers never do (versioned names). */
const cacheControl = (key) => (/\.(yml|json)$/.test(key) ? "public, max-age=60" : "public, max-age=86400");

/**
 * Handles /download/… paths. Returns null for other paths.
 * @param {Request} request
 * @param {{ DOWNLOADS?: R2Bucket }} env
 */
export async function handleDownload(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/download/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const bucket = env.DOWNLOADS;

  const shortcut = SHORTCUTS[url.pathname];
  if (shortcut) {
    const manifest = bucket ? await bucket.get("desktop/latest.json") : null;
    const latest = manifest ? await manifest.json().catch(() => null) : null;
    const file = latest && typeof latest[shortcut] === "string" ? latest[shortcut] : null;
    // Nothing published yet: the download page explains.
    return Response.redirect(new URL(file ? `/download/desktop/${encodeURIComponent(file)}` : "/download", url).toString(), 302);
  }

  const key = downloadKey(url.pathname);
  if (!key || !bucket) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const range = parseRange(request.headers.get("Range"));
  const obj = request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key, range ? { range } : {});
  if (!obj) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const headers = new Headers({
    "Content-Type": contentType(key),
    "Cache-Control": cacheControl(key),
    ETag: obj.httpEtag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  if (/\.(dmg|exe|zip)$/.test(key)) headers.set("Content-Disposition", `attachment; filename="${key.slice(8)}"`);
  if (request.method === "HEAD" || !("body" in obj) || !obj.body) {
    headers.set("Content-Length", String(obj.size));
    return new Response(null, { status: 200, headers });
  }
  if (range && obj.range) {
    const r = obj.range;
    const start = "suffix" in r ? obj.size - r.suffix : r.offset;
    const end = "suffix" in r ? obj.size - 1 : r.length !== undefined ? r.offset + r.length - 1 : obj.size - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
