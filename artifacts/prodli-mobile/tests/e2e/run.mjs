#!/usr/bin/env node
// Browser tests for the phone app: builds its web version (the same screens and
// logic as iOS/Android, minus native-only parts) against a local stand-in
// server, then drives it at phone size in headless Chrome.
//
//   pnpm --filter @workspace/prodli-mobile run test:e2e
//   E2E_SKIP_BUILD=1 …   reuse the last build in dist-web
//   E2E_SHOTS=dir …      save a screenshot after each check
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, sleep } from "./cdp.mjs";
import { pushFromOtherDevice, startServer } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "../..");
const PORT = 8799;
const DIST = path.join(pkg, "dist-web");

if (!process.env.E2E_SKIP_BUILD || !existsSync(DIST)) {
  console.log("Building the web version…");
  execFileSync("pnpm", ["exec", "expo", "export", "--platform", "web", "--output-dir", "dist-web"], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1", PRODLI_API: `http://localhost:${PORT}` } });
}

const server = await startServer({ root: DIST, port: PORT });
const browser = new Browser();
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let passed = 0;
const failures = [];
let page;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err.message.split("\n")[0]}`);
  }
  if (shots && page) await page.shot(path.join(shots, `${String(passed + failures.length).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`)).catch(() => {});
}
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const go = (route) => page.navigate(`${server.url}${route}`);

try {
  page = await browser.openPage(server.url);

  await check("first launch shows the welcome, then Today", async () => {
    await page.waitForText("Welcome to ProdLi");
    await page.tap("Start without an account");
    await page.waitForText("Today's focus");
  });

  await check("smart add on Today: date, time, priority, label", async () => {
    await page.type("Add a to-do", "Call Sam today 3pm !high @calls", { enter: true });
    await page.waitForText("Call Sam");
    const text = await page.text();
    assert(/Today .*15:00|Today .*3:00/i.test(text) && text.includes("@calls"), "parsed details not shown");
  });

  await check("a repeating to-do moves to its next date and leaves a done copy", async () => {
    await page.type("Add a to-do", "Water plants every day", { enter: true });
    await page.waitForText("Water plants");
    await page.tap("Mark done: Water plants");
    await page.waitForText("1 done today");
    assert(!(await page.text()).includes("Water plants"), "still listed for today");
  });

  await check("to-dos: Upcoming, Board and Matrix", async () => {
    await go("/todos");
    await page.tap("📅 Upcoming");
    await page.waitForText("Water plants");
    await page.tap("▥ Board");
    await page.waitForText("No date");
    await page.tap("⊞ Matrix");
    await page.waitForText("Do first");
    const t = await page.text();
    assert(t.indexOf("Do first") < t.indexOf("Call Sam"), "high-priority task for today isn't under Do first");
    await page.tap("☰ List");
  });

  await check("lists: a new list from the To-dos tab", async () => {
    await page.tap("+ List");
    await page.type("New list name", "Work", { enter: true });
    await page.waitForText("# Work");
  });

  await check("habits: add one and check it off", async () => {
    await go("/habit/edit");
    await page.type("Drink water", "Read");
    await page.tap("Add habit");
    await go("/habits");
    await page.waitForText("Read");
    await page.tap("Read done today");
    await page.waitForText("1 of 1 done today");
  });

  await check("notes: today's daily note with the day's to-dos", async () => {
    await go("/notes");
    await page.tap("📅 Today's note");
    await page.waitForText("Main focus");
    assert((await page.text()).includes("Call Sam"), "planned to-do missing from the daily note");
  });

  await check("search finds to-dos and notes", async () => {
    await go("/search");
    await page.type("Search notes", "sam");
    await page.waitForText("Daily note");
    assert((await page.text()).includes("Call Sam"), "to-do not found");
  });

  await check("Pomodoro starts and pauses", async () => {
    await go("/pomodoro");
    await page.tap("Start");
    await page.waitForText("Pause");
    await sleep(1600); // let a second or two run, so pausing leaves time to resume
    await page.tap("Pause");
    await page.waitForText("Resume");
  });

  await check("weekly review without an account (basic)", async () => {
    await go("/review");
    await page.tap("Write my weekly review");
    await page.waitForText("Basic review (no AI)");
  });

  await check("sign in (developer) and sync both ways", async () => {
    await go("/account");
    await page.tap("Developer sign-in");
    await page.waitForText("Synced");
    await page.waitFor(() => [...server.state.items.values()].some((i) => i.c === "todos" && i.v?.title === "Call Sam"), "the phone's to-do on the server");
    const now = new Date().toISOString();
    pushFromOtherDevice(server.state, [{ c: "notes", id: "laptop-note", u: now, v: { id: "laptop-note", title: "From the laptop", content: "<p>Hello from the extension</p>", createdAt: now, updatedAt: now } }]);
    await page.tap("Sync now");
    await go("/notes");
    await page.waitForText("From the laptop");
  });

  await check("AI daily brief with the account", async () => {
    await go("/");
    await page.tap("Write my brief");
    await page.waitForText("Ship the beta, then protect your afternoon");
    assert((await page.text()).includes("Written by ProdLi AI"), "not marked as AI");
  });

  await check("Ask ProdLi answers and offers an action", async () => {
    await go("/ask");
    await page.type("Ask anything", "What should I do next?", { enter: true });
    await page.waitForText("Start with “");
    await page.tap("Add to-do: Send beta invites");
    await page.waitForText("Done: Add to-do: Send beta invites");
  });

  await check("account: devices and this month's AI", async () => {
    await go("/account");
    await page.waitForText("Chrome on macOS");
    assert((await page.text()).includes("Transcription: 10 of 300 minutes"), "transcription minutes missing");
  });

  await check("no uncaught errors", async () => {
    const errs = browser.jsErrors();
    assert(!errs.length, errs.join("\n"));
  });
} finally {
  await sleep(100);
  browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
