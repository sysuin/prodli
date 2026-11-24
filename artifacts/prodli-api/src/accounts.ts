// Users and sessions in D1.

import type { GoogleIdentity } from "./google";

export type Client = "extension" | "web" | "mobile" | "desktop";

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  /** Effective plan: "pro" or "plus" for subscribers, "pro" during the free trial. */
  plan: string;
  createdAt: number;
  /** When the free Pro trial ends (ms), while it's running; null otherwise (never had one, ended, or subscribed). */
  trialEndsAt: number | null;
}

/**
 * The user as sent to the apps. `plan` stays "free" | "pro" so app versions from
 * before Pro Plus keep working (Pro Plus includes everything Pro has); `tier` is
 * the exact plan: "free" | "pro" | "plus".
 */
export function clientUser(u: User): User & { tier: string } {
  return { ...u, plan: u.plan === "free" ? "free" : "pro", tier: u.plan };
}

export interface SessionInfo {
  id: string;
  client: Client;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Sessions slide: each use (at most every TOUCH_EVERY) pushes expiry out again. */
export const SESSION_TTL: Record<Client, number> = { extension: 180 * DAY, web: 30 * DAY, mobile: 180 * DAY, desktop: 180 * DAY };
const TOUCH_EVERY = 10 * 60 * 1000;

interface UserRow {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  plan: string;
  created_at: number;
  trial_ends_at: number | null;
}

/** Free Pro trial for new accounts (days). Off unless the environment sets TRIAL_DAYS. */
export function trialDays(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : 0;
}

const toUser = (r: UserRow, now: number): User => {
  const trial = r.plan === "free" && r.trial_ends_at != null && r.trial_ends_at > now;
  return { id: r.id, email: r.email, name: r.name, picture: r.picture, plan: trial ? "pro" : r.plan, createdAt: r.created_at, trialEndsAt: trial ? r.trial_ends_at : null };
};

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newSessionToken(): string {
  return `pls_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short, non-identifying label for the sessions list, e.g. "Chrome on macOS". */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Signs in (or creates) the Google user. New accounts get `trial` days of Pro (0 = no trial). */
export async function upsertUser(db: D1Database, g: GoogleIdentity, now = Date.now(), trial = 0): Promise<User> {
  const row = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at, updated_at, last_seen_at, trial_ends_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, ?7)
       ON CONFLICT (google_sub) DO UPDATE SET email = ?3, name = ?4, picture = ?5, updated_at = ?6, last_seen_at = ?6
       RETURNING id, email, name, picture, plan, created_at, trial_ends_at`,
    )
    .bind(crypto.randomUUID(), g.sub, g.email, g.name, g.picture, now, trial > 0 ? now + trial * 86_400_000 : null)
    .first<UserRow>();
  if (!row) throw new Error("upsert_failed");
  return toUser(row, now);
}

export async function createSession(db: D1Database, userId: string, client: Client, device: string, now = Date.now()): Promise<{ token: string; session: SessionInfo }> {
  const token = newSessionToken();
  const id = crypto.randomUUID();
  const expiresAt = now + SESSION_TTL[client];
  await db
    .prepare(`INSERT INTO sessions (id, user_id, token_hash, client, device, created_at, last_used_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)`)
    .bind(id, userId, await hashToken(token), client, device, now, expiresAt)
    .run();
  return { token, session: { id, client, device, createdAt: now, lastUsedAt: now, expiresAt } };
}

export interface Authenticated {
  user: User;
  sessionId: string;
  client: Client;
}

/** Looks up a session token. Expired sessions are removed. */
export async function authenticate(db: D1Database, token: string, now = Date.now()): Promise<Authenticated | null> {
  if (!token.startsWith("pls_") || token.length > 100) return null;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.client, s.last_used_at, s.expires_at,
              u.id, u.email, u.name, u.picture, u.plan, u.created_at, u.trial_ends_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1`,
    )
    .bind(await hashToken(token))
    .first<UserRow & { session_id: string; client: Client; last_used_at: number; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= now) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(row.session_id).run();
    return null;
  }
  if (now - row.last_used_at > TOUCH_EVERY) {
    await db.batch([
      db.prepare(`UPDATE sessions SET last_used_at = ?1, expires_at = ?2 WHERE id = ?3`).bind(now, now + SESSION_TTL[row.client], row.session_id),
      db.prepare(`UPDATE users SET last_seen_at = ?1 WHERE id = ?2`).bind(now, row.id),
    ]);
  }
  return { user: toUser(row, now), sessionId: row.session_id, client: row.client };
}

export async function listSessions(db: D1Database, userId: string, now = Date.now()): Promise<SessionInfo[]> {
  const { results } = await db
    .prepare(`SELECT id, client, device, created_at, last_used_at, expires_at FROM sessions WHERE user_id = ?1 AND expires_at > ?2 ORDER BY last_used_at DESC`)
    .bind(userId, now)
    .all<{ id: string; client: Client; device: string; created_at: number; last_used_at: number; expires_at: number }>();
  return results.map((r) => ({ id: r.id, client: r.client, device: r.device, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at }));
}

export async function deleteSession(db: D1Database, userId: string, sessionId: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM sessions WHERE id = ?1 AND user_id = ?2`).bind(sessionId, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(userId).run();
}

/** Permanently deletes the account, every session and every API token. */
export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM api_tokens WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM desktop_codes WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM ai_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM brief_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM ask_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM write_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM dictate_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM transcribe_usage WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM shares WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM subscriptions WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM billing_customers WHERE user_id = ?1`).bind(userId),
    db.prepare(`DELETE FROM users WHERE id = ?1`).bind(userId),
  ]);
}
