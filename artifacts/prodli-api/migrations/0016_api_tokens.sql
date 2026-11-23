-- Personal access tokens for the read-only API (/api/v1/*) and the MCP server
-- (/mcp), so a user can connect Claude, ChatGPT or their own scripts to their
-- ProdLi data (src/apiTokens.ts). Only the SHA-256 hash of each token is kept.
-- prefix (e.g. "plt_AbCd") is shown in Settings so people can tell keys apart.
-- Tokens never work on the rest of the API (sync, account, billing, AI).
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens (user_id);
