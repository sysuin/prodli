// Desktop sign-in, the app's half (the server's is prodli-api/src/desktopAuth.ts,
// the web page's is prodli/src/lib/desktopHandoff.ts):
//
//   1. Make a PKCE verifier + challenge and a random state; listen on
//      127.0.0.1:<random port>.
//   2. Open app.prodli.com/?desktop=signin&port&state&challenge in the browser.
//   3. The page sends the browser to http://127.0.0.1:<port>/callback?code&state.
//   4. Check the state, trade code + verifier for a session.
//
// Pure helpers here; the listener and network calls are in main/auth.ts.

import { createHash, randomBytes } from "node:crypto";

export const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

export function makePkce(): Pkce {
  const verifier = b64url(randomBytes(48)); // 64 characters
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

export function signInUrl(apiBase: string, port: number, p: Pkce): string {
  const q = new URLSearchParams({ desktop: "signin", port: String(port), state: p.state, challenge: p.challenge });
  return `${apiBase.replace(/\/+$/, "")}/?${q.toString()}`;
}

export type CallbackResult = { kind: "code"; code: string } | { kind: "ignore" } | { kind: "error"; message: string };

/**
 * What a request to the loopback listener means. Only GET /callback with the
 * right state counts; anything else (favicon, a stray tab) is ignored, and a
 * wrong state is an error (someone else's link), never a sign-in.
 */
export function readCallback(method: string | undefined, rawUrl: string | undefined, expectedState: string): CallbackResult {
  if (method !== "GET" || !rawUrl) return { kind: "ignore" };
  const url = new URL(rawUrl, "http://127.0.0.1");
  if (url.pathname !== "/callback") return { kind: "ignore" };
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || state !== expectedState) return { kind: "error", message: "This sign-in link wasn't started by this app. Try again from ProdLi." };
  if (!code || !/^pldc_[A-Za-z0-9_-]{20,90}$/.test(code)) return { kind: "error", message: "The sign-in didn't come back complete. Try again." };
  return { kind: "code", code };
}

/** The little page the browser shows after the hand-off. */
export function callbackPage(ok: boolean, message: string): string {
  const esc = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProdLi</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F0E6D2;color:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
main{background:#fff;border:3px solid #000;box-shadow:8px 8px 0 #000;padding:32px 28px;max-width:420px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{font-size:15px;line-height:1.5;margin:0}</style></head>
<body><main><h1>${ok ? "✅ You're signed in" : "Sign-in didn't finish"}</h1><p>${esc}</p></main></body></html>`;
}

export const platformName = (p: NodeJS.Platform): "mac" | "windows" | "linux" => (p === "darwin" ? "mac" : p === "win32" ? "windows" : "linux");
