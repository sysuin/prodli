#!/usr/bin/env node
// End-to-end test of ProdLi accounts with the REAL server code:
//   - prodli-api running locally (wrangler dev, fresh local D1 database)
//   - the extension (test build pointed at that server)
//   - the web app served by the same Worker
// Google is replaced by the server's development-only stand-in
// (DEV_FAKE_GOOGLE, ignored outside ENV=development).
//
//   pnpm --filter @workspace/prodli run test:e2e:server

import { execSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prodli = path.resolve(here, "../..");
const repo = path.resolve(prodli, "../..");
const api = path.join(repo, "artifacts/prodli-api");
const PORT = 8788;
const SERVER = `http://localhost:${PORT}`;
const OUT = "dist-extension-server-test";

process.env.PRODLI_OUT_DIR = OUT; // cdp.mjs loads this build
const { Browser, sleep, waitForDownload } = await import("./cdp.mjs");

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

console.log("==> Building the extension (test build → local server) and the web app");
run("node scripts/build-extension.mjs", prodli, { PRODLI_OUT_DIR: OUT, PRODLI_GOOGLE_CLIENT_ID: "", PRODLI_EXTENSION_KEY: "", VITE_PRODLI_API: SERVER });
run("node scripts/build-app.mjs", repo);

console.log("==> Starting the server with a fresh local database");
const state = mkdtempSync(path.join(tmpdir(), "prodli-api-e2e-"));
run(`pnpm exec wrangler d1 migrations apply DB --local --persist-to "${state}"`, api, { CI: "true" });
// ProdLi Pro on sale, with a local stand-in for Dodo Payments' API (the Worker
// only uses DODO_API_BASE in development).
const DODO_PORT = 8799;
const DODO = `http://localhost:${DODO_PORT}`;
const DODO_SECRET = `whsec_${Buffer.from("prodli-e2e-webhook-key").toString("base64")}`;
const dodoCalls = [];
const fakeDodo = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    dodoCalls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const send = (obj) => (res.writeHead(200, { "Content-Type": "application/json" }), res.end(JSON.stringify(obj)));
    if (req.method === "POST" && req.url === "/customers") return send({ customer_id: "cus_e2e" });
    if (req.method === "POST" && req.url === "/checkouts") return send({ session_id: "cks_e2e", checkout_url: `${DODO}/checkout/cks_e2e` });
    if (req.method === "GET" && req.url.startsWith("/products/")) return send({ product_id: req.url.slice(10), price: { type: "recurring_price", price: req.url.includes("year") ? 4800 : 500, currency: "USD" } });
    if (req.method === "POST" && req.url.startsWith("/customers/cus_e2e/customer-portal/session")) return send({ link: `${DODO}/portal/cus_e2e` });
    if (req.method === "GET" && req.url.startsWith("/checkout/")) return res.writeHead(200, { "Content-Type": "text/html" }), res.end("<title>Dodo checkout</title><h1>Pay for ProdLi Pro</h1>");
    res.writeHead(404).end("{}");
  });
}).listen(DODO_PORT);
const dodoVars = ["DODO_ENV:test", "DODO_PRODUCT_MONTHLY:pdt_month", "DODO_PRODUCT_YEARLY:pdt_year", "DODO_API_KEY:dodo_e2e_key", `DODO_WEBHOOK_SECRET:${DODO_SECRET}`, `DODO_API_BASE:${DODO}`].flatMap((v) => ["--var", v]);
const server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", state, "--var", "DEV_FAKE_GOOGLE:true", ...dodoVars, "--log-level", "warn"], {
  cwd: api,
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, CI: "true" },
});
const stopServer = () => {
  fakeDodo.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  rmSync(state, { recursive: true, force: true });
};
process.on("exit", stopServer);

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${SERVER}/api/health`)).ok) break;
  } catch {}
  if (i > 120) throw new Error("Server didn't start");
  await sleep(500);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const ALICE = "good:alice:alice@example.com:Alice Example";
const setInput = (selector, value) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
// Settings at a section (account, plan, devices, data…), as the profile menu opens it.
const openAccount = (p, tab = "account") => p.eval(`window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: ${JSON.stringify(tab)} } }))`);

const b = new Browser();
try {
  await b.loadExtension();

  console.log("extension");
  const p = await b.openPage();
  await p.goto("editor");
  // Stand in for chrome.identity (Google) — the server's dev stand-in accepts this token.
  const fakeChromeGoogle = `(() => {
    chrome.runtime.getManifest = () => ({ oauth2: { client_id: "e2e.apps.googleusercontent.com" } });
    chrome.identity.getAuthToken = async () => ({ token: ${JSON.stringify(ALICE)} });
    chrome.identity.removeCachedAuthToken = async () => {};
    chrome.identity.clearAllCachedAuthTokens = async () => {};
    const realFetch = window.fetch;
    window.fetch = (url, init) => String(url).includes("googleapis.com") ? Promise.resolve(new Response("{}", { status: 401 })) : realFetch(url, init);
    return true;
  })()`;
  await p.eval(fakeChromeGoogle);
  await openAccount(p);
  await sleep(500);
  check("Account window offers a ProdLi account", (await p.text()).includes("Sign in to your ProdLi account"));
  await p.click("Sign in with Google", { exact: false });
  await sleep(1500);
  let t = await p.text();
  check("Extension: signs in to the ProdLi account", t.includes("Alice Example") && t.includes("alice@example.com") && t.includes("Signed in as alice@example.com"), t.slice(0, 300));
  check("Profile menu: the avatar opens a short menu with Settings", await p.eval(`(async () => { document.querySelector('nav button[aria-haspopup="menu"]').click(); await new Promise(r => setTimeout(r, 300)); const m = document.querySelector('[role="menu"]'); const ok = !!m && m.innerText.includes("Settings") && m.innerText.includes("Upgrade to Pro") && m.innerText.includes("alice@example.com"); document.querySelector('nav button[aria-haspopup="menu"]').click(); return ok; })()`));
  await openAccount(p, "devices");
  await sleep(900);
  const devicesText = await p.text();
  check("Extension: lists this device", devicesText.toLowerCase().includes("signed-in devices") && /Extension · .* ?\(this one\)/.test(devicesText), devicesText.slice(0, 400).replace(/\n/g, " | "));
  const { prodliSession } = await p.storage(["prodliSession"]);
  check("Extension: keeps a session token (not the Google token)", typeof prodliSession?.token === "string" && prodliSession.token.startsWith("pls_"));
  check("Extension: avatar button shows the account", await p.eval(`!!document.querySelector('nav button[aria-label="Account: alice@example.com"]')`));

  await openAccount(p, "data");
  await sleep(500);
  await p.click("Download my data");
  const exported = JSON.parse((await waitForDownload(b, "prodli-account-")) ?? "{}");
  check("Extension: downloads the account data", exported.format === "prodli-account-export" && exported.account?.email === "alice@example.com" && exported.devices?.length === 1);

  console.log("web app");
  const w = await b.openPage(`${SERVER}/`);
  await w.eval(`localStorage.setItem("prodli_hasSeenOnboarding", "true")`);
  const status = await w.eval(
    `fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "web", idToken: ${JSON.stringify(ALICE)} }) }).then(r => r.status)`,
  );
  check("Web: signs in (Google ID token → HttpOnly cookie)", status === 200);
  check("Web: the session cookie isn't readable by page scripts", !(await w.eval("document.cookie")).includes("prodli_session"));
  await w.send("Page.reload", {});
  await sleep(1800);
  await openAccount(w);
  await sleep(1500);
  t = await w.text();
  check("Web: same account as the extension", t.includes("Alice Example") && t.includes("alice@example.com"), t.slice(0, 300));
  await openAccount(w, "devices");
  await sleep(1200);
  t = await w.text();
  check("Web: sees both devices (extension + web)", /Extension · /.test(t) && /Web · .* ?\(this one\)/.test(t), t.slice(0, 500).replace(/\n/g, " | "));

  console.log("sync");
  const waitFor = async (fn, ms = 10_000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn()) return Date.now() - t0;
      if (Date.now() - t0 > ms) return -1;
      await sleep(250);
    }
  };
  const extNotes = async () => (await p.storage(["notes"])).notes ?? [];
  const webNotes = async () => JSON.parse((await w.eval(`localStorage.getItem("prodli_notes")`)) ?? "[]");
  await sleep(1500); // both devices finish their first sync
  check("Sync: one welcome note on both devices (not one per device)", (await extNotes()).filter((n) => n.title === "Welcome to ProdLi").length === 1 && (await webNotes()).filter((n) => n.title === "Welcome to ProdLi").length === 1);

  // Close the account window on the web page and type a new note.
  await w.eval(`document.querySelector('[aria-label="Close"]')?.click()`);
  await w.click("+");
  await sleep(300);
  await w.focusEditor();
  await w.type("Typed on the website");
  let ms = await waitFor(async () => (await extNotes()).some((n) => n.content.includes("Typed on the website")));
  check("Sync: a note typed on the website appears in the extension (live)", ms >= 0, `waited ${ms} ms`);
  if (ms >= 0) console.log(`    (arrived after ${ms} ms)`);
  // …and shows in the extension's open editor list without a reload.
  check("Sync: the extension's open page shows it", await waitFor(async () => (await p.text()).includes("Typed on the website"), 4000) >= 0);

  // Edit it in the extension; the website gets the edit.
  await p.eval(`[...document.querySelectorAll("button, [role=button], li, div")].find(el => el.children.length < 6 && el.textContent.trim().startsWith("Typed on the website"))?.click()`);
  await sleep(500);
  await p.focusEditor();
  await p.type(" — and edited in the extension");
  ms = await waitFor(async () => (await webNotes()).some((n) => n.content.includes("and edited in the extension")));
  check("Sync: an edit in the extension reaches the website", ms >= 0, `waited ${ms} ms`);

  // Delete it on the website (as the editor does: the list without it); it disappears from the extension.
  await w.eval(`(() => {
    const notes = JSON.parse(localStorage.getItem("prodli_notes")).filter(n => !n.content.includes("Typed on the website"));
    localStorage.setItem("prodli_notes", JSON.stringify(notes));
    window.dispatchEvent(new CustomEvent("prodli-storage", { detail: { key: "notes", newValue: notes } }));
    return true;
  })()`);
  ms = await waitFor(async () => !(await extNotes()).some((n) => n.content.includes("Typed on the website")));
  check("Sync: deleting on the website deletes in the extension", ms >= 0, `waited ${ms} ms`);

  // A to-do from the extension reaches the website.
  await p.goto("todos");
  await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Task from the extension"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(100);
  await p.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  ms = await waitFor(async () => JSON.parse((await w.eval(`localStorage.getItem("prodli_todos")`)) ?? "[]").some((t) => t.title === "Task from the extension"));
  check("Sync: a to-do added in the extension appears on the website", ms >= 0, `waited ${ms} ms`);

  // A meeting recorded in the extension shows up in the web app's Meetings, searchable.
  await p.eval(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const t = db.transaction("meetings", "readwrite");
    const now = new Date().toISOString();
    t.objectStore("meetings").put({ id: "e2e-meeting", platform: "google-meet", title: "Quarterly planning", meetingCode: null, url: "https://meet.google.com/x", startedAt: now, endedAt: now, durationSec: 600, status: "ready",
      transcript: [{ id: "e1", speaker: "Priya", text: "Budget review moves to Thursday", startMs: 0, endMs: 1000 }], summary: null, error: null, notice: null, hasAudio: true, micIncluded: false, audioMimeType: "audio/webm", updatedAt: now });
    await new Promise((r) => (t.oncomplete = r));
    new BroadcastChannel("prodli-meetings").postMessage("changed");
    return true;
  })()`);
  await w.eval(`localStorage.setItem("prodli_lastSection", JSON.stringify("meetings"))`);
  ms = await waitFor(async () => {
    await w.send("Page.reload", {});
    await sleep(1500);
    return (await w.text()).includes("Quarterly planning");
  }, 15_000);
  check("Web app: a meeting recorded in the extension appears in Meetings", ms >= 0, (await w.text()).slice(0, 300));
  await w.eval(`(() => { const i = document.querySelector('input[aria-label="Search meetings"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "thursday"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(300);
  check("Web app: searching meetings looks inside transcripts", (await w.text()).includes("Quarterly planning"));
  check("Web app: meeting audio stays on the extension's computer", !(await w.eval(`!!document.querySelector("audio")`)));

  // Sharing a meeting's notes: a read-only page with the summary only; free accounts pick 7 or 30 days (Pro is on sale here).
  await w.eval(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const t = db.transaction("meetings", "readwrite");
    const store = t.objectStore("meetings");
    const m = await new Promise((res) => { const g = store.get("e2e-meeting"); g.onsuccess = () => res(g.result); });
    store.put({ ...m, summary: { title: "Quarterly planning", overview: "Budget review moved; hiring plan agreed.", keyPoints: ["Two hires in Q1"], decisions: ["Budget review on Thursday"], actionItems: [{ task: "Send the hiring plan", owner: "Priya", dueDate: null, priority: "high" }], openQuestions: [], model: "t", generatedAt: new Date().toISOString() } });
    await new Promise((r) => (t.oncomplete = r));
    new BroadcastChannel("prodli-meetings").postMessage("changed");
    return true;
  })()`);
  await w.send("Page.reload", {});
  await sleep(1800);
  await w.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "🔗 Share").click()`);
  await sleep(800);
  check("Share: free accounts can't pick a link with no expiry while Pro is on sale", await w.eval(`document.querySelector('[data-testid="share-meeting"] option[value="never"]').disabled`));
  await w.eval(`[...document.querySelectorAll('[data-testid="share-meeting"] button')].find((x) => x.textContent.includes("Create link")).click()`);
  await sleep(1500);
  const sharedUrl = await w.eval(`document.querySelector('[data-testid="share-meeting"] input[aria-label="Shared link"]')?.value ?? ""`);
  const sharedPage = sharedUrl ? await fetch(sharedUrl) : null;
  const sharedHtml = sharedPage ? await sharedPage.text() : "";
  check("Share: creates a link to a read-only page with the summary", sharedPage?.status === 200 && sharedHtml.includes("Quarterly planning") && sharedHtml.includes("Send the hiring plan") && /until/.test(await w.eval(`document.querySelector('[data-testid="share-status"]').innerText`)), `${sharedUrl} ${sharedPage?.status}`);
  check("Share: the transcript is never on the shared page", !sharedHtml.includes("moves to Thursday"));
  await w.eval(`[...document.querySelectorAll('[data-testid="share-meeting"] button')].find((x) => x.textContent.includes("Stop sharing")).click()`);
  await sleep(1200);
  check("Share: Stop sharing turns the link off", sharedUrl ? (await fetch(sharedUrl)).status === 404 : false);
  const coach = await w.eval(`(() => { const c = document.querySelector('[data-testid="meeting-coach"]'); return c ? { text: c.innerText, upgrade: !!c.querySelector('[data-testid="pro-upgrade"]'), button: [...c.querySelectorAll("button")].some((b) => /Coach me/.test(b.textContent)) } : null; })()`);
  check("Coach: free accounts see 🎯 Coach me is part of Pro (no button) while Pro is on sale", !!coach && coach.upgrade && !coach.button && /Coaching tips are part of ProdLi Pro/.test(coach.text), JSON.stringify(coach));

  // Phones: sections on their own row; the editor shows the list or the note.
  await w.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await w.eval(`localStorage.setItem("prodli_lastSection", JSON.stringify("editor"))`);
  await w.send("Page.reload", {});
  await sleep(1800);
  const phone = await w.eval(`(() => {
    const bar = document.querySelector(".mobile-tabbar").getBoundingClientRect();
    return { tabbar: getComputedStyle(document.querySelector(".mobile-tabbar")).display === "flex" && Math.round(bar.width) === innerWidth && bar.bottom >= innerHeight - 1,
      sidebarHidden: getComputedStyle(document.querySelector(".app-sidebar")).display === "none", noSideScroll: document.documentElement.scrollWidth <= innerWidth,
      listHidden: getComputedStyle(document.querySelector(".editor-sidebar")).display === "none", back: !!document.querySelector(".editor-back") && getComputedStyle(document.querySelector(".editor-back")).display !== "none" };
  })()`);
  check("Phone: bottom tab bar instead of the sidebar", phone.tabbar && phone.sidebarHidden, JSON.stringify(phone));
  check("Phone: the editor shows the note with a way back to the list, no sideways scrolling", phone.listHidden && phone.back && phone.noSideScroll, JSON.stringify(phone));
  await w.eval(`document.querySelector(".editor-back").click()`);
  await sleep(300);
  check("Phone: 'All notes' shows the full-width list", await w.eval(`getComputedStyle(document.querySelector(".editor-sidebar")).display !== "none" && getComputedStyle(document.querySelector(".editor-main")).display === "none"`));
  await w.eval(`[...document.querySelectorAll(".tab-btn")].find(b => /more/i.test(b.innerText)).click()`);
  await sleep(300);
  check("Phone: 'More' lists every section", await w.eval(`["Today","To-Dos","Habits","Notes","Meetings","Files","Pomodoro","Time Tracker"].every(l => [...document.querySelectorAll(".more-item")].some(b => b.innerText.includes(l)))`));
  await w.eval(`document.querySelector(".more-sheet-backdrop").click()`);
  await w.send("Emulation.clearDeviceMetricsOverride", {});

  // Security headers on the app's pages, and offline use.
  const headers = await w.eval(`fetch("/").then(r => ({ csp: r.headers.get("content-security-policy") || "", frame: r.headers.get("x-frame-options") }))`);
  check("Web app: pages are served with a strict Content-Security-Policy", headers.csp.includes("default-src 'self'") && headers.csp.includes("frame-ancestors 'none'") && headers.frame === "DENY", JSON.stringify(headers));
  ms = await waitFor(() => w.eval(`navigator.serviceWorker.getRegistration().then(r => !!r?.active)`), 10_000);
  check("Web app: installs its offline cache", ms >= 0);
  await w.send("Network.enable", {});
  await w.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await w.send("Page.reload", {});
  await sleep(2500);
  check("Web app: opens and shows your notes with no connection", await w.eval(`!!document.querySelector(".ProseMirror") && document.body.innerText.includes("Welcome to ProdLi")`));
  await openAccount(w, "devices");
  await sleep(1500);
  check("Web app: offline is shown as offline, not as an error", /Offline — your changes are saved here|Synced/.test(await w.text()), (await w.text()).slice(0, 400));
  await w.eval(`document.querySelector('[aria-label="Close"]')?.click()`);
  await w.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(1500);

  // Today: the daily brief (basic here — the local server has no Claude key), planning, focus synced.
  await w.eval(`localStorage.setItem("prodli_lastSection", JSON.stringify("today"))`);
  await w.send("Page.reload", {});
  await sleep(2500);
  t = await w.text();
  check("Today: opens with a greeting and a daily brief", /Good (morning|afternoon|evening)/.test(t) && !!(await w.eval(`document.querySelector('[data-testid="daily-brief"]')?.innerText.includes("Top priorities") || document.querySelector('[data-testid="daily-brief"]')?.innerText.includes("Start with")`)), t.slice(0, 400).replace(/\n/g, " | "));
  check("Today: says when the AI brief isn't available and shows a basic one", t.includes("AI briefs aren't available right now") && t.includes("Basic brief (no AI)"));
  await w.eval(`document.querySelector('input[aria-label$="main focus"]').focus()`);
  await w.type("Ship ProdLi 1.4");
  await w.key("Enter");
  ms = await waitFor(async () => ((await p.storage(["days"])).days ?? []).some((d) => d.focus === "Ship ProdLi 1.4"));
  check("Today: the day's focus syncs to the extension", ms >= 0, `waited ${ms} ms`);
  await w.eval(`document.querySelector('[data-testid="plan-day"] details summary')?.click()`);
  await sleep(300);
  const sunBtn = await w.eval(`(() => { const li = [...document.querySelectorAll(".today-task")].find(l => l.innerText.includes("Task from the extension")); const b = li && [...li.querySelectorAll("button")].find(b => b.textContent.includes("☀️")); b?.click(); return !!b; })()`);
  ms = sunBtn ? await waitFor(async () => ((await p.storage(["todos"])).todos ?? []).some((x) => x.title === "Task from the extension" && x.plannedFor)) : -1;
  check("Today: planning a task for today syncs to the extension's To-Dos", ms >= 0, `button found: ${sunBtn}; tasks: ${await w.eval(`[...document.querySelectorAll(".today-task")].map(l => l.innerText.slice(0, 40)).join(" / ") + " | plan: " + JSON.stringify(document.querySelector("[data-testid=plan-day]")?.innerText.slice(0, 300)) + " | section: " + document.querySelector("[aria-current=page]")?.title`)}`);
  // Command palette: Ctrl/⌘+K, type, add as a to-do.
  await w.eval(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
  await sleep(300);
  check("Palette: Ctrl/⌘+K opens search & commands", await w.eval(`!!document.querySelector('input[aria-label="Search commands"]')`));
  await w.type("Buy stamps");
  await sleep(200);
  await w.eval(`[...document.querySelectorAll('[role=option]')].find(o => o.innerText.includes("Add to-do"))?.click()`);
  ms = await waitFor(async () => ((await p.storage(["todos"])).todos ?? []).some((x) => x.title === "Buy stamps"));
  check("Palette: typing then 'Add to-do' adds it (and it syncs to the extension)", ms >= 0);
  // Ask ProdLi from Today (the local server has no Claude key: a clear message).
  await w.eval(`document.querySelector('input[aria-label="Ask ProdLi about your day"]').focus()`);
  await w.type("What should I do next?");
  await w.key("Enter");
  ms = await waitFor(async () => (await w.eval(`document.querySelector('[aria-label="Ask ProdLi"]')?.innerText ?? ""`)).includes("isn't available right now"), 8000);
  check("Ask ProdLi: opens from Today, asks, and explains when AI is unavailable", ms >= 0, await w.eval(`document.querySelector('[aria-label="Ask ProdLi"]')?.innerText.slice(0, 200) ?? "no panel"`));
  await w.eval(`document.querySelector('[aria-label="Ask ProdLi"] [aria-label="Close"]').click()`);
  // Phone share sheet / app shortcut: /?title=…&url=… opens Quick add.
  await w.send("Page.navigate", { url: `${SERVER}/?title=Shared%20article&url=https%3A%2F%2Fexample.com%2Fpost` });
  await sleep(2200);
  check("Quick add: a shared link opens Quick add, pre-filled", await w.eval(`document.querySelector('[aria-label="Quick add"] input[aria-label="Title"]')?.value === "Shared article"`));
  await w.eval(`[...document.querySelectorAll('[aria-label="Quick add"] button')].find(b => b.textContent.trim() === "Save").click()`);
  ms = await waitFor(async () => ((await p.storage(["todos"])).todos ?? []).some((x) => x.title === "Shared article" && x.subtasks?.some((st) => st.title === "https://example.com/post")));
  check("Quick add: saves the shared link as a to-do (synced to the extension)", ms >= 0);
  // Extension: the Quick add window (Alt+Shift+A) saves a note.
  const qa = await b.openPage(`chrome-extension://${b.extId}/index.html#quick-add?title=From%20a%20page&url=https%3A%2F%2Fexample.org%2F`);
  await sleep(1200);
  await qa.eval(`[...document.querySelectorAll('[role=radio]')].find(b => b.textContent.includes("Note")).click()`);
  await qa.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Save").click()`);
  ms = await waitFor(async () => ((await p.storage(["notes"])).notes ?? []).some((n) => n.title === "From a page" && n.content.includes("https://example.org/")));
  check("Quick add window (extension): saves a note with its source link", ms >= 0);
  await qa.close().catch(() => {});
  await w.send("Page.navigate", { url: `${SERVER}/` });
  await sleep(2000);

  check("Today: shows how much is planned against the time left", /planned · .* free/.test(await w.eval(`document.querySelector('[data-testid="workload"]')?.innerText ?? ""`)));

  console.log("connections (API keys + MCP)");
  await openAccount(w, "connections");
  await sleep(1200);
  check("Connections: explains what a key can do", (await w.text()).includes("Let Claude, ChatGPT or your own scripts read your ProdLi to-dos, notes and meetings"));
  check("Connections: shows this server's MCP URL", (await w.eval(`document.querySelector('[data-testid="mcp-url"]')?.innerText ?? ""`)).trim() === `${SERVER}/mcp`);
  await w.eval(setInput('[data-testid="connections"] input', "E2E script"));
  await sleep(100);
  await w.click("Create key");
  ms = await waitFor(() => w.eval(`!!document.querySelector('[data-testid="new-token"]')`), 5000);
  const apiKey = ms >= 0 ? (await w.eval(`document.querySelector('[data-testid="new-token"]').innerText`)).trim() : "";
  check("Connections: creates a key and shows it once", /^plt_[A-Za-z0-9_-]{43}$/.test(apiKey) && (await w.eval(`document.querySelector('[data-testid="api-tokens"]')?.innerText ?? ""`)).includes("E2E script"), apiKey);
  const mcp = (body) => fetch(`${SERVER}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  const listed = await (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  const toolNames = (listed.result?.tools ?? []).map((x) => x.name);
  check("MCP: tools/list with the new key lists the read-only tools", toolNames.length === 7 && toolNames.includes("list_todos") && listed.result.tools.every((x) => x.annotations?.readOnlyHint === true), JSON.stringify(listed).slice(0, 300));
  const called = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_todos", arguments: {} } })).json();
  check("MCP: list_todos reads the to-dos synced from the extension", (called.result?.content?.[0]?.text ?? "").includes("Task from the extension"), JSON.stringify(called).slice(0, 300));
  const meetingsText = (await (await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_meetings", arguments: {} } })).json()).result?.content?.[0]?.text ?? "";
  const todayText = (await (await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_today", arguments: {} } })).json()).result?.content?.[0]?.text ?? "";
  check("MCP: list_meetings and get_today work on the real Durable Object", meetingsText.includes("Quarterly planning") && !meetingsText.includes("moves to Thursday") && todayText.includes("Focus: Ship ProdLi 1.4"), `${meetingsText.slice(0, 200)} | ${todayText.slice(0, 200)}`);
  const sessionOnMcp = await w.eval(`fetch("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then(r => r.status)`);
  check("MCP: the web app's session cookie doesn't work there (keys only)", sessionOnMcp === 401);
  const keyOnAccount = (await fetch(`${SERVER}/api/me`, { headers: { Authorization: `Bearer ${apiKey}` } })).status;
  check("API key: can't use the rest of the API", keyOnAccount === 401);

  await openAccount(w, "devices");
  await sleep(800);
  t = await w.text();
  check("Sync: account window shows the sync status and usage", /Synced (just now|\d+ (s|min) ago)/.test(t) && /Using \d+ KB of 100\.0 MB/.test(t), t.slice(0, 600).replace(/\n/g, " | "));
  const exp = await w.eval(`fetch("/api/account/export").then(r => r.json())`);
  check("Sync: 'Download my data' includes synced notes and to-dos", exp.data?.notes?.length >= 1 && exp.data?.todos?.some((x) => x.title === "Task from the extension"));

  await w.click("Sign out everywhere");
  await sleep(1200);
  t = await w.text();
  check("Web: sign out everywhere", t.includes("Signed out on every device"), t.slice(0, 400).replace(/\n/g, " | "));
  const meAfter = await p.eval(`fetch(${JSON.stringify(SERVER)} + "/api/me", { headers: { Authorization: "Bearer " + ${JSON.stringify(prodliSession?.token ?? "")} } }).then(r => r.status)`);
  check("…which also signed out the extension", meAfter === 401);
  check("…and revoked the API key", (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/list" })).status === 401);

  console.log("delete account");
  await p.send("Page.reload", {});
  await sleep(1800);
  await p.eval(fakeChromeGoogle);
  await openAccount(p);
  await sleep(1000);
  check("Extension: shows signed out after a remote sign-out", (await p.text()).includes("Sign in to your ProdLi account"));
  await p.click("Sign in with Google", { exact: false });
  await sleep(1500);
  console.log("pro");
  // Your own meeting templates: Pro is on sale, so a free account sees how to get them.
  await p.goto("meetings");
  await sleep(800);
  if (!(await p.eval(`!!document.querySelector('[data-testid="custom-templates"]')`))) await p.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.includes("Setup"))?.click()`);
  await sleep(800);
  check("Pro: your own meeting templates show the upgrade note on a free account", await p.eval(`!!document.querySelector('[data-testid="custom-templates"] [data-testid="pro-upgrade"]')`), await p.eval(`document.querySelector('[data-testid="custom-templates"]')?.innerText ?? "no templates panel"`));
  await openAccount(p, "plan");
  await sleep(1200);
  t = await p.text();
  check("Pro: a free account sees the plans, Dodo's prices and an upgrade button", /your plan: free/i.test(t) && /AI meeting summaries\s*20\s*300/i.test(t) && /\$48/.test(t) && /upgrade to pro/i.test(t), t.slice(0, 700).replace(/\n/g, " | "));
  const before = new Set((await b.send("Target.getTargets")).targetInfos.map((x) => x.targetId));
  await p.click("Upgrade to Pro", { exact: false });
  await sleep(1500);
  const opened = (await b.send("Target.getTargets")).targetInfos.find((x) => !before.has(x.targetId) && x.type === "page");
  check("Pro: Upgrade opens Dodo's checkout page in a new tab (from the extension)", opened?.url === `${DODO}/checkout/cks_e2e`, opened?.url);
  const checkoutCall = dodoCalls.find((c) => c.path === "/checkouts");
  const { prodliSession: s2 } = await p.storage(["prodliSession"]);
  const me = await (await fetch(`${SERVER}/api/me`, { headers: { Authorization: `Bearer ${s2?.token ?? ""}`, Origin: "chrome-extension://x" } })).json();
  check(
    "Pro: the checkout is for the yearly product, this user's Dodo customer, and returns to ProdLi",
    checkoutCall?.auth === "Bearer dodo_e2e_key" && checkoutCall.body.product_cart[0].product_id === "pdt_year" && checkoutCall.body.customer.customer_id === "cus_e2e" && checkoutCall.body.metadata.userId === me.user.id && checkoutCall.body.return_url === `${SERVER}/pro/done?from=checkout`,
    JSON.stringify(checkoutCall?.body),
  );
  if (opened) await b.send("Target.closeTarget", { targetId: opened.targetId });
  const webhook = async (type, status, at) => {
    const raw = JSON.stringify({ business_id: "bus_e2e", type, timestamp: at, data: { payload_type: "Subscription", subscription_id: "sub_e2e", status, customer: { customer_id: "cus_e2e" }, metadata: {}, product_id: "pdt_year", payment_frequency_interval: "Year", next_billing_date: "2099-01-01T00:00:00.000Z", cancel_at_next_billing_date: false } });
    const id = `msg_${type}_${status}`;
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", Buffer.from(DODO_SECRET.slice(6), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
    return (await fetch(`${SERVER}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` }, body: raw })).json();
  };
  const reopen = async () => {
    await p.eval(`document.querySelector('[aria-label="Close"]')?.click()`);
    await sleep(300);
    await openAccount(p, "plan");
    await sleep(1200);
    return p.text();
  };
  check("Pro: Dodo's signed webhook is accepted", (await webhook("subscription.active", "active", new Date().toISOString())).applied === true);
  await sleep(4000); // the open account window checks every 3 s
  t = await p.text();
  check("Pro: the open account window notices the payment", /you're on prodli pro/i.test(t), t.slice(0, 600).replace(/\n/g, " | "));
  t = await reopen();
  check("Pro: the account is Pro, with its renewal date", /prodli pro/i.test(t) && /renews/i.test(t) && /300 meeting summaries/i.test(t), t.slice(0, 600).replace(/\n/g, " | "));
  const unsigned = await fetch(`${SERVER}/api/billing/webhook`, { method: "POST", body: "{}" });
  check("Pro: unsigned webhooks are refused", unsigned.status === 401);
  await webhook("subscription.cancelled", "cancelled", new Date(Date.now() + 1000).toISOString());
  t = await reopen();
  check("Pro: cancelling returns the account to Free", /your plan: free/i.test(t), t.slice(0, 300).replace(/\n/g, " | "));

  await openAccount(p, "account");
  await sleep(800);
  await p.click("Delete account…");
  await sleep(200);
  check("Delete needs the email typed first", await p.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Delete permanently")).disabled`));
  await p.eval(setInput('input[aria-label="Type your email to confirm"]', "alice@example.com"));
  await sleep(200);
  await p.click("Delete permanently");
  await sleep(1500);
  t = await p.text();
  check("Extension: deletes the account", t.includes("Your ProdLi account was deleted") && t.includes("Sign in to your ProdLi account"), t.slice(0, 300));
  const { prodliSession: gone, prodliAccount } = await p.storage(["prodliSession", "prodliAccount"]);
  check("…and forgets it on this device", !gone && !prodliAccount);

  const errors = b.jsErrors().filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_NETWORK_CHANGED/.test(JSON.stringify(e)));
  for (const e of errors) console.log("   JS error:", e.params.exceptionDetails?.exception?.description?.slice(0, 600) ?? JSON.stringify(e.params.args ?? e.params).slice(0, 600));
  check("No JavaScript errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)).slice(0, 400));
} finally {
  b.close();
  stopServer();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
