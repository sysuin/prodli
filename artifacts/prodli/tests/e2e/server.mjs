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
const server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", state, "--var", "DEV_FAKE_GOOGLE:true", "--log-level", "warn"], {
  cwd: api,
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, CI: "true" },
});
const stopServer = () => {
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
const openAccount = (p) => p.eval(`[...document.querySelectorAll("nav button")].find(b => (b.getAttribute("aria-label") || "").startsWith("Sign in") || (b.getAttribute("aria-label") || "").startsWith("Account")).click()`);

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
  check("Extension: lists this device", t.toLowerCase().includes("signed-in devices") && /Extension · .* ?\(this one\)/.test(t), t.slice(0, 400).replace(/\n/g, " | "));
  const { prodliSession } = await p.storage(["prodliSession"]);
  check("Extension: keeps a session token (not the Google token)", typeof prodliSession?.token === "string" && prodliSession.token.startsWith("pls_"));
  check("Extension: avatar button shows the account", await p.eval(`!!document.querySelector('nav button[aria-label="Account: alice@example.com"]')`));

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

  await openAccount(w);
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

  console.log("delete account");
  await p.send("Page.reload", {});
  await sleep(1800);
  await p.eval(fakeChromeGoogle);
  await openAccount(p);
  await sleep(1000);
  check("Extension: shows signed out after a remote sign-out", (await p.text()).includes("Sign in to your ProdLi account"));
  await p.click("Sign in with Google", { exact: false });
  await sleep(1500);
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

  const errors = b.jsErrors().filter((e) => !JSON.stringify(e).includes("Failed to load resource"));
  for (const e of errors) console.log("   JS error:", e.params.exceptionDetails?.exception?.description?.slice(0, 600) ?? JSON.stringify(e.params.args ?? e.params).slice(0, 600));
  check("No JavaScript errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)).slice(0, 400));
} finally {
  b.close();
  stopServer();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
