// End-to-end tests: loads the built extension (dist-extension) into a throwaway
// headless Chrome profile over the DevTools protocol and drives the real UI.
//
//   pnpm test:e2e            (builds first)
//   CHROME_PATH=/path/to/chrome node tests/e2e/run.mjs
//
// Needs Google Chrome (or Chromium) 126+ for Extensions.loadUnpacked.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../../dist-extension");
const FIXTURES = path.join(here, "fixtures");
const CHROME =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const only = process.argv[2]; // optional suite name filter

if (!CHROME) throw new Error("Chrome not found — set CHROME_PATH.");
if (!existsSync(path.join(EXT, "manifest.json"))) throw new Error("dist-extension missing — run pnpm build:extension first.");

// ── Minimal CDP client over --remote-debugging-pipe ───────────────────────────

class Browser {
  constructor() {
    this.profile = mkdtempSync(path.join(tmpdir(), "prodli-e2e-"));
    this.downloads = mkdtempSync(path.join(tmpdir(), "prodli-dl-"));
    this.proc = spawn(
      CHROME,
      ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${this.profile}`, "--no-first-run", "--no-default-browser-check", ...(process.env.CI ? ["--no-sandbox"] : []), "about:blank"],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    let buf = "";
    this.proc.stdio[4].on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
        } else if (msg.method) this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  async loadExtension() {
    const { id } = await this.send("Extensions.loadUnpacked", { path: EXT });
    this.extId = id;
    await this.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: this.downloads, eventsEnabled: true });
    await sleep(1000);
    return id;
  }
  async openPage(url = `chrome-extension://${this.extId}/index.html`) {
    const { targetId } = await this.send("Target.createTarget", { url });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Runtime.enable", {}, sessionId);
    await this.send("Page.enable", {}, sessionId);
    await this.send("DOM.enable", {}, sessionId);
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(1200);
    return new Page(this, sessionId, targetId);
  }
  async serviceWorker() {
    const { targetInfos } = await this.send("Target.getTargets");
    const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(this.extId));
    if (!sw) return null;
    const { sessionId } = await this.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
    await this.send("Runtime.enable", {}, sessionId);
    return new Page(this, sessionId, sw.targetId);
  }
  jsErrors() {
    return this.events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"));
  }
  close() {
    this.proc.kill();
    try {
      rmSync(this.profile, { recursive: true, force: true });
      rmSync(this.downloads, { recursive: true, force: true });
    } catch {}
  }
}

class Page {
  constructor(browser, sessionId, targetId) {
    Object.assign(this, { browser, sessionId, targetId });
  }
  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  text() {
    return this.eval("document.body.innerText");
  }
  async lowerText() {
    return (await this.text()).toLowerCase();
  }
  click(label, { exact = true } = {}) {
    return this.eval(`(() => {
      const want = ${JSON.stringify(label.toLowerCase())};
      const b = [...document.querySelectorAll("button")].find(b => { const t = b.textContent.trim().toLowerCase(); return ${exact} ? t === want : t.includes(want); });
      if (!b) throw new Error("No button: " + want);
      b.click(); return true;
    })()`);
  }
  async goto(section) {
    await this.eval(`chrome.storage.local.set({ lastSection: ${JSON.stringify(section)}, hasSeenOnboarding: true })`);
    await this.send("Page.reload", {});
    await sleep(1800);
  }
  async setFile(selector, fileName) {
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`No element ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId, files: [path.join(FIXTURES, fileName)] });
    await sleep(700);
  }
  storage(keys) {
    return this.eval(`chrome.storage.local.get(${JSON.stringify(keys)})`);
  }
  close() {
    return this.browser.send("Target.closeTarget", { targetId: this.targetId });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDownload(browser, prefix, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const f = readdirSync(browser.downloads).find((n) => n.startsWith(prefix) && !n.endsWith(".crdownload"));
    if (f) return readFileSync(path.join(browser.downloads, f), "utf8");
    await sleep(200);
  }
  throw new Error(`No download starting with ${prefix}`);
}

// ── Suites ────────────────────────────────────────────────────────────────────

const suites = {
  async smoke(b, check) {
    // Every tab opens with its keyboard shortcut and renders without errors.
    const p = await b.openPage();
    await p.goto("editor");
    const tabs = ["Editor", "To-Dos", "Pomodoro", "Habits", "Tracker", "Meetings", "Files"];
    const headings = ["words", "to-do list", "pomodoro", "habit", "time tracker", "meetings", "files"];
    for (let i = 0; i < tabs.length; i++) {
      await p.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "${i + 1}", ctrlKey: true, bubbles: true }))`);
      await sleep(900);
      const t = await p.lowerText();
      check(`Smoke: Ctrl+${i + 1} opens ${tabs[i]}`, t.includes(headings[i]), t.slice(0, 120));
    }
    // To-Dos: add a task with priority-less input + Enter, then complete it.
    await p.goto("todos");
    await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "E2E task"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(100);
    await p.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
    await sleep(500);
    const { todos = [] } = await p.storage(["todos"]);
    check("Smoke: To-Dos adds a task", todos.some((t) => t.title === "E2E task"));
    // Habits: the page renders its create button.
    await p.goto("habits");
    check("Smoke: Habits renders", (await p.lowerText()).includes("new habit"));
    // Help panel lists the new sections.
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.title === "Help & shortcuts").click()`);
    await sleep(400);
    const help = await p.lowerText();
    check("Smoke: Help covers Meetings, Files and Ctrl+7", help.includes("meetings") && help.includes("save to notes") && help.includes("switch to files"));
    await p.close();
  },

  async extension(b, check) {
    check("Extension loads (manifest valid)", !!b.extId);
    const sw = await b.serviceWorker();
    check("Background service worker running", !!sw);
    const cmds = await sw.eval("chrome.commands.getAll().then(c => c.map(x => x.name))");
    check("Recording shortcut registered", cmds.includes("toggle-recording"));
    const perms = await sw.eval("chrome.permissions.getAll()");
    check("Recorder permissions are optional (not granted on install)", !perms.permissions.includes("tabCapture"));
  },

  async meetings(b, check) {
    const p = await b.openPage();
    await p.goto("meetings");
    const t = await p.lowerText();
    check("Meetings: setup panel on first run", t.includes("claude api key") && t.includes("turn on recorder"));
    check("Meetings: empty state", t.includes("no meetings yet"));
    await p.eval(`new Promise((resolve, reject) => {
      const req = indexedDB.open("prodli-meetings", 1);
      req.onsuccess = () => {
        const tx = req.result.transaction("meetings", "readwrite");
        const now = new Date();
        tx.objectStore("meetings").put({
          id: "mtg_e2e", platform: "google-meet", title: "Google Meet · abc-defg-hij", meetingCode: "abc-defg-hij",
          url: "https://meet.google.com/abc-defg-hij", startedAt: new Date(now - 1800e3).toISOString(), endedAt: now.toISOString(),
          durationSec: 1800, status: "ready", error: null, notice: null, hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: now.toISOString(),
          transcript: [{ id: "1", speaker: "You", text: "Ship Friday.", startMs: 5000, endMs: 8000 }],
          summary: { title: "Beta launch planning", overview: "Ship on Friday.", keyPoints: ["Scope frozen"], decisions: ["Ship Friday"],
            actionItems: [{ task: "Finish onboarding emails", owner: "Priya Shah", dueDate: "2026-11-12", priority: "high" }, { task: "Prepare release notes", owner: null, dueDate: null, priority: "medium" }],
            openQuestions: [], model: "claude-haiku-5-5", generatedAt: now.toISOString() },
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
    })`);
    await sleep(3600);
    check("Meetings: meeting shows with summary", (await p.text()).includes("Beta launch planning"));
    await p.click("Add all to To-Dos");
    await sleep(600);
    await p.click("Add all to To-Dos");
    await sleep(600);
    const { todos = [] } = await p.storage(["todos"]);
    const emails = todos.filter((t) => t.title === "Finish onboarding emails (Priya Shah)");
    const notesTask = todos.filter((t) => t.title === "Prepare release notes");
    check("Meetings: action items → To-Dos (no duplicates)", emails.length === 1 && notesTask.length === 1 && emails[0].dueDate === "2026-11-12" && emails[0].priority === "high");
    await p.click("Save as note");
    await sleep(500);
    const { notes = [] } = await p.storage(["notes"]);
    check("Meetings: summary saved as note", notes[0]?.title === "Beta launch planning" && notes[0].content.includes("Action items"));
    check("Meetings: Summarize disabled without API key", await p.eval(`[...document.querySelectorAll("button")].find(b => /summarize/i.test(b.textContent)).disabled`));
    await p.close();
  },

  async files(b, check) {
    const p = await b.openPage();
    await p.goto("files");
    check("Files: drop zone", (await p.lowerText()).includes("drop a file anywhere"));
    await p.setFile('input[type="file"]', "sample.md");
    const md = await p.eval(`(() => { const el = document.querySelector(".md-preview"); return { h1: el?.querySelector("h1")?.textContent, table: !!el?.querySelector("table"), tasks: el?.querySelectorAll("input[type=checkbox]").length, html: el?.innerHTML ?? "", jsLinks: [...(el?.querySelectorAll("a") ?? [])].some(a => (a.getAttribute("href") || "").startsWith("javascript")) }; })()`);
    check("Files: Markdown renders", md.h1 === "Project Plan" && md.table && md.tasks === 2);
    check("Files: Markdown is sanitized", !/<script|onerror/i.test(md.html) && !md.jsLinks && (await p.eval("window.__xss === undefined")));
    await p.click("Save to Notes");
    await sleep(500);
    const { notes = [] } = await p.storage(["notes"]);
    check("Files: Save to Notes", notes[0]?.title === "sample" && notes[0].content.includes("<h1>Project Plan</h1>"));
    await p.setFile('input[type="file"]', "data.json");
    await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Search keys"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "haiku"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(300);
    const jt = await p.text();
    check("Files: JSON tree search", jt.includes("claude-haiku-5-5") && !jt.includes("item 3"));
    await p.setFile('input[type="file"]', "bad.json");
    check("Files: invalid JSON location", /problem near line 4, column 1/.test(await p.text()));
    await p.setFile('input[type="file"]', "people.csv");
    const rows = await p.eval(`[...document.querySelectorAll("table tr")].map(r => [...r.children].map(c => c.textContent))`);
    check("Files: CSV with quoted fields", rows[1]?.[1] === "Shah, Priya" && rows[1]?.[3] === 'Says "hi"\nsecond line');
    await p.setFile('input[type="file"]', "blob.bin");
    check("Files: binary rejected", (await p.text()).includes("looks like a binary file"));
    // Drop onto another section
    await p.eval(`[...document.querySelectorAll("nav button")].find(b => b.textContent.includes("Editor")).click()`);
    await sleep(1000);
    const data = { items: [], files: [path.join(FIXTURES, "people.csv")], dragOperationsMask: 1 };
    await p.send("Input.dispatchDragEvent", { type: "dragEnter", x: 700, y: 500, data });
    await p.send("Input.dispatchDragEvent", { type: "dragOver", x: 700, y: 500, data });
    await sleep(200);
    check("Files: drag overlay", (await p.lowerText()).includes("drop to preview"));
    await p.send("Input.dispatchDragEvent", { type: "drop", x: 700, y: 500, data });
    await sleep(1200);
    const after = await p.eval(`({ url: location.href, t: document.body.innerText })`);
    check("Files: drop anywhere opens Files", after.url.endsWith("index.html") && after.t.includes("Shah, Priya"));
    await p.close();
  },

  async captions(b, check) {
    // Run the built captions script on a simulated Meet page (chrome.runtime stubbed).
    const script = readFileSync(path.join(EXT, "meet-captions.js"), "utf8");
    const p = await b.openPage("about:blank");
    await p.eval(`
      document.title = "Meet - Weekly product sync";
      document.body.innerHTML = '<button aria-label="Leave call">x</button><button aria-label="Turn on captions" aria-pressed="false">cc</button>';
      document.querySelector('[aria-label="Turn on captions"]').addEventListener('click', () => {
        const r = document.createElement('div'); r.setAttribute('role','region'); r.setAttribute('aria-label','Captions'); r.id='cap'; document.body.appendChild(r);
      });
      window.__sent = []; window.__listeners = [];
      window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); }, onMessage: { addListener: (f) => window.__listeners.push(f), removeListener: () => {} } } };
      window.__block = (s, t) => { const d = document.createElement('div'); d.innerHTML = '<img alt=""><div>' + s + '</div><div class="t">' + t + '</div>'; document.getElementById('cap').appendChild(d); return d; };
      true`);
    await p.eval(script + ";true");
    await p.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "start", meetingId: "m1", startedAtMs: Date.now() }, {}, r))`);
    await sleep(300);
    check("Captions: turned on automatically + badge shown", await p.eval(`!!document.getElementById('cap') && !!document.querySelector('[data-prodli-badge]')`));
    await p.eval(`window.__b1 = __block('You', 'Okay so'); true`);
    await sleep(1200);
    await p.eval(`__b1.querySelector('.t').textContent = 'Okay so the plan is to ship on Friday.'; true`);
    await sleep(1200);
    await p.eval(`window.__b2 = __block('Priya Shah', 'I will finish the onboarding emails'); true`);
    await sleep(1200);
    await p.eval(`__b1.remove(); __b2.querySelector('.t').textContent = 'I will finish the onboarding emails by Thursday.'; true`);
    await sleep(1200);
    await p.eval(`window.__b3 = __block('Alex Kim', 'We need to review the pricing page and the checkout flow'); true`);
    await sleep(1200);
    await p.eval(`__b3.querySelector('.t').textContent = 'the pricing page and the checkout flow before the launch next week'; true`);
    await sleep(3300);
    const updates = await p.eval(`window.__sent.filter(m => m.type === 'captions-update')`);
    check("Captions: updates sent with meeting title", updates.length >= 2 && updates.at(-1).title === "Weekly product sync");
    const res = await p.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "stop" }, {}, r))`);
    const lines = res.entries.map((e) => `${e.speaker}: ${e.text}`);
    check("Captions: transcript lines merged correctly", JSON.stringify(lines) === JSON.stringify([
      "You: Okay so the plan is to ship on Friday.",
      "Priya Shah: I will finish the onboarding emails by Thursday.",
      "Alex Kim: We need to review the pricing page and the checkout flow before the launch next week",
    ]), lines.join(" | "));
    await p.eval(script + ";true");
    await p.eval(`window.__sent = []; new Promise(r => window.__listeners.at(-1)({ target: "captions", type: "start", meetingId: "m2", startedAtMs: Date.now() }, {}, r))`);
    await sleep(1200);
    await p.eval(`document.querySelector('[aria-label="Leave call"]').remove(); true`);
    await sleep(7000);
    check("Captions: leaving the call ends recording", await p.eval(`window.__sent.some(m => m.type === 'captions-ended')`));
    await p.close();
  },

  async pomodoro(b, check) {
    const a = await b.openPage();
    await a.goto("pomodoro");
    const c = await b.openPage();
    await a.click("start", { exact: false });
    await sleep(1500);
    const titleA = await a.eval("document.title");
    const titleC = await c.eval("document.title");
    check("Pomodoro: timer runs and shows in tab title", titleA.startsWith("▶") && titleA.includes("FOCUS"), titleA);
    check("Pomodoro: other ProdLi tabs show the same running timer", titleC.startsWith("▶"), titleC);
    await c.close();
    await a.close();
    await sleep(1200);
    // Reopen: the timer should still be running (not reset by closing the tab).
    const d = await b.openPage();
    await sleep(500);
    check("Pomodoro: keeps running after closing all tabs", (await d.eval("document.title")).startsWith("▶"));
    // Make the phase end in 2 s, close every ProdLi tab, and let the background finish it.
    await d.eval(`chrome.storage.local.get("pomodoroTimer").then(({ pomodoroTimer: t }) => chrome.storage.local.set({ pomodoroTimer: { ...t, label: "E2E focus", endsAt: Date.now() + 2000 } }))`);
    await sleep(300);
    await d.close();
    await sleep(4500);
    const e = await b.openPage();
    const s = await e.storage(["pomodoroTimer", "pomodoroSessions", "completedPomodoros"]);
    check("Pomodoro: background finished the phase with no tab open", s.pomodoroTimer?.phase === "short-break" && s.pomodoroTimer?.running === false && s.completedPomodoros === 1, JSON.stringify({ phase: s.pomodoroTimer?.phase, running: s.pomodoroTimer?.running, completed: s.completedPomodoros }));
    check("Pomodoro: focus session logged with its label", s.pomodoroSessions?.[0]?.label === "E2E focus");
    const sw = await b.serviceWorker();
    const notes = await sw.eval("new Promise(r => chrome.notifications.getAll(n => r(Object.keys(n))))");
    check("Pomodoro: completion notification shown", notes.some((id) => id.startsWith("pomodoro_")), notes.join(","));
    await e.close();
  },

  async editor(b, check) {
    const p = await b.openPage();
    await p.goto("editor");
    await p.setFile('input[accept^=".md"]', "sample.md");
    await sleep(500);
    const { notes = [], activeNoteId } = await p.storage(["notes", "activeNoteId"]);
    check("Editor: import Markdown as a new note", notes[0]?.title === "sample" && notes[0].content.includes("<h1>Project Plan</h1>") && activeNoteId === notes[0].id && !/<script/i.test(notes[0].content));
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.title.startsWith("Export this note")).click()`);
    const md = await waitForDownload(b, "sample");
    check("Editor: export note as Markdown", md.startsWith("# Project Plan") && md.includes("**bold**") && md.includes("[safe link](https://example.com)"), md.slice(0, 80).replace(/\n/g, "⏎"));
    await p.close();
  },

  async backup(b, check) {
    const p = await b.openPage();
    await p.goto("editor");
    await p.eval(`chrome.storage.local.set({ "tt_2026-11-07": { "github.com": 120 }, claudeApiKey: "sk-ant-e2e-secret" })`);
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.title === "Backup & Restore").click()`);
    await sleep(400);
    await p.click("Export Data →");
    const json = JSON.parse(await waitForDownload(b, "prodli-backup-"));
    check("Backup: includes Time Tracker history", json.version === "1.1" && json.timeTracking?.["2026-11-07"]?.["github.com"] === 120);
    check("Backup: includes meetings, never the API key", Array.isArray(json.meetings) && !JSON.stringify(json).includes("sk-ant-e2e-secret"));
    await p.close();
  },
};

// ── Runner ────────────────────────────────────────────────────────────────────

const browser = new Browser();
let failures = 0;
try {
  await browser.loadExtension();
  for (const [name, suite] of Object.entries(suites)) {
    if (only && name !== only) continue;
    const check = (label, ok, detail = "") => {
      if (!ok) failures++;
      console.log(`${ok ? "  ✓" : "  ✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
    };
    console.log(name);
    try {
      await suite(browser, check);
    } catch (err) {
      failures++;
      console.log(`  ✗ ${name} crashed: ${err.message}`);
    }
  }
  const errors = browser.jsErrors();
  if (errors.length) {
    failures++;
    console.log(`✗ ${errors.length} JavaScript error(s):`, errors.map((e) => JSON.stringify(e.params).slice(0, 300)).join("\n"));
  }
} finally {
  browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
