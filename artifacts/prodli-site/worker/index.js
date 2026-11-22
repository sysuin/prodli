// prodli.com on Cloudflare Workers (static assets from ../../site-dist, built by
// `pnpm run build:web`). This small script only:
//   - redirects www.prodli.com and http:// → https://prodli.com
//   - sends the old web preview (/extension…) to the app at app.prodli.com
//   - serves the pre-rendered page for each route (/privacy → privacy.html) and
//     404.html with status 404 for anything else
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
      // Every page is a pre-rendered .html file (artifacts/prodli-site/scripts/prerender.mjs),
      // so anything else is a real "not found", sent with status 404 for search engines.
      const notFound = await env.ASSETS.fetch(new Request(new URL("/404", url), request));
      res = new Response(notFound.body, { status: 404, headers: notFound.headers });
    }
    return withHeaders(res, url);
  },
};
