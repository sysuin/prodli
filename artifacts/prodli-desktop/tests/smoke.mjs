#!/usr/bin/env node
// Smoke test of a PACKAGED app (what users install): it starts, shows ProdLi
// from app://prodli, the bridge works, data is saved, nothing errors.
//
//   node tests/smoke.mjs release/mac-universal/ProdLi.app/Contents/MacOS/ProdLi
//   node tests/smoke.mjs release/win-unpacked/ProdLi.exe
//   xvfb-run node tests/smoke.mjs release/linux-unpacked/prodli-desktop
//
// Uses a throwaway data folder; never touches your real ProdLi data.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const exe = path.resolve(process.argv[2] ?? "");
if (!existsSync(exe)) {
  console.error(`No app at ${exe}`);
  process.exit(2);
}
const PORT = 9341;
const data = mkdtempSync(path.join(tmpdir(), "prodli-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
const app = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${data}`, ...extra], { stdio: ["ignore", "inherit", "inherit"] });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

async function page() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((x) => x.type === "page" && x.url.startsWith("app://prodli/"));
      if (p) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error("No ProdLi window appeared within 60 s");
}

try {
  const p = await page();
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) (waiting.get(d.id)(d), waiting.delete(d.id));
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? "exception");
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.reload");
  await sleep(1000);
  const ready = await evaluate(`new Promise((r) => { let n = 0; const t = setInterval(() => { if (document.querySelector(".side-btn") || ++n > 150) { clearInterval(t); r(!!document.querySelector(".side-btn")); } }, 100); })`);
  check("ProdLi opens (sidebar rendered)", ready === true);
  const info = await evaluate(`({ origin: location.origin, platform: window.prodliDesktop?.platform, version: window.prodliDesktop?.version, node: typeof require !== "undefined" || typeof process !== "undefined" })`);
  check("served from app://prodli", info?.origin === "app://prodli", JSON.stringify(info));
  check("bridge present, no Node in the page", !!info?.platform && !!info?.version && info.node === false, JSON.stringify(info));
  await evaluate(`window.prodliDesktop.storage.set("smoke", { at: 1 })`);
  check("storage round-trip", (await evaluate(`window.prodliDesktop.storage.get("smoke")`))?.at === 1);
  await sleep(800);
  const store = path.join(data, "ProdLi Data", "store.json");
  check("data saved to disk", existsSync(store) && readFileSync(store, "utf8").includes('"smoke"'));
  for (const section of ["today", "review", "todos", "habits", "editor", "meetings", "files", "pomodoro", "tracker"]) {
    await evaluate(`window.dispatchEvent(new CustomEvent("prodli-go", { detail: { section: "${section}" } }))`);
    await sleep(700);
  }
  const csp = errors.filter((e) => /Content Security Policy|Refused to/i.test(e));
  // This tests the package, not the server: reaching ProdLi's API (offline CI,
  // or a server without this app's origin yet) is checked by tests/e2e.mjs.
  const appErrors = errors.filter((e) => !/CORS policy|Failed to load resource|net::ERR_|\/api\//.test(e));
  check("no errors while opening sections", appErrors.length === 0, appErrors.slice(0, 3).join(" | "));
  check("no Content Security Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
  ws.close();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  app.kill();
  await sleep(1000);
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ Packaged app smoke test passed");
process.exit(failures ? 1 : 0);
