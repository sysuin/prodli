// End-to-end tests: loads the built extension (dist-extension) into a throwaway
// headless Chrome profile over the DevTools protocol and drives the real UI.
//
//   pnpm test:e2e            (builds first)
//   CHROME_PATH=/path/to/chrome node tests/e2e/run.mjs
//
// Needs Google Chrome (or Chromium) 126+ for Extensions.loadUnpacked.

import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  async type(text) {
    await this.send("Input.insertText", { text });
    await sleep(60);
  }
  async key(key, { mod = false, shift = false } = {}) {
    const codes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Backspace: 8, Tab: 9 };
    const modifiers = (mod ? (process.platform === "darwin" ? 4 : 2) : 0) | (shift ? 8 : 0);
    const vk = codes[key] ?? key.toUpperCase().charCodeAt(0);
    const code = codes[key] ? key : `Key${key.toUpperCase()}`;
    const text = key === "Enter" ? "\r" : undefined;
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    if (text && !mod) await this.send("Input.dispatchKeyEvent", { type: "char", key, text, modifiers });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(80);
  }
  async focusEditor(where = "end") {
    await this.eval(`(() => { const el = document.querySelector(".ProseMirror"); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(${where === "end" ? "false" : "true"}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
    await sleep(100);
  }
  /** Saves a screenshot when E2E_SHOTS is set to a folder. */
  async shot(name) {
    if (!process.env.E2E_SHOTS) return;
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(process.env.E2E_SHOTS, `${name}.png`), Buffer.from(data, "base64"));
  }
  editorHtml() {
    return this.eval(`document.querySelector(".ProseMirror").innerHTML`);
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
    const notesNow = async () => (await p.storage(["notes"])).notes ?? [];
    const waitSaved = () => sleep(900);

    // Dark-mode screenshot of the welcome note.
    if (process.env.E2E_SHOTS) {
      await p.eval(`document.documentElement.classList.add("dark")`);
      await sleep(200);
      await p.shot("editor-dark");
      await p.eval(`document.documentElement.classList.remove("dark")`);
    }
    // Welcome note on first run.
    check("Editor: welcome note with checklist on first run", (await p.editorHtml()).includes('data-type="taskList"'));

    // New note: title follows the first line; content saves to the right note.
    await p.click("+");
    await sleep(300);
    await p.type("Shopping list");
    await p.key("Enter");
    await p.type("Milk and eggs");
    await waitSaved();
    let notes = await notesNow();
    const a = notes.find((n) => n.content.includes("Milk and eggs"));
    check("Editor: typing saves to the new note", !!a);
    check("Editor: untitled notes take their first line as title", a?.title === "Shopping list", a?.title);

    // Second note, then switch back: each keeps its own content.
    await p.click("+");
    await sleep(300);
    await p.type("Second note body");
    await waitSaved();
    notes = await notesNow();
    const b2 = notes.find((n) => n.content.includes("Second note body"));
    check("Editor: second note saved separately", !!b2 && b2.id !== a?.id && !b2.content.includes("Milk"));

    // Undo right after switching must not pull the other note's text in.
    await p.eval(`document.querySelector('[data-note-id="${a.id}"]').click()`);
    await sleep(400);
    await p.focusEditor();
    await p.key("z", { mod: true });
    await p.key("z", { mod: true });
    await waitSaved();
    const html = await p.editorHtml();
    notes = await notesNow();
    check("Editor: undo never crosses notes", html.includes("Milk and eggs") && !html.includes("Second note body") && notes.find((n) => n.id === a.id)?.content.includes("Milk and eggs"));

    // Slash menu → checklist, table.
    await p.focusEditor();
    await p.key("Enter");
    await p.type("/check");
    await sleep(200);
    const menuOpen = await p.eval(`!!document.querySelector("[data-slash-menu]")`);
    await p.key("Enter");
    await p.type("Buy bread");
    await sleep(200);
    check("Editor: “/” menu inserts a checklist", menuOpen && (await p.editorHtml()).includes('data-type="taskList"'));
    await p.key("Enter");
    await p.key("Enter");
    await p.type("/table");
    await sleep(200);
    await p.shot("editor-slash-menu");
    await p.key("Enter");
    await sleep(200);
    check("Editor: “/” menu inserts a table", (await p.editorHtml()).includes("<table"));
    check("Editor: table controls appear inside a table", (await p.lowerText()).includes("+ row"));

    // Markdown paste becomes formatting.
    await p.focusEditor();
    await p.eval(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", ["## Pasted heading", "", "- [x] done item", "- [ ] open item", "", "**bold** text"].join(String.fromCharCode(10))); document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await sleep(300);
    const pasted = await p.editorHtml();
    await p.shot("editor-content");
    check("Editor: pasted Markdown becomes headings, checklists and bold", pasted.includes("<h2>Pasted heading</h2>") && pasted.includes('data-checked="true"') && pasted.includes("<strong>bold</strong>"));
    await waitSaved();

    // Pin, delete with undo.
    await p.eval(`document.querySelector('[data-note-id="${b2.id}"] button[aria-label^="Actions"]').click()`);
    await p.click("Pin to top");
    await sleep(400);
    notes = await notesNow();
    check("Editor: pin a note", notes.find((n) => n.id === b2.id)?.pinned === true);
    const firstListed = await p.eval(`document.querySelector("[data-note-id]").dataset.noteId`);
    check("Editor: pinned notes are listed first", firstListed === b2.id);
    await p.eval(`document.querySelector('[data-note-id="${b2.id}"] button[aria-label^="Actions"]').click()`);
    await p.click("Delete");
    await sleep(400);
    notes = await notesNow();
    const deletedOk = !notes.some((n) => n.id === b2.id);
    await p.click("Undo");
    await sleep(500);
    notes = await notesNow();
    check("Editor: delete with Undo", deletedOk && notes.some((n) => n.id === b2.id && n.content.includes("Second note body")));

    // Two tabs: edits in each tab are kept (no overwriting).
    const q = await b.openPage();
    await sleep(800);
    await q.click("+");
    await sleep(300);
    await q.type("Written in tab two");
    await sleep(900);
    await p.eval(`document.querySelector('[data-note-id="${a.id}"]').click()`);
    await sleep(300);
    await p.focusEditor();
    await p.type(" plus butter");
    await sleep(1200);
    notes = await notesNow();
    check("Editor: two tabs — both edits are kept", notes.some((n) => n.content.includes("Written in tab two")) && notes.find((n) => n.id === a.id)?.content.includes("plus butter"));
    check("Editor: other tab shows the new note live", (await q.eval(`[...document.querySelectorAll("[data-note-id]")].length`)) === notes.length);
    await q.close();

    // Import / export Markdown (checklists and tables survive).
    await p.setFile('input[accept^=".md"]', "sample.md");
    await sleep(500);
    notes = await notesNow();
    const imported = notes.find((n) => n.title === "sample");
    check("Editor: import Markdown keeps checklist and table", !!imported && imported.content.includes("<h1>Project Plan</h1>") && imported.content.includes('data-type="taskList"') && imported.content.includes("<table") && !/<script/i.test(imported.content));
    await sleep(300);
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.title.startsWith("Export this note")).click()`);
    const md = await waitForDownload(b, "sample");
    check("Editor: export note as Markdown", md.startsWith("# Project Plan") && md.includes("**bold**") && md.includes("[safe link](https://example.com)") && md.includes("- [x] Write spec") && /\|\s*Name\s*\|\s*Role\s*\|/.test(md), md.slice(0, 160).replace(/\n/g, "⏎"));
    await p.close();
  },

  async todosSync(b, check) {
    const a = await b.openPage();
    await a.goto("todos");
    const c = await b.openPage();
    const add = async (page, title) => {
      await page.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(title)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(80);
      await page.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
      await sleep(600);
    };
    await add(a, "Task from tab A");
    await add(c, "Task from tab B");
    const { todos = [] } = await a.storage(["todos"]);
    check("To-Dos: tasks added in two tabs are both kept", todos.some((t) => t.title === "Task from tab A") && todos.some((t) => t.title === "Task from tab B"));
    check("To-Dos: the other tab updates live", (await a.text()).includes("Task from tab B"));
    await a.close();
    await c.close();
  },

  async account(b, check) {
    const p = await b.openPage();
    await p.goto("editor");
    await p.eval(`[...document.querySelectorAll("nav button")].find(b => b.getAttribute("aria-label") === "Sign in").click()`);
    await sleep(400);
    check("Account: explains when Google sign-in isn't configured", (await p.text()).includes("isn’t set up in this copy"));
    await p.eval(`document.querySelector('[aria-label="Close"]').click()`);
    await sleep(200);

    // Simulate a configured build + Google, then sign in, back up and sign out.
    await p.eval(`(() => {
      const realFetch = window.fetch;
      window.__drive = null;
      chrome.runtime.getManifest = () => ({ oauth2: { client_id: "e2e.apps.googleusercontent.com" } });
      chrome.identity.getAuthToken = async () => ({ token: "e2e-token" });
      chrome.identity.removeCachedAuthToken = async () => {};
      chrome.identity.clearAllCachedAuthTokens = async () => {};
      window.fetch = async (url, init = {}) => {
        url = String(url);
        if (url.includes("oauth2/v3/userinfo")) return Response.json({ sub: "1", name: "Test User", email: "test@example.com", picture: null });
        if (url.includes("/upload/drive/v3/files")) { window.__drive = init.body; return Response.json({ id: "f1" }); }
        if (url.includes("/drive/v3/files?")) return Response.json({ files: window.__drive ? [{ id: "f1", modifiedTime: new Date().toISOString(), size: "100" }] : [] });
        if (url.includes("oauth2.googleapis.com/revoke")) return new Response("");
        return realFetch(url, init);
      };
      return true;
    })()`);
    await p.eval(`[...document.querySelectorAll("nav button")].find(b => b.getAttribute("aria-label") === "Sign in").click()`);
    await sleep(300);
    await p.click("Sign in with Google", { exact: false });
    await sleep(700);
    let t = await p.text();
    await p.shot("account-signed-in");
    check("Account: sign in shows the Google profile", t.includes("Test User") && t.includes("test@example.com"));
    check("Account: avatar appears in the top bar", await p.eval(`!!document.querySelector('nav button[aria-label="Account: test@example.com"]')`));
    await p.click("Back up now");
    await sleep(800);
    t = await p.text();
    const uploaded = await p.eval("window.__drive || ''");
    check("Account: back up to Google Drive (private app folder, no API key)", t.includes("Backed up to Google Drive") && uploaded.includes('"version":"1.1"') && uploaded.includes("appDataFolder") && !uploaded.includes("claudeApiKey"), uploaded.slice(0, 200));
    await sleep(500);
    check("Account: shows the latest Drive copy", !(await p.text()).includes("Latest copy in Drive: none yet"));
    await p.click("Sign out");
    await sleep(500);
    const { googleAccount } = await p.storage(["googleAccount"]);
    check("Account: sign out forgets the account", !googleAccount && (await p.text()).includes("Signed out"));
    await p.close();
  },

  async tracker(b, check) {
    // A real local website the tracker can time.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<title>Test site</title><h1>Hello from a test site</h1>");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    try {
      const ext = await b.openPage();
      await ext.goto("tracker");
      const dayKey = await ext.eval(`(() => { const d = new Date(); return "tt_" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
      const secondsOnSite = async () => ((await ext.storage([dayKey]))[dayKey] ?? {})["127.0.0.1"] ?? 0;

      const site = await b.openPage(`http://127.0.0.1:${port}/`);
      await b.send("Target.activateTarget", { targetId: site.targetId });
      await sleep(4000);
      await b.send("Target.activateTarget", { targetId: ext.targetId });
      await sleep(1500);
      const first = await secondsOnSite();
      check("Tracker: time on a website is recorded", first >= 3, `${first}s`);

      // Chrome stops idle extension workers; tracking must continue across that.
      await b.send("Target.activateTarget", { targetId: site.targetId });
      await sleep(1500);
      await ext.send("ServiceWorker.enable", {});
      await ext.send("ServiceWorker.stopAllWorkers", {});
      await sleep(4000);
      await b.send("Target.activateTarget", { targetId: ext.targetId });
      await sleep(2000);
      const second = await secondsOnSite();
      check("Tracker: keeps counting after the background worker restarts", second - first >= 4, `${first}s → ${second}s`);

      await ext.send("Page.reload", {});
      await sleep(1800);
      check("Tracker: Today view lists the site", (await ext.text()).includes("127.0.0.1"));

      // Clearing history keeps settings.
      await ext.eval(`chrome.storage.local.set({ tt_settings: { idleThreshold: 60, notifyEnabled: true, notifyTime: "20:00", focusList: [{ id: "r1", domain: "youtube.com", limitMinutes: 30, redirectEnabled: false }], excludedDomains: ["bank.example"] } })`);
      await ext.eval(`window.confirm = () => true`);
      await ext.click("⚙ Settings", { exact: false }).catch(() => ext.click("Settings", { exact: false }));
      await sleep(500);
      await ext.click("Clear all tracking data", { exact: false });
      await sleep(800);
      const after = await ext.storage([dayKey, "tt_settings"]);
      check("Tracker: “Clear all tracking data” keeps Focus List and excluded sites", !after[dayKey] && after.tt_settings?.focusList?.[0]?.domain === "youtube.com" && after.tt_settings?.excludedDomains?.[0] === "bank.example");
      await site.close();
      await ext.close();
    } finally {
      server.close();
    }
  },

  async habits(b, check) {
    const p = await b.openPage();
    await p.goto("habits");
    const today = await p.eval(`(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    const habits = async () => (await p.storage(["habits"])).habits ?? [];

    await p.click("+ New Habit");
    await sleep(200);
    await p.eval(`(() => { const i = document.querySelector('input[placeholder="Habit name..."]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Drink water"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await p.click("Save");
    await sleep(400);
    let list = await habits();
    check("Habits: create a habit", list.some((h) => h.name === "Drink water" && !h.archived));

    await p.eval(`document.querySelector('button[title="Mark today done"]').click()`);
    await sleep(400);
    list = await habits();
    check("Habits: mark today done", list.find((h) => h.name === "Drink water")?.completedDays.includes(today));
    await p.eval(`document.querySelector('button[title="Unmark today"]').click()`);
    await sleep(400);
    list = await habits();
    check("Habits: unmark today", !list.find((h) => h.name === "Drink water")?.completedDays.includes(today));

    // Streaks from a seeded history of 5 days in a row.
    const days = await p.eval(`[0,1,2,3,4].map(i => { const d = new Date(); d.setDate(d.getDate() - i); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })`);
    await p.eval(`chrome.storage.local.get("habits").then(({ habits }) => chrome.storage.local.set({ habits: [...habits, { id: "streaky", name: "Read", emoji: "📚", color: "#60a5fa", completedDays: ${JSON.stringify(days)}, createdAt: new Date(Date.now() - 864e6).toISOString(), archived: false }] }))`);
    await sleep(500);
    check("Habits: shows a 5-day streak", /5\s*(day|🔥)|🔥\s*5/i.test(await p.text()));

    await p.eval(`[...document.querySelectorAll('button[title="Archive"]')].find(b => b.closest("div").parentElement.innerText.includes("Read") || b.parentElement.parentElement.innerText.includes("Read")).click()`);
    await sleep(400);
    list = await habits();
    check("Habits: archive keeps the history", list.find((h) => h.id === "streaky")?.archived === true && list.find((h) => h.id === "streaky")?.completedDays.length === 5 && list.find((h) => h.name === "Drink water")?.archived === false, JSON.stringify(list.map((h) => [h.name, h.archived])));
    check("Habits: a habit added in another tab appears at the bottom, like local ones", (await habits()).map((h) => h.id).at(-1) === "streaky");
    await p.close();
  },

  async a11y(b, check) {
    // Automated accessibility audit (axe-core, WCAG 2 A/AA) of every tab, light and dark.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("editor");
    const report = [];
    for (const theme of ["light", "dark"]) {
      for (const section of ["editor", "todos", "pomodoro", "habits", "tracker", "meetings", "files"]) {
        await p.eval(`chrome.storage.local.set({ lastSection: "${section}", theme: "${theme}" })`);
        await p.send("Page.reload", {});
        await sleep(1500);
        await p.eval(axeSource + ";true");
        const violations = await p.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 4).map(n => n.html.slice(0, 90) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + " = " + n.any[0].data.contrastRatio + "]" : "")).join(" | ") })))`);
        for (const v of violations) report.push(`${theme}/${section}: ${v.id} (${v.impact}, ${v.count}) e.g. ${v.sample}`);
        check(`A11y (${theme}): ${section} has no serious accessibility problems`, violations.length === 0, violations.map((v) => `${v.id}×${v.count}`).join(", "));
      }
    }
    // Pop-ups: Help, Backup, Account, Welcome.
    await p.eval(`chrome.storage.local.set({ lastSection: "editor", theme: "light" })`);
    for (const [name, open] of [
      ["help", `document.querySelector('button[aria-label="Help and keyboard shortcuts"]').click()`],
      ["backup", `document.querySelector('button[aria-label="Backup and restore"]').click()`],
      ["account", `document.querySelector('nav button[aria-label="Sign in"]').click()`],
      ["welcome", `chrome.storage.local.set({ hasSeenOnboarding: false }).then(() => location.reload())`],
    ]) {
      await p.send("Page.reload", {});
      await sleep(1300);
      await p.eval(open);
      await sleep(name === "welcome" ? 1600 : 500);
      await p.eval(axeSource + ";true");
      const violations = await p.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id: v.id, count: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => n.html.slice(0, 90) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + " = " + n.any[0].data.contrastRatio + "]" : "")).join(" | ") })))`);
      const isDialog = await p.eval(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`);
      for (const v of violations) report.push(`popup/${name}: ${v.id} (${v.count}) e.g. ${v.sample}`);
      check(`A11y: ${name} pop-up is an accessible dialog with no serious problems`, violations.length === 0 && isDialog, `${isDialog ? "" : "not a dialog; "}${violations.map((v) => `${v.id}×${v.count}`).join(", ")}`);
      await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true })`);
    }
    if (process.env.A11Y_REPORT) console.log(report.join("\n"));
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
    console.log(`✗ ${errors.length} JavaScript error(s):`, errors.map((e) => e.params.exceptionDetails?.exception?.description?.slice(0, 600) ?? JSON.stringify(e.params).slice(0, 400)).join("\n"));
  }
} finally {
  browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
