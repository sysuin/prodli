// prodli.com on Cloudflare Workers (static assets from ../../site-dist, built by
// `pnpm run build:web`). This small script only:
//   - redirects www.prodli.com and http:// → https://prodli.com
//   - sends the old web preview (/extension…) to the app at app.prodli.com
//   - serves index.html for the site's routes (/privacy, /terms)
//   - adds security and caching headers
//   - serves desktop app downloads and updates from R2 (worker/downloads.js)
// Everything else is a plain static file.

import { handleDownload } from "./downloads.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

/** @param {Response} res @param {URL} url */
function withHeaders(res, url) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (/^\/assets\//.test(url.pathname) && res.ok) {
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return out;
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: typeof fetch }, DOWNLOADS?: R2Bucket }} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.prodli.com" || (url.protocol === "http:" && url.hostname === "prodli.com")) {
      url.hostname = "prodli.com";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    // The old web preview lived here; the app is at app.prodli.com now.
    if (url.pathname === "/extension" || url.pathname.startsWith("/extension/")) {
      return Response.redirect("https://app.prodli.com/", 301);
    }

    const download = await handleDownload(request, env);
    if (download) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!download.headers.has(k) && download.status !== 302) download.headers.set(k, v);
      return download;
    }

    let res = await env.ASSETS.fetch(request);
    if (res.status === 404 && (request.method === "GET" || request.method === "HEAD")) {
      // Client-side routes of the marketing site (/privacy, /terms; unknown pages
      // show its "not found" screen).
      const fallback = await env.ASSETS.fetch(new Request(new URL("/", url), request));
      res = new Response(fallback.body, { status: 200, headers: fallback.headers });
    }
    return withHeaders(res, url);
  },
};
