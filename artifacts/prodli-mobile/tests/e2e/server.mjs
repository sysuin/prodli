// A small stand-in for ProdLi's server, for the phone app's browser tests and
// store screenshots: serves the app's web build and answers the API the app
// uses (developer sign-in, sync, AI with canned answers). One process, one
// origin, everything in memory. The real server's logic is tested in
// artifacts/prodli-api; this only needs to behave like it.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".wasm": "application/wasm" };

/** Answers like Ask ProdLi's, built from the to-dos and meetings the app sends. */
function askAnswer(b) {
  const tasks = (b.context?.tasks ?? []).map((t) => t.title);
  if (/decide|decision/i.test(b.question ?? "") && b.snippets?.length) {
    const m = b.snippets[0];
    return { answer: `In “${m.title}” you agreed to ship the beta on Friday and to keep pricing unchanged during the beta. Sam sends the invites; Alex writes the onboarding emails by Thursday.`, actions: [], sources: [1] };
  }
  const [a, c, d] = [tasks[0] ?? "your top task", tasks[1], tasks[2]];
  const lines = [`Start with “${a}” — it matters most today.`, "", `- First: ${a}`, ...(c ? [`- Then: ${c}`] : []), ...(d ? [`- If there's time: ${d}`] : [])];
  return { answer: lines.join("\n"), actions: [{ type: "add_task", title: "Send beta invites", details: "" }], sources: [] };
}

export function startServer({ root, port }) {
  const state = { users: new Map(), items: new Map(), seq: 0, calls: [] };
  const user = { id: "11111111-2222-3333-4444-555555555555", email: "dev@example.com", name: "Dev", picture: null, plan: "free", createdAt: Date.now() };

  /** Newest edit wins (equal stamps: keep the server's). */
  function sync(since, changes) {
    const mine = new Set();
    for (const ch of changes) {
      const key = `${ch.c}/${ch.id}`;
      const cur = state.items.get(key);
      if (cur && cur.u > ch.u) continue;
      state.items.set(key, { c: ch.c, id: ch.id, u: ch.u, d: !!ch.d, v: ch.d ? null : ch.v, s: ++state.seq });
      mine.add(key);
    }
    const out = [...state.items.entries()].filter(([k, it]) => it.s > since && !mine.has(k)).map(([, it]) => it).sort((a, b) => a.s - b.s);
    return { seq: state.seq, changes: out, more: false, accepted: mine.size, rejected: 0, usage: { bytes: 1000, quota: 100 * 1024 * 1024 } };
  }

  const api = {
    "POST /api/auth/google": (b) => (b?.kind === "mobile" && /^good:/.test(b.idToken ?? "") ? [200, { user, token: "pls_test", session: { id: "s1", client: "mobile", device: "ProdLi app on a phone", expiresAt: Date.now() + 1e10 } }] : [401, { error: "google_auth_failed" }]),
    "GET /api/me": () => [200, { user, session: { id: "s1", client: "mobile" } }],
    "GET /api/sessions": () => [200, { sessions: [{ id: "s1", client: "mobile", device: "ProdLi app on a phone", createdAt: Date.now(), lastUsedAt: Date.now(), current: true }, { id: "s2", client: "extension", device: "Chrome on macOS", createdAt: Date.now(), lastUsedAt: Date.now() - 3600e3, current: false }] }],
    "POST /api/auth/logout": () => [200, { ok: true }],
    "POST /api/sync": (b) => [200, sync(b.since ?? 0, b.changes ?? [])],
    "POST /api/sync/ticket": () => [503, { error: "ai_unavailable" }],
    "GET /api/ai/usage": () => [200, { used: 3, limit: 20, available: true, briefs: { used: 2, limit: 62 }, asks: { used: 5, limit: 100 }, transcribeSeconds: { used: 600, limit: 18000, available: true } }],
    "GET /api/billing": () => [200, { plan: "free", subscription: null, limits: { free: { storageBytes: 1e8, summaries: 20, briefs: 62, asks: 100, writes: 50, transcribeMinutes: 300 }, pro: { storageBytes: 2e9, summaries: 300, briefs: 200, asks: 1000, writes: 500, transcribeMinutes: 1500 } } }],
    "POST /api/ai/brief": (b) => [200, { brief: { headline: "Ship the beta, then protect your afternoon", summary: `${b.tasks.length} open tasks; the beta comes first.`, priorities: b.tasks.slice(0, 3).map((t) => ({ title: t.title, reason: t.overdue ? "Overdue" : "Moves the launch forward" })), schedule: [], watchouts: ["Two meetings after lunch"], habits: [], tip: "Do the hardest task before checking messages.", model: "test", generatedAt: new Date().toISOString() } }],
    "POST /api/ai/ask": (b) => [200, askAnswer(b)],
    "POST /api/ai/review": () => [200, { review: { headline: "A focused week with the launch on track", summary: "You finished the key launch tasks and kept your habits going.", wins: ["Launch checklist done"], slipped: [], patterns: ["Mornings were your most productive time"], nextWeek: [{ title: "Send beta invites", reason: "Testers are waiting" }], habitTip: "", question: "What will you say no to next week?", model: "test", generatedAt: new Date().toISOString() } }],
    "POST /api/ai/summarize": () => [200, { summary: { title: "Weekly sync", overview: "Agreed to ship the beta on Friday.", keyPoints: ["Scope is frozen"], decisions: ["Ship Friday"], actionItems: [{ task: "Send beta invites", owner: "Sam", dueDate: null, priority: "high" }], openQuestions: [], model: "test", generatedAt: new Date().toISOString() } }],
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      let json = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {}
      state.calls.push({ method: req.method, path: url.pathname, body: json });
      const handler = api[`${req.method} ${url.pathname}`];
      const [status, out] = handler ? handler(json) : [404, { error: "not_found" }];
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(out));
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, "index.html"); // single-page app
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ state, close: () => server.close(), url: `http://localhost:${port}` })));
}

/** Another device writing to the account. */
export function pushFromOtherDevice(state, changes) {
  for (const ch of changes) state.items.set(`${ch.c}/${ch.id}`, { ...ch, d: !!ch.d, s: ++state.seq });
}
