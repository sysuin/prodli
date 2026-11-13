// End-to-end tests: loads the built extension (dist-extension) into a throwaway
// headless Chrome profile over the DevTools protocol and drives the real UI.
//
//   pnpm test:e2e            (builds first)
//   CHROME_PATH=/path/to/chrome node tests/e2e/run.mjs [suite]
//   E2E_SPEECH=1 …            also runs the on-device speech test (downloads Chrome's model)
//
// Needs Google Chrome (or Chromium) 126+ for Extensions.loadUnpacked.

import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser, EXT, FIXTURES, sleep, waitForDownload } from "./cdp.mjs";

const only = process.argv[2]; // optional suite filter, e.g. "editor" or "files,tracker"

// ── Suites ────────────────────────────────────────────────────────────────────

const suites = {
  async smoke(b, check) {
    // Every tab opens with its keyboard shortcut and renders without errors.
    const p = await b.openPage();
    await p.goto("editor");

    // Speed: a new tab must render the last section directly — never through
    // the Suspense fallback, which React 19 holds for ~300 ms.
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__fallbackSeen = false; window.__t0 = performance.now(); new MutationObserver(() => { if (document.querySelector("[data-suspense-fallback]")) window.__fallbackSeen = true; if (!window.__editorAt && document.querySelector(".ProseMirror")) window.__editorAt = Math.round(performance.now()); }).observe(document, { childList: true, subtree: true });` });
    let fallbackSeen = false;
    const times = [];
    for (let i = 0; i < 3; i++) {
      await p.send("Page.reload", {});
      await sleep(1200);
      fallbackSeen ||= await p.eval("window.__fallbackSeen");
      times.push(await p.eval("window.__editorAt || 99999"));
    }
    check("Speed: new tab shows the Editor without a loading placeholder", !fallbackSeen, `editor visible at ${times.join(", ")} ms`);
    const tabs = ["Notes", "To-Dos", "Pomodoro", "Habits", "Tracker", "Meetings", "Files"];
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
    // Smart add: "tomorrow" and "!high" become the due date and priority.
    await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Call Sam tomorrow !high"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(150);
    const preview = await p.eval(`document.querySelector('[data-testid="smart-add-preview"]')?.innerText ?? ""`);
    await p.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
    await sleep(500);
    const smart = ((await p.storage(["todos"])).todos ?? []).find((t) => t.title === "Call Sam");
    const tmr = new Date(Date.now() + 86_400_000);
    const tmrKey = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, "0")}-${String(tmr.getDate()).padStart(2, "0")}`;
    check("To-Dos: smart add previews and sets the date and priority", preview.includes("Tomorrow") && smart?.dueDate === tmrKey && smart?.priority === "high", `${preview} | ${JSON.stringify(smart)}`);
    check("To-Dos: 'By date' groups tasks (Tomorrow)", await p.eval(`!!document.querySelector('[data-testid="todo-group-tomorrow"]')?.innerText.includes("Call Sam")`));
    // Habits: the page renders its create button.
    await p.goto("habits");
    check("Smoke: Habits renders", (await p.lowerText()).includes("new habit"));
    // Help panel lists the new sections.
    await p.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))`);
    await sleep(400);
    const help = await p.lowerText();
    check("Smoke: Help covers Meetings, Files and Ctrl+7", help.includes("meetings") && help.includes("save to notes") && help.includes("go to files"));
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
    check("Meetings: setup says transcripts need Meet captions", t.includes("transcripts come from meet’s captions") || t.includes("transcripts come from meet's captions"));
    check("Meetings: setup panel on first run (no API key asked)", t.includes("ai summaries") && t.includes("turn on recorder") && !t.includes("claude api key") && !t.includes("sk-ant"));
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
    check("Meetings: Summarize disabled until signed in", await p.eval(`[...document.querySelectorAll("button")].find(b => /summarize/i.test(b.textContent)).disabled`));
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
    await p.setFile('input[type="file"]', "demo.ts");
    await sleep(500);
    if (process.env.E2E_SHOTS) { const { data } = await p.send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(process.env.E2E_SHOTS, "files-code.png"), Buffer.from(data, "base64")); }
    check("Files: code files are syntax-highlighted", await p.eval(`!!document.querySelector('.code-preview[data-language="typescript"] .hljs-keyword')`));
    await p.setFile('input[type="file"]', "blob.bin");
    check("Files: binary rejected", (await p.text()).includes("looks like a binary file"));
    // Recent files: close the preview and reopen from the list.
    await p.click("Close");
    await sleep(400);
    const recentNames = await p.eval(`[...document.querySelectorAll('[aria-label="Recent files"] button div:first-child')].map(d => d.textContent)`);
    check("Files: recent files are listed (newest first)", recentNames[0] === "demo.ts" && recentNames.includes("sample.md") && !recentNames.includes("blob.bin"), recentNames.join(", "));
    await p.eval(`[...document.querySelectorAll('[aria-label="Recent files"] button')].find(b => b.textContent.includes("people.csv")).click()`);
    await sleep(500);
    check("Files: reopen a recent file with one click", (await p.text()).includes("Shah, Priya"));
    // Drop onto another section
    await p.eval(`[...document.querySelectorAll("nav button")].find(b => b.textContent.includes("Notes")).click()`);
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
    await p.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "start", meetingId: "m1", startedAtMs: Date.now(), showIndicator: true }, {}, r))`);
    await sleep(300);
    check("Captions: turned on automatically + optional label shown", await p.eval(`!!document.getElementById('cap') && !!document.querySelector('[data-prodli-badge]')`));
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

    // Today's Meet layout: captions region > scroll container > one block per speaker turn,
    // with a "jump to latest" button inside the container once captions overflow, and a
    // long monologue whose start scrolls away while Meet keeps correcting recent words.
    // (This is what cut transcripts short before: blocks next to a button were skipped.)
    const modern = await b.openPage("about:blank");
    await modern.eval(`
      document.title = "Meet - Long call";
      document.body.innerHTML = '<button aria-label="Leave call">x</button><div role="region" aria-label="Captions" id="cap"><div id="scroll"></div></div>';
      window.__sent = []; window.__listeners = [];
      window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); }, onMessage: { addListener: (f) => window.__listeners.push(f), removeListener: () => {} } } };
      window.__turn = (who, text) => { const d = document.createElement('div'); d.innerHTML = '<div><img alt=""><span>' + who + '</span></div><div class="t">' + text + '</div>'; document.getElementById('scroll').appendChild(d); return d; };
      true`);
    await modern.eval(script + ";true");
    await modern.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "start", meetingId: "long", startedAtMs: Date.now() }, {}, r))`);
    await sleep(300);
    check("Captions: no in-call label unless turned on", !(await modern.eval(`!!document.querySelector('[data-prodli-badge]')`)));
    const sentences = Array.from({ length: 14 }, (_, i) => `this is sentence number ${i + 1} about the launch plan`);
    await modern.eval(`window.__me = __turn('You', ${JSON.stringify(sentences[0])}); true`);
    for (let i = 1; i < sentences.length; i++) {
      // Meet shows only the last ~3 sentences of the turn; older words scroll away.
      const visible = sentences.slice(Math.max(0, i - 2), i + 1).join(". ");
      // Sometimes it corrects capitalisation/punctuation of what's still visible.
      const shown = i % 4 === 0 ? visible.replace(/^t/, "T").replace(/plan/g, "plan,") : visible;
      await modern.eval(`__me.querySelector('.t').textContent = ${JSON.stringify(shown)}; true`);
      if (i === 5) await modern.eval(`(() => { const j = document.createElement('button'); j.textContent = 'Jump to bottom'; document.getElementById('scroll').appendChild(j); return true; })()`);
      await sleep(1100);
    }
    await modern.eval(`window.__p = __turn('Priya Shah', 'Sounds good, I will update the roadmap'); true`);
    await sleep(1200);
    await modern.eval(`__p.querySelector('.t').textContent = 'Sounds good. I will update the roadmap tomorrow morning.'; true`);
    await sleep(1500);
    const longRes = await modern.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "stop" }, {}, r))`);
    const mine = longRes.entries.filter((e) => e.speaker === "You").map((e) => e.text).join(" ").toLowerCase();
    const missing = sentences.filter((x) => !mine.includes(x.toLowerCase()));
    check("Captions: a long monologue is captured to the end (nothing lost when it scrolls)", missing.length === 0, `missing: ${missing.join(" | ")} | got: ${mine.slice(0, 400)}`);
    check("Captions: each speaker is labelled by name", longRes.entries.some((e) => e.speaker === "Priya Shah" && /roadmap tomorrow morning/.test(e.text)), JSON.stringify(longRes.entries.map((e) => e.speaker)));
    check("Captions: controls inside the captions area aren't transcribed", !JSON.stringify(longRes.entries).includes("Jump to bottom"));
    await modern.close();

    // Same flow with Meet in Spanish: labels are translated, icon names are not.
    const es = await b.openPage("about:blank");
    await es.eval(`
      document.title = "Meet - Reunión semanal";
      document.body.innerHTML = '<button aria-label="Salir de la llamada"><i class="google-symbols" aria-hidden="true">call_end</i></button>' +
        '<button aria-label="Activar subtítulos" aria-pressed="false"><i class="google-symbols" aria-hidden="true">closed_caption_off</i></button>';
      document.querySelector('[aria-label="Activar subtítulos"]').addEventListener('click', () => {
        const r = document.createElement('div'); r.setAttribute('role','region'); r.setAttribute('aria-label','Subtítulos'); r.id='cap'; document.body.appendChild(r);
      });
      window.__sent = []; window.__listeners = [];
      window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); }, onMessage: { addListener: (f) => window.__listeners.push(f), removeListener: () => {} } } };
      window.__block = (s, t) => { const d = document.createElement('div'); d.innerHTML = '<img alt=""><div>' + s + '</div><div class="t">' + t + '</div>'; document.getElementById('cap').appendChild(d); return d; };
      true`);
    await es.eval(script + ";true");
    await es.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "start", meetingId: "es1", startedAtMs: Date.now() }, {}, r))`);
    await sleep(300);
    check("Captions (Spanish UI): turns captions on via the icon", await es.eval(`!!document.getElementById('cap')`));
    await es.eval(`__block('Tú', 'Hola a todos, empecemos'); true`);
    await sleep(3500);
    const esUpdates = await es.eval(`window.__sent.filter(m => m.type === 'captions-update')`);
    check("Captions (Spanish UI): transcript captured", esUpdates.at(-1)?.entries?.[0]?.text === "Hola a todos, empecemos" && esUpdates.at(-1)?.title === "Reunión semanal");
    await es.eval(`document.querySelector('[aria-label="Salir de la llamada"]').remove(); true`);
    await sleep(7000);
    check("Captions (Spanish UI): leaving the call ends recording", await es.eval(`window.__sent.some(m => m.type === 'captions-ended')`));
    await es.close();
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
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.title.startsWith("More: copy")).click()`);
    await sleep(200);
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
    await p.eval(`document.querySelector('nav button[aria-haspopup="menu"]').click()`);
    await sleep(300);
    check("Account: the profile menu offers Sign in, Settings, Backup, theme and Help", await p.eval(`(() => { const t = document.querySelector('[role="menu"]')?.innerText ?? ""; return ["Sign in", "Settings", "Backup & data", "Dark mode", "Help & shortcuts"].every((x) => t.includes(x)); })()`));
    await p.eval(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes("Sign in")).click()`);
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
        if (url.includes("/upload/drive/v3/files")) { window.__drive = init.body; window.__uploads = (window.__uploads || 0) + 1; return Response.json({ id: "f1" }); }
        if (url.includes("/drive/v3/files/f1") && url.includes("alt=media")) return new Response(window.__drive.split(String.fromCharCode(13, 10, 13, 10))[2].split(String.fromCharCode(13, 10) + "--")[0], { headers: { "Content-Type": "application/json" } });
        if (url.includes("/drive/v3/files?")) return Response.json({ files: window.__drive ? [{ id: "f1", modifiedTime: new Date().toISOString(), size: "100" }] : [] });
        if (url.includes("oauth2.googleapis.com/revoke")) return new Response("");
        return realFetch(url, init);
      };
      return true;
    })()`);
    await p.eval(`window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "account" } }))`);
    await sleep(300);
    await p.click("Sign in with Google", { exact: false });
    await sleep(700);
    let t = await p.text();
    await p.shot("account-signed-in");
    check("Account: sign in shows the Google profile", t.includes("Test User") && t.includes("test@example.com"));
    check("Account: signing in syncs right away", (await p.eval("window.__uploads || 0")) === 1 && t.includes("synced"));
    check("Account: avatar appears in the top bar", await p.eval(`!!document.querySelector('nav button[aria-label="Account: test@example.com"]')`));
    await p.click("Sync now");
    await sleep(800);
    t = await p.text();
    const uploaded = await p.eval("window.__drive || ''");
    check("Account: sync with Google Drive (private app folder, no API key)", t.includes("Synced with Google Drive") && (await p.eval("window.__uploads")) === 2 && uploaded.includes('"version":"1.1"') && uploaded.includes('"tombstones"') && !uploaded.includes("claudeApiKey"), uploaded.slice(0, 200));
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

      const sw = await b.serviceWorker();
      const trackingSite = async () => {
        // Wait until the tracker has actually started timing the site (not just a fixed delay).
        for (let i = 0; i < 40; i++) {
          const { tt_session } = await sw.eval(`chrome.storage.session.get("tt_session")`);
          if (tt_session?.domain === "127.0.0.1") return true;
          await sleep(250);
        }
        return false;
      };
      const waitForSeconds = async (min) => {
        for (let i = 0; i < 20; i++) {
          const v = await secondsOnSite();
          if (v >= min) return v;
          await sleep(250);
        }
        return secondsOnSite();
      };

      // The tracker (correctly) pauses when the computer is idle. A long test run sends no
      // input for minutes, so use a long idle threshold — as for an active user.
      await ext.eval(`chrome.storage.local.set({ tt_settings: { idleThreshold: 3600, notifyEnabled: false, notifyTime: "20:00", focusList: [], excludedDomains: [] } })`);
      await sleep(500);

      const site = await b.openPage(`http://127.0.0.1:${port}/`);
      await b.send("Target.activateTarget", { targetId: site.targetId });
      const started = await trackingSite();
      const diag = started ? "" : JSON.stringify(await sw.eval(`(async () => ({
        active: (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((t) => t.url),
        windows: (await chrome.windows.getAll({ populate: true })).map((w) => ({ focused: w.focused, tabs: w.tabs.map((t) => (t.active ? "*" : "") + t.url.slice(0, 40)) })),
        idle: await chrome.idle.queryState(60),
        settings: (await chrome.storage.local.get("tt_settings")).tt_settings ?? null,
      }))()`));
      await sleep(4000);
      await b.send("Target.activateTarget", { targetId: ext.targetId });
      const first = await waitForSeconds(3);
      check("Tracker: time on a website is recorded", started && first >= 3, `${started ? "" : "session never started; " + diag + "; "}${first}s`);

      // Chrome stops idle extension workers; tracking must continue across that.
      await b.send("Target.activateTarget", { targetId: site.targetId });
      await trackingSite();
      await sleep(1500);
      await ext.send("ServiceWorker.enable", {});
      await ext.send("ServiceWorker.stopAllWorkers", {});
      await sleep(4000);
      await b.send("Target.activateTarget", { targetId: ext.targetId });
      const second = await waitForSeconds(first + 4);
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

  async review(b, check) {
    // Weekly review of this week, from seeded data; no account → the basic review.
    const p = await b.openPage();
    const key = (offset) => `(() => { const d = new Date(); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back + ${offset}); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`;
    const monday = await p.eval(key(0));
    const nextMonday = await p.eval(key(7));
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, todos: [
      { id: "r1", title: "Ship the release", completed: true, completedAt: new Date("${monday}T15:00:00").toISOString(), priority: "high", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "r2", title: "Reply to Priya", completed: false, dueDate: "${monday}", priority: "high", createdAt: "2026-01-01T00:00:00.000Z" }
    ] })`);
    await p.goto("review");
    await sleep(600);
    check("Review: shows this week's or last week's numbers", /tasks done/i.test(await p.text()));
    // Look at this week (the default is last week before Friday).
    if (!(await p.eval(`document.querySelector('[data-testid="review-week"]').parentElement.innerText.includes("This week")`))) await p.click("Next ›");
    await sleep(500);
    check("Review: counts the task done this week", (await p.eval(`document.querySelector('[data-testid="stat-done"]').innerText`)).startsWith("1"));
    check("Review: lists what slipped", (await p.eval(`document.querySelector('[data-testid="review-slipped"]')?.innerText ?? ""`)).includes("Reply to Priya"));
    await p.click("Write my review");
    await sleep(800);
    const text = await p.eval(`document.querySelector('[data-testid="weekly-review"]').innerText`);
    check("Review: writes a review without an account", /1 task done this week/i.test(text) && /Next week's priorities/i.test(text), text.slice(0, 200));
    await p.eval(`[...document.querySelectorAll('[data-testid="review-next-week"] button')].find(b => b.textContent.startsWith("Plan for")).click()`);
    await sleep(500);
    const { todos, days } = await p.storage(["todos", "days"]);
    check("Review: plans a priority for next Monday", todos.find((t) => t.id === "r2")?.plannedFor === nextMonday, JSON.stringify(todos.find((t) => t.id === "r2")));
    check("Review: is saved with the week (synced)", !!days?.find((d) => d.id === monday)?.review?.headline);
    await p.eval(`chrome.storage.local.set({ todos: [], days: [] })`); // leave a clean slate for later suites
    await p.close();
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
      for (const section of ["today", "review", "editor", "todos", "pomodoro", "habits", "tracker", "meetings", "files"]) {
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
      ["help", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "help" } }))`],
      ["backup", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "data" } }))`],
      ["account", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "account" } }))`],
      ["today settings", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "today" } }))`],
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
    // The profile menu (a menu, not a dialog).
    await p.send("Page.reload", {});
    await sleep(1300);
    await p.eval(`document.querySelector('nav button[aria-haspopup="menu"]').click()`);
    await sleep(400);
    await p.eval(axeSource + ";true");
    const menuViolations = await p.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
    const isMenu = await p.eval(`!!document.querySelector('[role="menu"]') && document.querySelector('nav button[aria-haspopup="menu"]').getAttribute("aria-expanded") === "true"`);
    check("A11y: profile menu is an accessible menu with no serious problems", menuViolations.length === 0 && isMenu, menuViolations.join(", "));
    if (process.env.A11Y_REPORT) console.log(report.join("\n"));
    await p.close();
  },

  async blocks(b, check) {
    // Time blocks on Today: Block time puts planned tasks into free time; reminders are scheduled.
    const p = await b.openPage();
    const [day, nowMin] = await p.eval(`(() => { const d = new Date(); return [d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), d.getHours() * 60 + d.getMinutes()]; })()`);
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, todaySettings: { workStart: "00:00", workEnd: "23:59", reminder: null, startOnToday: false, autoBrief: false, blockReminders: true }, todos: [
      { id: "b1", title: "Write release notes", completed: false, plannedFor: "${day}", estimateMin: 15, priority: "high", createdAt: new Date().toISOString() },
      { id: "b2", title: "Reply to Priya", completed: false, plannedFor: "${day}", estimateMin: 15, createdAt: new Date().toISOString() }
    ] })`);
    await p.goto("today");
    await sleep(800);
    await p.eval(`document.querySelector('[data-testid="block-time"]').click()`);
    await sleep(800);
    const { todos } = await p.storage(["todos"]);
    const room = 23 * 60 + 59 - nowMin;
    if (room >= 50) {
      const [w, r] = ["b1", "b2"].map((id) => todos.find((t) => t.id === id)?.block);
      check("Blocks: Block time puts planned tasks into free time, high priority first", w?.day === day && r?.day === day && w.start < r.start, JSON.stringify([w, r]));
      check("Blocks: they show on the agenda", (await p.eval(`document.querySelectorAll('[data-testid="time-block"]').length`)) === 2);
      const alarms = await p.eval(`chrome.alarms.getAll().then(a => a.map(x => x.name))`);
      // (A block starting right now gets no reminder: you just planned it.)
      const ahead = (blk) => Number(blk.start.slice(0, 2)) * 60 + Number(blk.start.slice(3)) > nowMin + 1;
      check("Blocks: a reminder is scheduled for each block ahead", (!ahead(w) || alarms.includes("block:b1")) && alarms.includes("block:b2"), JSON.stringify(alarms));
      const href = await p.eval(`document.querySelector('[data-testid="time-block"] a[href*="calendar.google.com"]')?.href ?? ""`);
      check("Blocks: each block can be added to Google Calendar", href.includes("action=TEMPLATE") && href.includes("Write+release+notes"), href.slice(0, 120));
      await p.eval(`document.querySelector('[aria-label="Remove time block for Write release notes"]').click()`);
      await sleep(800);
      const after = await p.storage(["todos"]);
      const alarmsAfter = await p.eval(`chrome.alarms.getAll().then(a => a.map(x => x.name))`);
      check("Blocks: removing a block cancels its reminder", !after.todos.find((t) => t.id === "b1").block && !alarmsAfter.includes("block:b1") && alarmsAfter.includes("block:b2"), JSON.stringify(alarmsAfter));
      check("Blocks: blocks don't overlap", (await p.eval(`document.body.innerText.includes("OVERLAPS")`)) === false);
    } else {
      check("Blocks: late at night, Block time says the tasks don't fit", /didn't fit/.test(await p.eval(`document.querySelector('[data-testid="agenda"]').innerText`)));
    }
    await p.close();
  },

  async speech(b, check) {
    // On-device transcription with Chrome's real speech model. Opt-in (downloads a language pack):
    //   E2E_SPEECH=1 node tests/e2e/run.mjs speech
    if (!process.env.E2E_SPEECH) {
      console.log("  – skipped (set E2E_SPEECH=1 to download Chrome's speech model and run it)");
      return;
    }
    const p = await b.openPage();
    await p.goto("meetings");
    check("Speech: setup offers on-device transcription", (await p.lowerText()).includes("when captions are off"));
    const box = await p.eval(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("Download speech model")); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (box) {
      for (const type of ["mousePressed", "mouseReleased"]) await p.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await sleep(1000);
      ready = (await p.text()).includes("✓ Ready");
    }
    const { recorderSpeechEnabled } = await p.storage(["recorderSpeechEnabled"]);
    check("Speech: one click downloads the model and turns transcription on", ready && recorderSpeechEnabled === true);

    // Run the recorder's transcriber on recorded speech inside the offscreen page.
    const wav = readFileSync(path.join(FIXTURES, "speech-en.wav")).toString("base64");
    const off = await b.openPage(`chrome-extension://${b.extId}/offscreen.html`);
    const heard = await off.eval(`(async () => {
      const { LiveTranscriber } = window.__prodliSpeech;
      const bytes = Uint8Array.from(atob("${wav}"), (c) => c.charCodeAt(0));
      const ctx = new AudioContext(); await ctx.resume();
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const dest = ctx.createMediaStreamDestination(); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
      const t = new LiveTranscriber(dest.stream.getAudioTracks()[0], "Others", "en-US", Date.now());
      t.start(); src.start();
      await new Promise((r) => setTimeout(r, (buf.duration + 4) * 1000));
      return (await t.stop()).map((e) => e.speaker + ": " + e.text).join(" | ");
    })()`);
    check("Speech: transcribes call audio on-device", /ship the beta on Friday/i.test(heard) && heard.startsWith("Others:"), heard);
    await off.close();
    await p.close();
  },

  async welcome(b, check) {
    // First run: three steps, each with a way in; shown once.
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: false }).then(() => location.reload())`);
    await sleep(1600);
    const step = () => p.eval(`document.querySelector('[data-testid="welcome-step"]')?.innerText ?? ""`);
    check("Welcome: starts with Plan your day", /step 1 of 3/i.test(await step()) && /plan your day/i.test(await step()));
    await p.click("Next →");
    await sleep(200);
    check("Welcome: step 2 is Ask ProdLi", /ask prodli anything/i.test(await step()));
    await p.click("Next →");
    await sleep(200);
    check("Welcome: step 3 is about your data / syncing", /step 3 of 3/i.test(await step()));
    await p.eval(`[...document.querySelectorAll('[role="tab"]')][0].click()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes("Open Today")).click()`);
    await sleep(800);
    const { hasSeenOnboarding, lastSection } = await p.storage(["hasSeenOnboarding", "lastSection"]);
    check("Welcome: 'Open Today' closes it, opens Today, and it isn't shown again", hasSeenOnboarding === true && lastSection === "today" && !(await p.eval(`!!document.querySelector('[aria-labelledby="welcome-title"]')`)), JSON.stringify({ hasSeenOnboarding, lastSection }));
    await p.close();
  },

  async backup(b, check) {
    const p = await b.openPage();
    await p.goto("editor");
    await p.eval(`chrome.storage.local.set({ "tt_2026-11-07": { "github.com": 120 }, claudeApiKey: "sk-ant-e2e-secret" })`);
    await p.eval(`window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "data" } }))`);
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
    if (only && !only.split(",").includes(name)) continue;
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
    // Isolation: close any tabs a suite left open so suites can't affect each other.
    const { targetInfos } = await browser.send("Target.getTargets");
    for (const t of targetInfos) if (t.type === "page" && t.url !== "about:blank") await browser.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
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
