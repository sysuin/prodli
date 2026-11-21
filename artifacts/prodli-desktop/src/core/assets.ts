// Serving the app's own pages from app://prodli/ (built into dist/renderer).
// Pure helpers: which file a URL maps to (never outside the folder), its type,
// and the security headers every page gets.

import path from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "prodli";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const ENTRY_HTML = "index.desktop.html";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The file for a request to app://prodli/<path>, or null for a 404.
 * - "/" and paths without a file extension (in-app routes) get the entry page.
 * - Anything that escapes `root` (../, encoded or not, absolute paths, NUL) is refused.
 */
export function resolveAsset(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0") || rel.includes("\\")) return null;
  if (rel === "/" || rel === "" || !path.posix.extname(rel)) rel = `/${ENTRY_HTML}`;
  const base = path.resolve(root);
  const full = path.resolve(base, `.${path.posix.normalize(rel)}`);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * Content Security Policy for the app's pages: only its own code runs; it may
 * talk to ProdLi's server (and the developer's local one in dev builds).
 * Images may come from anywhere over https (pictures pasted into notes, avatars).
 */
export function contentSecurityPolicy(apiBase: string): string {
  const api = new URL(apiBase);
  const ws = `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.host}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self' ${api.origin} ${ws}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

export function securityHeaders(apiBase: string, file: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": contentType(file),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": file.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
  };
  if (file.endsWith(".html")) {
    h["Content-Security-Policy"] = contentSecurityPolicy(apiBase);
    h["Referrer-Policy"] = "no-referrer";
  }
  return h;
}
