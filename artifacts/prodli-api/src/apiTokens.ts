// Personal access tokens ("API keys" in Settings → Connections) for the
// read-only API (/api/v1/*) and the MCP server (/mcp). Only the SHA-256 hash is
// stored; the token itself is shown once, when it's created.
//
// A token can only read the user's own synced data. It never authenticates the
// rest of the API: authenticate() in accounts.ts accepts only "pls_" session
// tokens, and the token routes accept only "plt_" tokens.

import { base64url, hashToken } from "./accounts";

export const TOKEN_PREFIX = "plt_";
export const MAX_TOKENS = 10;
export const MAX_TOKEN_NAME = 60;
/** last_used_at is written at most this often (it's shown as "last used"). */
const TOUCH_EVERY = 60 * 60 * 1000;

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** The first characters of the token ("plt_AbCd"), to tell keys apart. */
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface Row {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

const toInfo = (r: Row): ApiTokenInfo => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export const newApiToken = () => `${TOKEN_PREFIX}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;

/** A clean name ("Claude Desktop"), or null when it's empty. */
export function cleanTokenName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TOKEN_NAME);
  return name || null;
}

export async function listApiTokens(db: D1Database, userId: string): Promise<ApiTokenInfo[]> {
  const { results } = await db.prepare(`SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ?1 ORDER BY created_at DESC`).bind(userId).all<Row>();
  return results.map(toInfo);
}

export type CreateResult = { ok: true; token: string; info: ApiTokenInfo } | { ok: false; error: "too_many_tokens" };

export async function createApiToken(db: D1Database, userId: string, name: string, now = Date.now()): Promise<CreateResult> {
  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1`).bind(userId).first<number>("n")) ?? 0;
  if (count >= MAX_TOKENS) return { ok: false, error: "too_many_tokens" };
  const token = newApiToken();
  const row: Row = { id: crypto.randomUUID(), name, prefix: token.slice(0, TOKEN_PREFIX.length + 4), created_at: now, last_used_at: null };
  await db
    .prepare(`INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(row.id, userId, row.name, await hashToken(token), row.prefix, now)
    .run();
  return { ok: true, token, info: toInfo(row) };
}

export async function deleteApiToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM api_tokens WHERE id = ?1 AND user_id = ?2`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteAllApiTokens(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM api_tokens WHERE user_id = ?1`).bind(userId).run();
}

export interface TokenAuth {
  tokenId: string;
  userId: string;
}

/** Looks up a "plt_" token. Anything else (including session tokens) is refused. */
export async function authenticateApiToken(db: D1Database, token: string, now = Date.now()): Promise<TokenAuth | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  const row = await db
    .prepare(`SELECT t.id, t.user_id, t.last_used_at FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1`)
    .bind(await hashToken(token))
    .first<{ id: string; user_id: string; last_used_at: number | null }>();
  if (!row) return null;
  if (row.last_used_at === null || now - row.last_used_at > TOUCH_EVERY) {
    await db.prepare(`UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2`).bind(now, row.id).run();
  }
  return { tokenId: row.id, userId: row.user_id };
}
