// ProdLi's MCP server (Model Context Protocol), served at POST /mcp over the
// Streamable HTTP transport with plain JSON responses (no SSE, no sessions).
// Tools are read-only views of the user's data (src/readApi.ts).
//
// It speaks both eras of the protocol:
//   legacy (2024-11-05 … 2025-11-25): `initialize` handshake, then requests.
//     Each request stands alone here, so nothing is kept between them.
//   modern (2026-07-28): no handshake; every request carries its version in
//     params._meta and mirrors it in headers (MCP-Protocol-Version,
//     Mcp-Method, Mcp-Name), which must match the body.
// Authentication (a personal access token) happens in app.ts before this runs.

import { ArgError, check, getMeeting, getNote, getToday, listHabits, listMeetings, listTodos, SCHEMAS, searchNotes, type ArgSchema, type MeetingDetail, type Operation, type Reader, type TodoOut } from "./readApi";

export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const MODERN_VERSIONS = ["2026-07-28"];
export const DEFAULT_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "prodli", title: "ProdLi", version: "1.0.0" };
const META_VERSION = "io.modelcontextprotocol/protocolVersion";

export const INSTRUCTIONS =
  "ProdLi is the user's personal productivity app. These tools read (never change) their to-dos, notes, meeting notes, habits and today's plan. " +
  "Dates are YYYY-MM-DD. When you know the user's time zone, pass it to get_today and list_habits so \"today\" is their today. " +
  "Use the ids from list results with get_note and get_meeting. Ask for a meeting's transcript only when the summary isn't enough.";

/** Longest transcript text returned in one tool result (MCP clients struggle with huge results). */
const MAX_TRANSCRIPT_CHARS = 150_000;

// ── Tools ────────────────────────────────────────────────────────────────────

interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}
interface Tool {
  name: Operation;
  title: string;
  description: string;
  run(read: Reader, args: Record<string, unknown>, now: number): Promise<ToolResult>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mins = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`);

function todoLine(t: TodoOut, extra = ""): string {
  const bits = [
    t.dueDate && `due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}`,
    t.plannedFor && `planned ${t.plannedFor}`,
    t.priority && `${t.priority} priority`,
    t.list && `list: ${t.list}`,
    t.labels.length && t.labels.map((l) => `@${l}`).join(" "),
    t.estimateMin && `~${t.estimateMin} min`,
    t.repeats && `repeats ${t.repeats}`,
    t.completed && t.completedAt && `done ${t.completedAt.slice(0, 10)}`,
  ].filter(Boolean);
  const subs = t.subtasks.length ? `\n${t.subtasks.map((s) => `    - [${s.completed ? "x" : " "}] ${s.title}`).join("\n")}` : "";
  return `- [${t.completed ? "x" : " "}] ${t.title}${bits.length ? ` (${bits.join(", ")})` : ""}${extra}${subs}`;
}

function meetingText(m: MeetingDetail | Omit<MeetingDetail, "yourNotes">, full: boolean): string {
  const head = `${(m.startedAt ?? "").slice(0, 10) || "(no date)"} · ${m.title} (${mins(m.durationSec)}) [id: ${m.id}]`;
  const s = m.summary;
  if (!s) return full ? `# ${m.title}\n${head}\n\nNo summary yet.` : `- ${head}\n  No summary yet.`;
  const items = s.actionItems.map((a) => `${a.done ? "[x] " : ""}${a.task}${a.owner ? ` (${a.owner}${a.dueDate ? `, due ${a.dueDate}` : ""})` : a.dueDate ? ` (due ${a.dueDate})` : ""}`);
  if (!full) {
    return [`- ${head}`, s.overview && `  ${s.overview}`, s.decisions.length && `  Decisions: ${s.decisions.join("; ")}`, items.length && `  Action items: ${items.join("; ")}`].filter(Boolean).join("\n");
  }
  const section = (title: string, lines: string[]) => (lines.length ? `\n## ${title}\n${lines.map((l) => `- ${l}`).join("\n")}` : "");
  return [
    `# ${m.title}`,
    head,
    s.overview && `\n${s.overview}`,
    section("Key points", s.keyPoints),
    section("Decisions", s.decisions),
    section("Action items", items),
    section("Open questions", s.openQuestions),
    ...s.sections.map((x) => section(x.heading, x.points)),
  ]
    .filter(Boolean)
    .join("\n");
}

export const TOOLS: Tool[] = [
  {
    name: "list_todos",
    title: "List to-dos",
    description: "List the user's to-dos (open by default), soonest due first. Filter by list or label.",
    async run(read, args) {
      const r = await listTodos(read, args);
      const what = `${r.status === "all" ? "" : `${r.status} `}to-do${r.total === 1 ? "" : "s"}${r.list ? ` in ${r.list}` : ""}`;
      const head = r.total > r.todos.length ? `${r.total} ${what} (showing ${r.todos.length}):` : `${r.total} ${what}${r.total ? ":" : "."}`;
      return { text: [head, ...r.todos.map((t) => todoLine(t))].join("\n"), structured: r };
    },
  },
  {
    name: "search_notes",
    title: "Search notes",
    description: "Search the user's notes by words in the title or text (all words must match). Without a query, lists the most recent notes. Returns ids and short excerpts; use get_note for the full text.",
    async run(read, args) {
      const r = await searchNotes(read, args);
      const head = r.total ? `${plural(r.total, "note")}${r.query ? ` matching "${r.query}"` : ""}${r.total > r.notes.length ? ` (showing ${r.notes.length})` : ""}:` : r.query ? `No notes match "${r.query}".` : "No notes yet.";
      const lines = r.notes.map((n) => `- ${n.title}${n.pinned ? " (pinned)" : ""} · updated ${(n.updatedAt ?? n.createdAt ?? "").slice(0, 10)} [id: ${n.id}]${n.excerpt ? `\n  ${n.excerpt}` : ""}`);
      return { text: [head, ...lines].join("\n"), structured: r };
    },
  },
  {
    name: "get_note",
    title: "Read a note",
    description: "Read one note in full, as plain text with Markdown-style headings, lists and checklists.",
    async run(read, args) {
      const note = await getNote(read, args.id as string);
      if (!note) return { text: `No note with id "${args.id as string}". Use search_notes to find it.`, isError: true };
      return { text: `# ${note.title}\n(updated ${(note.updatedAt ?? note.createdAt ?? "").slice(0, 10)})\n\n${note.text || "(empty)"}`, structured: { note } };
    },
  },
  {
    name: "list_meetings",
    title: "List meetings",
    description: "List recorded meetings, newest first, with each one's summary: overview, decisions and action items.",
    async run(read, args) {
      const r = await listMeetings(read, args);
      const head = r.total ? `${plural(r.total, "meeting")}${args.since ? ` since ${args.since as string}` : ""}${r.total > r.meetings.length ? ` (showing ${r.meetings.length})` : ""}:` : "No meetings found.";
      return { text: [head, ...r.meetings.map((m) => meetingText(m, false))].join("\n"), structured: r };
    },
  },
  {
    name: "get_meeting",
    title: "Read a meeting",
    description: "Read one meeting's full notes: overview, key points, decisions, action items, open questions and the user's own notes. Set transcript to true for the full transcript.",
    async run(read, args) {
      const m = await getMeeting(read, args.id as string, args.transcript === true);
      if (!m) return { text: `No meeting with id "${args.id as string}". Use list_meetings to find it.`, isError: true };
      let text = meetingText(m, true);
      if (m.yourNotes) text += `\n\n## Your notes\n${m.yourNotes}`;
      let truncated = 0;
      if (m.transcript) {
        const lines: string[] = [];
        let size = 0;
        for (const e of m.transcript) {
          const line = `[${e.at}] ${e.speaker ? `${e.speaker}: ` : ""}${e.text}`;
          if (size + line.length > MAX_TRANSCRIPT_CHARS) break;
          lines.push(line);
          size += line.length + 1;
        }
        truncated = m.transcript.length - lines.length;
        if (truncated) m.transcript = m.transcript.slice(0, lines.length);
        text += `\n\n## Transcript\n${lines.join("\n") || "(no transcript)"}${truncated ? `\n[… ${truncated} more lines not shown]` : ""}`;
      }
      return { text, structured: { meeting: m, ...(truncated ? { transcriptTruncated: truncated } : {}) } };
    },
  },
  {
    name: "get_today",
    title: "Today's plan",
    description: "The user's plan for a day (today by default): their focus, time blocks, to-dos planned, due or overdue, and habits due that day. Calendar events aren't included.",
    async run(read, args, now) {
      const r = await getToday(read, args, now);
      const lines = [`Plan for ${r.date} (${r.timezone})`];
      if (r.focus) lines.push(`Focus: ${r.focus}`);
      if (r.timeBlocks.length) lines.push("", "Time blocks:", ...r.timeBlocks.map((b) => `- ${b.start}–${b.end} ${b.title}`));
      lines.push("", r.todos.length ? "To-dos:" : "No to-dos planned, due or overdue.", ...r.todos.map((t) => todoLine(t, t.why === "overdue" ? " — overdue" : t.why === "due" ? " — due today" : "")));
      if (r.habits.length) lines.push("", "Habits:", ...r.habits.map((h) => `- [${h.done ? "x" : " "}] ${h.emoji ? `${h.emoji} ` : ""}${h.name}${h.streak ? ` (streak ${h.streak})` : ""}`));
      return { text: lines.join("\n"), structured: { ...r } };
    },
  },
  {
    name: "list_habits",
    title: "List habits",
    description: "List the user's habits with whether each was done on a day (today by default), the current streak and the last 7 days.",
    async run(read, args, now) {
      const r = await listHabits(read, args, now);
      const mark = (d: boolean | null) => (d === null ? "·" : d ? "✓" : "✗");
      const lines = r.habits.map((h) => {
        const amount = h.today.amount !== null && h.target !== null ? ` ${h.today.amount}/${h.target}${h.unit ? ` ${h.unit}` : ""}${h.kind === "quit" ? " max" : ""}` : "";
        const state = !h.today.scheduled ? "not due" : h.today.done ? "done" : "not done yet";
        return `- ${h.emoji ? `${h.emoji} ` : ""}${h.name}${h.archived ? " (archived)" : ""}: ${state}${amount}, streak ${h.streak}, last 7 days ${h.last7.map((d) => mark(d.done)).join("")}${h.onDays ? ` (on ${h.onDays.join(", ")})` : ""}`;
      });
      return { text: [r.habits.length ? `Habits on ${r.date} (${r.timezone}):` : "No habits yet.", ...lines].join("\n"), structured: r };
    },
  },
];

export const toolList = () =>
  TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: SCHEMAS[t.name] as ArgSchema, annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

// ── JSON-RPC over HTTP ───────────────────────────────────────────────────────

type Id = string | number | null;
interface Message {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, headerMismatch: -32020, unsupportedVersion: -32022 } as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rpcError = (id: Id, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });

/** `=?base64?…?=` header values (MCP's encoding for non-ASCII names). */
function headerValue(v: string | null): string | null {
  if (v === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export interface McpContext {
  read: Reader;
  now: number;
  headers: Headers;
  log?: (msg: Record<string, unknown>) => void;
}

interface Reply {
  status: number;
  body: unknown;
}

/** tools/call → the result, or a JSON-RPC error message for a malformed call. */
async function callTool(params: Record<string, unknown>, ctx: McpContext): Promise<{ error: string } | { result: Record<string, unknown> }> {
  if (typeof params.name !== "string") return { error: "tools/call needs params.name" };
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return { error: `Unknown tool: ${params.name}` };
  if (params.arguments !== undefined && params.arguments !== null && !isObj(params.arguments)) return { error: "params.arguments must be an object" };
  let result: ToolResult;
  try {
    result = await tool.run(ctx.read, check(tool.name, params.arguments), ctx.now);
  } catch (err) {
    // Bad arguments are reported to the model as a tool error, so it can correct itself.
    if (err instanceof ArgError) result = { text: `Invalid arguments: ${err.message}`, isError: true };
    else throw err;
  }
  return { result: { content: [{ type: "text", text: result.text }], ...(result.structured ? { structuredContent: result.structured } : {}), ...(result.isError ? { isError: true } : {}) } };
}

/** One JSON-RPC request → its reply (HTTP status + body). Notifications never get here. */
async function handleRequest(msg: Message, ctx: McpContext): Promise<Reply> {
  const id = msg.id as Id;
  const method = msg.method as string;
  const params = isObj(msg.params) ? msg.params : {};
  if (msg.params !== undefined && !isObj(msg.params)) return { status: 200, body: rpcError(id, RPC.invalidParams, "params must be an object") };
  const meta = isObj(params._meta) ? params._meta : {};
  const metaVersion = meta[META_VERSION];
  const headerVersion = ctx.headers.get("MCP-Protocol-Version");
  const modern = typeof metaVersion === "string" && method !== "initialize";

  if (modern) {
    // Headers mirror the body; a mismatch means some hop saw a different request.
    const mismatch = (what: string) => ({ status: 400, body: rpcError(id, RPC.headerMismatch, `Header mismatch: ${what}`) });
    if (headerVersion !== metaVersion) return mismatch(`MCP-Protocol-Version header "${headerVersion ?? ""}" does not match _meta "${metaVersion}"`);
    if (ctx.headers.get("Mcp-Method") !== method) return mismatch(`Mcp-Method header does not match method "${method}"`);
    if (method === "tools/call" && headerValue(ctx.headers.get("Mcp-Name")) !== params.name) return mismatch(`Mcp-Name header does not match params.name`);
    if (!MODERN_VERSIONS.includes(metaVersion)) {
      return { status: 400, body: rpcError(id, RPC.unsupportedVersion, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: metaVersion }) };
    }
  } else if (headerVersion !== null && method !== "initialize" && !LEGACY_VERSIONS.includes(headerVersion)) {
    if (MODERN_VERSIONS.includes(headerVersion)) return { status: 400, body: rpcError(id, RPC.headerMismatch, `Header mismatch: request has no _meta["${META_VERSION}"]`) };
    return { status: 400, body: rpcError(id, RPC.invalidRequest, `Unsupported protocol version "${headerVersion}"`, { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: headerVersion }) };
  }

  const done = (result: Record<string, unknown>): Reply => ({ status: 200, body: { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result } : result } });
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return done({ protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : DEFAULT_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "server/discover":
      return done({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO }, instructions: INSTRUCTIONS });
    case "ping":
      return done({});
    case "tools/list":
      return done({ tools: toolList() });
    case "tools/call": {
      const out = await callTool(params, ctx);
      return "error" in out ? { status: 200, body: rpcError(id, RPC.invalidParams, out.error) } : done(out.result);
    }
    default:
      return { status: modern ? 404 : 200, body: rpcError(id, RPC.methodNotFound, `Method not found: ${method}`) };
  }
}

const isRequestId = (x: unknown) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x));

/** A message that isn't a valid request or notification gets this. */
function invalid(msg: unknown): Reply | null {
  if (!isObj(msg) || msg.jsonrpc !== "2.0") return { status: 400, body: rpcError(null, RPC.invalidRequest, "Invalid Request: expected a JSON-RPC 2.0 message") };
  if (typeof msg.method !== "string") {
    // A client's response to us: we never send requests, so there's nothing to do.
    if ("result" in msg || "error" in msg) return null;
    return { status: 400, body: rpcError(isRequestId(msg.id) ? (msg.id as Id) : null, RPC.invalidRequest, "Invalid Request: missing method") };
  }
  if ("id" in msg && !isRequestId(msg.id)) return { status: 400, body: rpcError(null, RPC.invalidRequest, "Invalid Request: id must be a string or number") };
  return null;
}

async function handleOne(msg: unknown, ctx: McpContext): Promise<Reply | null> {
  const bad = invalid(msg);
  if (bad) return bad;
  const m = msg as Message;
  if (typeof m.method !== "string" || !("id" in m)) return null; // notification (or a response): 202
  try {
    return await handleRequest(m, ctx);
  } catch (err) {
    ctx.log?.({ msg: "mcp_error", method: m.method, error: err instanceof Error ? err.message : String(err) });
    return { status: 200, body: rpcError(m.id as Id, RPC.internal, "Internal error. Try again.") };
  }
}

/** The whole POST /mcp exchange: raw body in, HTTP response out. */
export async function mcpResponse(raw: string, ctx: McpContext): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, RPC.parse, "Parse error: the body must be JSON"), 400);
  }
  // JSON-RPC batches (protocol 2025-03-26 only; later versions dropped them).
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, RPC.invalidRequest, "Invalid Request: empty batch"), 400);
    const replies = (await Promise.all(body.map((m) => handleOne(m, ctx)))).filter((r): r is Reply => r !== null);
    return replies.length ? json(replies.map((r) => r.body)) : new Response(null, { status: 202 });
  }
  const reply = await handleOne(body, ctx);
  return reply ? json(reply.body, reply.status) : new Response(null, { status: 202 });
}
