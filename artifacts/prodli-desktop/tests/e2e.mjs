#!/usr/bin/env node
// End-to-end test of the desktop app with the REAL server code:
//   - prodli-api running locally (wrangler dev, fresh local D1, fake Google)
//   - the desktop app (development build pointed at it), driven over the
//     Chrome DevTools protocol
// The test plays the browser's part of sign-in: it signs in on the "web"
// with the server's development-only Google stand-in, asks for the one-time
// code, and calls the app's loopback listener, exactly as app.prodli.com would.
//
//   pnpm --filter @workspace/prodli-desktop run test:e2e
// Needs a display (macOS / Windows desktop, or xvfb-run on Linux).

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const api = path.resolve(pkg, "../prodli-api");
const PORT = 8789;
const SERVER = `http://localhost:${PORT}`;
const DEBUG_PORT = 9339;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

console.log("==> Building the desktop app (development build → local server)");
run("node scripts/build.mjs", pkg, { PRODLI_API: SERVER, PRODLI_DEV: "1" });

console.log("==> Starting the server with a fresh local database");
const state = mkdtempSync(path.join(tmpdir(), "prodli-desktop-e2e-api-"));
const userData = mkdtempSync(path.join(tmpdir(), "prodli-desktop-e2e-data-"));
const urlFile = path.join(userData, "signin-url.txt");
const trayFile = path.join(userData, "tray.json");
run(`pnpm exec wrangler d1 migrations apply DB --local --persist-to "${state}"`, api, { CI: "true" });
const server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", state, "--var", "DEV_FAKE_GOOGLE:true", "--log-level", "warn"], {
  cwd: api,
  detached: process.platform !== "win32",
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, CI: "true" },
});
let app = null;
const cleanup = () => {
  try {
    app?.kill();
  } catch {}
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /t /f`, { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch {}
  rmSync(state, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
};
process.on("exit", cleanup);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${SERVER}/api/health`)).ok) break;
  } catch {}
  if (i > 120) throw new Error("Server didn't start");
  await sleep(500);
}

// ── A tiny DevTools client ───────────────────────────────────────────────────
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((p) => p.type === "page" && p.url.startsWith("app://prodli/"));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && waiting.has(d.id)) (waiting.get(d.id)(d), waiting.delete(d.id));
        };
        const send = (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
        return {
          eval: async (expression) => {
            const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluation failed");
            return r.result?.result?.value;
          },
          close: () => ws.close(),
        };
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("The app's window didn't appear");
}

const electron = path.join(pkg, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const launch = () =>
  // Fake microphone (a tone) instead of a real one; no permission prompts (see main/media.ts).
  spawn(electron, [".", `--remote-debugging-port=${DEBUG_PORT}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...(process.platform === "linux" ? ["--no-sandbox"] : [])], {
    cwd: pkg,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PRODLI_USER_DATA: userData, PRODLI_E2E_URL_FILE: urlFile, PRODLI_E2E_TRAY_FILE: trayFile },
    shell: process.platform === "win32",
  });

try {
  console.log("desktop app");
  app = launch();
  let page = await connect();
  await page.eval(`new Promise((r) => { const t = setInterval(() => document.querySelector(".side-btn") && (clearInterval(t), r(true)), 100); })`);
  check("opens ProdLi from app://prodli with the bridge", (await page.eval(`location.origin === "app://prodli" && typeof window.prodliDesktop?.storage?.get === "function"`)) === true);
  check("the page has no Node or Electron", (await page.eval(`typeof require === "undefined" && typeof process === "undefined"`)) === true);

  await page.eval(`window.prodliDesktop.storage.set("e2eProbe", { n: 1 })`);
  check("saves to the app's data file", existsSync(path.join(userData, "ProdLi Data", "store.json")) || (await sleep(500), existsSync(path.join(userData, "ProdLi Data", "store.json"))));

  // The menu bar timer (main/menuBar.ts) reads the store: a running focus session and the time block that's on.
  console.log("menu bar timer");
  const tray = async (ok) => {
    let t = null;
    for (let i = 0; i < 30; i++) {
      try { t = JSON.parse(readFileSync(trayFile, "utf8")); } catch { t = null; }
      if (t && ok(t)) return t;
      await sleep(200);
    }
    return t;
  };
  await page.eval(`(() => { const d = new Date(Date.now() - 5 * 60_000); const p2 = (n) => String(n).padStart(2, "0"); const day = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); return Promise.all([
    window.prodliDesktop.storage.set("todos", [{ id: "mb1", title: "Write the proposal", completed: false, estimateMin: 60, block: { day, start: p2(d.getHours()) + ":" + p2(d.getMinutes()) }, createdAt: new Date().toISOString() }, { id: "mb2", title: "Call the bank", completed: false, plannedFor: day, createdAt: new Date().toISOString() }]),
    window.prodliDesktop.storage.set("pomodoroTimer", { phase: "work", running: true, endsAt: Date.now() + 20 * 60_000, remaining: 0, label: "", lastCompletedAt: null, lastCompletedPhase: null }),
  ]).then(() => true); })()`);
  let t = await tray((x) => /^🍅 (19|20):\d\d$/.test(x.title) && x.menu.includes("Pause"));
  check("menu bar shows the focus countdown", /^🍅 (19|20):\d\d$/.test(t?.title ?? ""), JSON.stringify(t));
  check("tray menu: the session with Pause and Stop, the block that's on and the top task", !!t && t.menu.includes("Pause") && t.menu.includes("Stop") && t.menu.some((l) => l.startsWith("Now: Write the proposal (until ")) && t.menu.includes("Top task: Call the bank"), JSON.stringify(t?.menu));
  check("keeps the computer awake during the focus session", !!t && t.menu.includes("Staying awake during your focus session"), JSON.stringify(t?.menu));
  const before = t?.title;
  t = await tray((x) => x.title !== before);
  check("the countdown ticks", !!t && t.title !== before, `${before} → ${t?.title}`);
  await page.eval(`window.prodliDesktop.storage.set("pomodoroTimer", { phase: "work", running: false, endsAt: null, remaining: 600, label: "", lastCompletedAt: null, lastCompletedPhase: null })`);
  t = await tray((x) => x.menu.includes("Resume"));
  check("a paused session shows ⏸ and Resume, and no longer keeps the computer awake", t?.title === "⏸ 10:00" && t.menu.includes("Resume") && !t.menu.includes("Staying awake during your focus session"), JSON.stringify(t));
  await page.eval(`Promise.all([window.prodliDesktop.storage.remove("pomodoroTimer"), window.prodliDesktop.storage.set("todos", [])]).then(() => true)`);
  t = await tray((x) => x.title === "" && x.menu[0] === "Start a Focus Session (25 min)");
  check("with nothing on, just the icon and Start a Focus Session", t?.title === "" && t.menu[0] === "Start a Focus Session (25 min)", JSON.stringify(t));

  // Chromium's fake devices give a tone for the microphone, and its fake capture
  // UI hands getDisplayMedia a fake screen with a fake audio track: so this runs
  // the full "computer's sound + microphone" mix.
  console.log("record a call (fake microphone + fake computer sound)");
  await page.eval(`window.dispatchEvent(new CustomEvent("prodli-go", { detail: { section: "meetings" } })); new Promise((r) => { const t = setInterval(() => document.querySelector("[data-testid=record-call]") && (clearInterval(t), r(true)), 100); })`);
  await page.eval(`document.querySelector("[data-testid=record-call]").click(); true`);
  const recording = await page.eval(`new Promise((r) => { let n = 0; const t = setInterval(() => { const bar = document.querySelector("[data-testid=in-person-bar]"); if (bar || ++n > 100) { clearInterval(t); r(bar?.innerText ?? null); } }, 100); })`);
  check("Record a call starts (recording bar)", /Recording a call/.test(recording ?? ""), String(recording));
  const recTray = await tray((x) => x.menu.includes("Staying awake while recording"));
  check("keeps the computer awake while recording", !!recTray?.menu.includes("Staying awake while recording"), JSON.stringify(recTray?.menu));
  await sleep(11_500); // more than one 10-second audio chunk
  await page.eval(`[...document.querySelectorAll("[data-testid=in-person-bar] button")].find((b) => /Stop/.test(b.textContent)).click(); true`);
  const meeting = await page.eval(`new Promise((resolve) => {
    let n = 0;
    const look = () => {
      const req = indexedDB.open("prodli-meetings");
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction("meetings").objectStore("meetings").getAll();
        all.onsuccess = () => {
          const m = all.result.find((x) => x.platform === "desktop");
          db.close();
          if (m && m.status === "ready") resolve({ title: m.title, hasAudio: m.hasAudio, durationSec: m.durationSec, notice: m.notice, mime: m.audioMimeType });
          else if (++n > 60) resolve(m ?? null);
          else setTimeout(look, 250);
        };
      };
    };
    look();
  })`);
  check("saved as a desktop call with its audio", meeting?.hasAudio === true && /^Call · /.test(meeting.title) && meeting.durationSec >= 10, JSON.stringify(meeting));
  check("recorded the computer's sound too (no microphone-only warning)", !!meeting && !/Only your microphone/.test(meeting.notice ?? ""), JSON.stringify(meeting?.notice));
  const recState = await page.eval(`!document.querySelector("[data-testid=in-person-bar]")`);
  check("recording bar gone after stopping", recState === true);

  console.log("sign in through the browser");
  await page.eval(`window.__signIn = window.prodliDesktop.account.signIn(); true`);
  for (let i = 0; i < 40 && !existsSync(urlFile); i++) await sleep(250);
  const signInUrl = new URL(readFileSync(urlFile, "utf8"));
  check("opens app.prodli.com's hand-off page", signInUrl.origin === SERVER && signInUrl.searchParams.get("desktop") === "signin");
  const port = signInUrl.searchParams.get("port");
  const handoffState = signInUrl.searchParams.get("state");
  const challenge = signInUrl.searchParams.get("challenge");

  // The web page's part: sign in (fake Google), then ask for a code.
  const web = await fetch(`${SERVER}/api/auth/google`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SERVER }, body: JSON.stringify({ kind: "web", idToken: "good:dee:dee@example.com:Dee Desk" }) });
  const cookie = (web.headers.get("set-cookie") ?? "").split(";")[0];
  check("web sign-in", web.ok && cookie.startsWith("__Host-prodli_session="), String(web.status));
  const codeRes = await fetch(`${SERVER}/api/auth/desktop/code`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SERVER, Cookie: cookie }, body: JSON.stringify({ challenge }) });
  const { code } = await codeRes.json();
  check("one-time code", codeRes.ok && /^pldc_/.test(code ?? ""), String(codeRes.status));

  const stray = await fetch(`http://127.0.0.1:${port}/callback?code=${code}&state=not-the-state`);
  check("a callback with the wrong state is refused", stray.status === 400);
  const back = await fetch(`http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(handoffState)}`);
  check("the loopback callback finishes sign-in", back.ok && (await back.text()).includes("signed in"), String(back.status));
  const result = await page.eval(`window.__signIn`);
  check("signIn() resolves ok", result?.ok === true, JSON.stringify(result));
  const account = await page.eval(`window.prodliDesktop.storage.get("prodliAccount")`);
  check("the page sees the account", account?.email === "dee@example.com", JSON.stringify(account));

  // The page calls the API itself from app://prodli (CORS) with its bearer token.
  const me = await page.eval(`(async () => { const s = await window.prodliDesktop.storage.get("prodliSession"); const r = await fetch(${JSON.stringify(SERVER)} + "/api/me", { headers: { Authorization: "Bearer " + s.token }, credentials: "omit" }); return { status: r.status, body: await r.json() }; })()`);
  check("API calls from the app work (CORS + bearer)", me?.status === 200 && me.body?.session?.client === "desktop", JSON.stringify(me));

  // Sync starts on its own (the app's sync engine, leader in this window).
  let synced = null;
  for (let i = 0; i < 40 && !synced?.lastSyncAt; i++) {
    await sleep(500);
    synced = await page.eval(`window.prodliDesktop.storage.get("prodliSyncStatus")`);
  }
  check("syncs with the account", !!synced?.lastSyncAt, JSON.stringify(synced));

  console.log("on disk");
  page.close();
  app.kill();
  await new Promise((r) => app.on("exit", r));
  app = null;
  const raw = readFileSync(path.join(userData, "ProdLi Data", "store.json"), "utf8");
  check("the session token is encrypted at rest", raw.includes("__prodliEncrypted") && !/pls_[A-Za-z0-9_-]{20}/.test(raw));
  check("notes and the account are in the data file", raw.includes('"e2eProbe"') && raw.includes("dee@example.com"));

  console.log("relaunch");
  app = launch();
  page = await connect();
  await page.eval(`new Promise((r) => { const t = setInterval(() => window.prodliDesktop && (clearInterval(t), r(true)), 100); })`);
  const again = await page.eval(`window.prodliDesktop.storage.get("prodliSession").then((s) => !!s?.token)`);
  check("stays signed in after a restart (token decrypted)", again === true);
  page.close();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  cleanup();
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ Desktop end-to-end passed");
process.exit(failures ? 1 : 0);
