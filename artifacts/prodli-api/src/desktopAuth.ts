// Desktop app sign-in (Mac / Windows), the loopback flow of RFC 8252 with PKCE:
//
//   1. The app makes a random verifier, keeps it, and opens the system browser at
//      app.prodli.com/?desktop=signin&port=…&state=…&challenge=SHA256(verifier).
//   2. The user signs in there as usual (Google, HttpOnly cookie) and clicks
//      "Open ProdLi". The web app asks POST /api/auth/desktop/code for a one-time
//      code tied to the challenge and sends the browser to
//      http://127.0.0.1:<port>/callback?code=…&state=… (the app's own listener).
//   3. The app trades code + verifier at POST /api/auth/desktop/token for a bearer
//      session of type "desktop".
//
// A code is single-use, lives five minutes, and is stored only as a hash. It's
// useless without the verifier, which never leaves the app.
//
// The extension uses the same steps where Chrome's own Google sign-in isn't
// available (Edge, Brave, Opera…): it opens app.prodli.com/?extension=signin in a
// tab, and the page hands it the code with chrome.runtime.sendMessage
// (externally_connectable). Its codes start with plec_ (desktop: pldc_), are
// issued only for ProdLi's own extension IDs, and are redeemed only from an
// extension page; they make an ordinary extension session.

import { hashToken } from "./accounts";

export const DESKTOP_CODE_TTL = 5 * 60 * 1000;

/** base64url(SHA-256(verifier)) is always 43 characters. */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636: 43–128 characters from the unreserved set. */
export const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export type DesktopPlatform = "mac" | "windows" | "linux";

/** "ProdLi app on Mac" etc. for the devices list (the app says which; nothing else is recorded). */
export const desktopDeviceLabel = (platform: unknown) =>
  `ProdLi app on ${platform === "mac" ? "Mac" : platform === "windows" ? "Windows" : platform === "linux" ? "Linux" : "a computer"}`;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** Makes a one-time code for this user and challenge. Old, expired codes are swept on the way. */
export async function createDesktopCode(db: D1Database, userId: string, challenge: string, now = Date.now(), client: "desktop" | "extension" = "desktop"): Promise<string> {
  const code = `${client === "extension" ? "plec_" : "pldc_"}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await db.batch([
    db.prepare(`DELETE FROM desktop_codes WHERE expires_at <= ?1`).bind(now),
    db.prepare(`INSERT INTO desktop_codes (code_hash, user_id, challenge, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(await hashToken(code), userId, challenge, now, now + DESKTOP_CODE_TTL),
  ]);
  return code;
}

export type RedeemResult = { ok: true; userId: string; client: "desktop" | "extension" } | { ok: false; error: "invalid_code" | "code_expired" | "verifier_mismatch" };

/**
 * Uses up a code: it's deleted whatever happens next, so a code can never be
 * tried twice (even with the right verifier after a wrong one).
 */
export async function redeemDesktopCode(db: D1Database, code: string, verifier: string, now = Date.now()): Promise<RedeemResult> {
  if (!/^pl[de]c_/.test(code) || code.length > 100) return { ok: false, error: "invalid_code" };
  const row = await db
    .prepare(`DELETE FROM desktop_codes WHERE code_hash = ?1 RETURNING user_id, challenge, expires_at`)
    .bind(await hashToken(code))
    .first<{ user_id: string; challenge: string; expires_at: number }>();
  if (!row) return { ok: false, error: "invalid_code" };
  if (row.expires_at <= now) return { ok: false, error: "code_expired" };
  if ((await challengeFor(verifier)) !== row.challenge) return { ok: false, error: "verifier_mismatch" };
  return { ok: true, userId: row.user_id, client: code.startsWith("plec_") ? "extension" : "desktop" };
}
