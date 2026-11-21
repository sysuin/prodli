// app://prodli/ — the app's pages, served from dist/renderer with strict headers.
// A real origin (not file://) so the page gets IndexedDB, Web Locks, a stable
// origin the server's CORS allows, and its own Content Security Policy.

import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { APP_SCHEME, resolveAsset, securityHeaders } from "../core/assets";
import { API_BASE, rendererDir } from "./config";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
}

export function serveApp(): void {
  const root = rendererDir();
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const file = resolveAsset(root, request.url);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: securityHeaders(API_BASE, file) });
    } catch {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }
  });
}
