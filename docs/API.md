# ProdLi personal API and MCP server

Let a signed-in user connect their own AI tools (Claude Desktop, Claude.ai,
ChatGPT, Cursor, Claude Code) or scripts to **read** their ProdLi data: to-dos,
notes, meeting notes (and transcripts on request), habits and today's plan.

**Read-only.** Nothing here can create, change or delete anything.

Code: `artifacts/prodli-api/src/apiTokens.ts` (keys), `src/readApi.ts` (what each
endpoint returns), `src/mcp.ts` (the MCP server), routes in `src/app.ts`, tests in
`test/api.test.ts`. The app's UI is Settings → Connections
(`artifacts/prodli/src/components/Connections.tsx`).

## API keys (personal access tokens)

Create one in **Settings → Connections** (signed in). A key looks like
`plt_` + 43 characters. It is shown **once**; ProdLi stores only its SHA-256
hash, plus a short prefix (`plt_AbCd`) so you can tell keys apart.

- Up to 10 keys per account. Give each app its own key so you can revoke it alone.
- A key works **only** on `/api/v1/*` and `/mcp`. It can't sign in, sync, read
  the account, manage keys, use AI features or billing.
- `/api/v1/*` and `/mcp` accept **only** keys: a sign-in session (bearer token
  or the web app's cookie) is refused with `401 token_required`.
- "Last used" is recorded at most once an hour.
- Revoke a key in Settings → Connections. **Sign out everywhere** and
  **deleting the account** revoke every key.

Key management (normal sign-in session, used by the app):

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/tokens` | | `{ tokens: [{ id, name, prefix, createdAt, lastUsedAt }], max }` |
| POST | `/api/tokens` | `{ name }` (1–60 chars) | `{ token, apiToken }`: the token, once. `409 too_many_tokens` at 10 |
| DELETE | `/api/tokens/:id` | | `{ ok: true }` or `404` |

## REST API (`/api/v1`)

Send the key as `Authorization: Bearer plt_…`. Responses are JSON. Errors:
`400 bad_request` (with a `message`), `401` (missing, invalid or revoked key),
`404 not_found`, `429 rate_limited` (300 requests a minute per key).

```sh
curl -H "Authorization: Bearer plt_…" https://app.prodli.com/api/v1/todos
```

| Path | Query | Returns |
| --- | --- | --- |
| `/api/v1/todos` | `status=open\|done\|all` (default open), `list=<name or id \| inbox>`, `label=`, `limit=` (1–500, default 100) | `{ todos, total, status, list }`. Open: soonest due first; done: newest first |
| `/api/v1/notes` | `q=` (all words must match title or text), `limit=` (1–100, default 20) | `{ notes: [{ id, title, excerpt, pinned, dailyFor, createdAt, updatedAt }], total, query }` |
| `/api/v1/notes/:id` | | `{ note: { id, title, text, … } }`. `text` is plain text with Markdown-style headings, lists, checklists, tables and links |
| `/api/v1/meetings` | `since=YYYY-MM-DD`, `limit=` (1–100, default 20) | `{ meetings: [{ id, title, startedAt, durationSec, platform, summary }], total }`. `summary` has overview, keyPoints, decisions, actionItems (with `done`), openQuestions, sections (custom templates) |
| `/api/v1/meetings/:id` | `transcript=1` | `{ meeting: { …, yourNotes, transcript? } }`. Transcript lines: `{ at: "mm:ss", speaker, text }` |
| `/api/v1/habits` | `date=YYYY-MM-DD`, `tz=<IANA zone>`, `archived=1` | `{ date, timezone, habits: [{ id, name, emoji, kind, target, unit, onDays, today: { scheduled, done, amount }, streak, last7 }] }` |
| `/api/v1/today` | `date=YYYY-MM-DD`, `tz=<IANA zone>` | `{ date, timezone, focus, timeBlocks, todos (each with why: planned\|due\|overdue), habits }` |

"Today" is the UTC date unless `date` or `tz` says otherwise (the server doesn't
know the user's time zone). Calendar events aren't included: they stay in the
browser (Google Calendar is read on the device). Deleted items, note templates
and archived habits (unless asked) are never returned.

## MCP server (`/mcp`)

[Model Context Protocol](https://modelcontextprotocol.io) over **Streamable
HTTP**, plain JSON responses (no SSE, no sessions). URL:
`https://app.prodli.com/mcp`.

Tools (all `annotations.readOnlyHint: true`, JSON Schema inputs):

| Tool | Arguments | What it returns |
| --- | --- | --- |
| `list_todos` | `status`, `list`, `label`, `limit` | Open to-dos (or done/all) with due dates, priority, list, labels |
| `search_notes` | `query`, `limit` | Matching notes with ids and excerpts |
| `get_note` | `id` | One note's full text |
| `list_meetings` | `since`, `limit` | Meetings with overview, decisions, action items |
| `get_meeting` | `id`, `transcript` | One meeting's full notes; the transcript when asked (capped at 150,000 characters) |
| `get_today` | `date`, `timezone` | Focus, time blocks, to-dos planned/due/overdue, habits due |
| `list_habits` | `date`, `timezone`, `include_archived` | Habits with today's state, streak and the last 7 days |

Each result is `content: [{ type: "text", text }]` (compact, readable text) plus
`structuredContent` (the same data as the REST API). A missing item or bad
arguments come back as a tool result with `isError: true`, so the model can
correct itself. Malformed requests get JSON-RPC errors: `-32700` parse error,
`-32600` invalid request, `-32601` unknown method, `-32602` unknown tool or
malformed `params`.

Protocol versions: the legacy `initialize` handshake (2024-11-05, 2025-03-26,
2025-06-18, 2025-11-25; the client's version is echoed if supported, otherwise
2025-06-18) and the stateless 2026-07-28 revision (`server/discover`, version in
`params._meta` mirrored in `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`
headers; mismatches get `400` with `-32020`, unknown versions `400` with
`-32022`). `GET /mcp` answers `405`. JSON-RPC batches are accepted.

### Authentication: header or URL

- **Header (preferred):** `Authorization: Bearer plt_…`.
- **URL:** `https://app.prodli.com/mcp/plt_…`, for clients that only take a URL
  (Claude.ai and ChatGPT custom connectors). Trade-off: the key is part of the
  address, so it can end up in the app's connector settings, browser history,
  proxies and server request logs (ProdLi's own error logs redact it, but
  Cloudflare's request logs record URLs). Use a key just for that connector
  and revoke it if the URL might have leaked.

There's no OAuth: `/.well-known/oauth-*` answer 404 so clients don't try it.
Browsers on other websites are refused (`403` for a foreign `Origin`); AI apps
call from their servers or desktop apps, which send no `Origin`.

### Setup

Create a key in Settings → Connections first; the page fills these in for you.

**Claude Desktop** (Settings → Developer → Edit Config → `claude_desktop_config.json`,
then restart Claude; needs Node.js). Claude Desktop runs local servers, so
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridges to ProdLi:

```json
{
  "mcpServers": {
    "prodli": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://app.prodli.com/mcp", "--header", "Authorization:${PRODLI_AUTH}"],
      "env": { "PRODLI_AUTH": "Bearer plt_…" }
    }
  }
}
```

(The header value is passed through `env` because some clients mangle spaces
in `args`; `npx mcp-remote <url> --header "Authorization: Bearer plt_…"` works
from a terminal.)

**Claude.ai** (Settings → Connectors → Add custom connector) and **ChatGPT**
(Settings → Connectors / developer mode → add an MCP server): paste the URL with
the key, `https://app.prodli.com/mcp/plt_…`, no authentication.

**Cursor** (`~/.cursor/mcp.json`) and other clients that take a URL and headers:

```json
{ "mcpServers": { "prodli": { "url": "https://app.prodli.com/mcp", "headers": { "Authorization": "Bearer plt_…" } } } }
```

**Claude Code:**

```sh
claude mcp add --transport http prodli https://app.prodli.com/mcp --header "Authorization: Bearer plt_…"
```

## Security and privacy notes

- Keys are 256-bit random values; only their SHA-256 hash is stored (D1 table
  `api_tokens`, migration `0016_api_tokens.sql`). Invalid keys are rate-limited
  per IP (`AUTH_LIMITER`), valid ones per key (`SYNC_LIMITER`, 300/min).
- A key reads only its owner's data: the user's Durable Object is chosen from
  the verified key, never from the request.
- What a connected app reads is sent to that app (for example Anthropic or
  OpenAI) and handled under its terms. That's the user's choice, per key.
- ProdLi logs no request or response bodies. Error logs show `/mcp/<token>`
  instead of a key in the path.
- Meeting audio never leaves the recording device, so it's not available here
  either; transcripts are only returned when explicitly asked for.
