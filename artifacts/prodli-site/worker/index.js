// prodli.com on Cloudflare Workers (static assets from ../../site-dist, built by
// `pnpm run build:web`). This small script only:
//   - redirects www.prodli.com and http:// → https://prodli.com
//   - serves the right index.html for app routes (/privacy, /extension/…)
//   - adds security and caching headers
// Everything else is a plain static file.

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
  if (/^\/(extension\/)?assets\//.test(url.pathname) && res.ok) {
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return out;
}

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: typeof fetch } }} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.prodli.com" || (url.protocol === "http:" && url.hostname === "prodli.com")) {
      url.hostname = "prodli.com";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/extension") {
      url.pathname = "/extension/";
      return Response.redirect(url.toString(), 301);
    }

    let res = await env.ASSETS.fetch(request);
    if (res.status === 404 && (request.method === "GET" || request.method === "HEAD")) {
      // Client-side routes: the marketing site (/privacy, unknown pages show its
      // "not found" screen) and the web preview under /extension/.
      const index = url.pathname.startsWith("/extension/") ? "/extension/" : "/";
      const fallback = await env.ASSETS.fetch(new Request(new URL(index, url), request));
      res = new Response(fallback.body, { status: 200, headers: fallback.headers });
    }
    return withHeaders(res, url);
  },
};
