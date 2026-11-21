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
  spawn(electron, [".", `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: pkg,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PRODLI_USER_DATA: userData, PRODLI_E2E_URL_FILE: urlFile },
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
