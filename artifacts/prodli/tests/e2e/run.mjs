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

    // ✉️ Draft follow-up (writing help, phase 2). No ProdLi server in this copy:
    // first the "not available" message, then a stub stands in for /api/ai/follow-up.
    const fu = (label) => p.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="follow-up"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error("No follow-up button: ${label}"); b.click(); return true; })()`);
    const followText = () => p.eval(`document.querySelector('[data-testid="follow-up"]')?.innerText ?? ""`);
    await p.click("✉️ Draft follow-up");
    await sleep(400);
    check("Follow-up: without a ProdLi server it says so", (await followText()).includes("isn't available in this copy"), await followText());
    await fu("Close");
    await sleep(200);
    check("Follow-up: Close shuts the panel", !(await p.eval(`!!document.querySelector('[data-testid="follow-up"]')`)));
    await p.eval(`(() => {
      window.__followUps = [];
      globalThis.__prodliFollowUpStub = async (tone, meeting) => {
        window.__followUps.push({ tone, meeting });
        await new Promise((r) => setTimeout(r, 150));
        const items = meeting.actionItems.map((a) => "- " + a.task + (a.owner ? ": " + a.owner : "")).join("\\n");
        return { subject: (tone === "formal" ? "Summary and next steps: " : "Quick recap: ") + meeting.title, body: (tone === "formal" ? "Dear all," : "Hi all,") + "\\n\\n" + items + "\\n\\nThanks,", usage: { used: window.__followUps.length, limit: 200 } };
      };
      return true;
    })()`);
    await p.click("✉️ Draft follow-up");
    await sleep(60);
    check("Follow-up: shows progress while writing", (await followText()).includes("Writing a friendly follow-up"));
    await sleep(400);
    const body = () => p.eval(`document.querySelector('[data-testid="follow-up-body"]')?.value ?? ""`);
    const sent = await p.eval("window.__followUps");
    check("Follow-up: sends the summary only (no transcript), friendly first", sent.length === 1 && sent[0].tone === "friendly" && sent[0].meeting.title === "Beta launch planning" && sent[0].meeting.actionItems[0].owner === "Priya Shah" && !JSON.stringify(sent).includes("Ship Friday.\"") && !("transcript" in sent[0].meeting), JSON.stringify(sent));
    check("Follow-up: shows an editable draft", (await body()).startsWith("Hi all,") && (await body()).includes("- Finish onboarding emails: Priya Shah"), await body());
    check("Follow-up: offers Open in email app for a short email", await p.eval(`(() => { const a = [...document.querySelectorAll('[data-testid="follow-up"] a')].find(a => a.textContent.includes("Open in email app")); return !!a && a.href.startsWith("mailto:?subject=Quick%20recap%3A%20Beta%20launch%20planning&body=Hi%20all%2C%0D%0A"); })()`));
    check("Follow-up: shows what's left this month", (await followText()).includes("199 of 200 writing-help uses left"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8") + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="follow-up"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): the follow-up panel has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("follow-up-draft");
    await fu("Formal");
    await sleep(500);
    check("Follow-up: switching tone writes a formal draft", (await body()).startsWith("Dear all,") && (await p.eval("window.__followUps.length")) === 2);
    await fu("Friendly");
    await sleep(200);
    check("Follow-up: switching back reuses the first draft (no extra use)", (await body()).startsWith("Hi all,") && (await p.eval("window.__followUps.length")) === 2);
    await p.eval(`(() => { const t = document.querySelector('[data-testid="follow-up-body"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Edited by me"); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(100);
    check("Follow-up: the draft can be edited", (await body()) === "Edited by me");
    await fu("Discard");
    await sleep(200);
    check("Follow-up: Discard closes it and nothing was saved", !(await p.eval(`!!document.querySelector('[data-testid="follow-up"]')`)) && !JSON.stringify(await p.storage(null)).includes("Edited by me"));

    // A long meeting name stays inside the list (it used to push over the meeting
    // on the right), and a meeting with audio offers Download audio.
    const longTitle = "2nd Interview - Credit Analyst Candidate With A Very Long Name For The Meeting List";
    await p.eval(`new Promise((resolve, reject) => {
      const req = indexedDB.open("prodli-meetings", 1);
      req.onsuccess = () => {
        const tx = req.result.transaction(["meetings", "audio"], "readwrite");
        const now = new Date();
        tx.objectStore("meetings").put({
          id: "mtg_long", platform: "google-meet", title: ${JSON.stringify(longTitle)}, meetingCode: "xyz-abcd-efg",
          url: "https://meet.google.com/xyz-abcd-efg", startedAt: now.toISOString(), endedAt: now.toISOString(),
          durationSec: 2940, status: "ready", error: null, notice: null, hasAudio: true, micIncluded: true, audioMimeType: "audio/webm;codecs=opus", updatedAt: now.toISOString(),
          transcript: [{ id: "1", speaker: "You", text: "Hello.", startMs: 0, endMs: 1000 }], summary: null,
        });
        tx.objectStore("audio").put(new Blob([new Uint8Array([26, 69, 223, 163])], { type: "audio/webm" }), "mtg_long");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
    })`);
    await p.goto("meetings");
    await sleep(800);
    const fits = await p.eval(`(() => {
      const list = document.querySelector(".meetings-list");
      const item = [...list.querySelectorAll("button")].find(b => b.textContent.includes("2nd Interview"));
      const title = item.firstElementChild;
      return { fits: item.getBoundingClientRect().right <= list.getBoundingClientRect().right + 0.5, cut: title.scrollWidth > title.clientWidth, hover: item.title };
    })()`);
    check("Meetings: a long name stays inside the list, cut off with …", fits.fits && fits.cut && fits.hover === longTitle, JSON.stringify(fits));
    await p.eval(`[...document.querySelectorAll(".meetings-list button")].find(b => b.textContent.includes("2nd Interview")).click()`);
    await sleep(800);
    const dl = await p.eval(`(() => { const a = [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Download audio"); return a ? { name: a.getAttribute("download"), href: a.href } : null; })()`);
    check("Meetings: Download audio saves the recording with the meeting's name", dl?.name === longTitle + "-audio.webm" && dl.href.startsWith("blob:"), JSON.stringify(dl));
    await p.close();
  },

  async transcribe(b, check) {
    // "Transcribe audio with AI": a real WebM/Opus recording made here with
    // MediaRecorder (two 2.5 s tones with pauses), read and cut at the pauses by
    // the app; a stub stands in for /api/ai/transcribe (test builds only).
    const p = await b.openPage();
    await p.goto("meetings");
    const made = await p.eval(`(async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(gain).connect(dest);
      osc.start();
      const t = ctx.currentTime + 0.3;
      for (const [on, off] of [[0.5, 3], [4.5, 7]]) { gain.gain.setValueAtTime(0.4, t + on); gain.gain.setValueAtTime(0, t + off); }
      const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      rec.start(1000);
      // Wait on the audio clock, not wall time: under load the two drift apart and the second tone could be cut off.
      while (ctx.currentTime < t + 8.5) await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      const blob = new Blob(parts, { type: rec.mimeType });
      await new Promise((resolve, reject) => {
        const req = indexedDB.open("prodli-meetings", 1);
        req.onsuccess = () => {
          const tx = req.result.transaction(["meetings", "audio"], "readwrite");
          const now = new Date();
          tx.objectStore("meetings").put({
            id: "mtg_audio", platform: "google-meet", title: "Mixed language call", meetingCode: null, url: "https://meet.google.com/aaa-bbbb-ccc",
            startedAt: new Date(now.getTime() + 60000).toISOString(), endedAt: now.toISOString(), durationSec: 9, status: "ready", error: null, notice: null,
            hasAudio: true, micIncluded: true, audioMimeType: rec.mimeType, updatedAt: now.toISOString(),
            transcript: [{ id: "c1", speaker: "Priya", text: "Garbled caption text", startMs: 500, endMs: 2500 }], summary: null,
          });
          tx.objectStore("audio").put(blob, "mtg_audio");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      });
      return { size: blob.size, type: rec.mimeType };
    })()`);
    check("Transcribe: made a real WebM/Opus recording", made.size > 1000 && /webm/.test(made.type), JSON.stringify(made));
    await p.goto("meetings");
    await p.eval(`[...document.querySelectorAll(".meetings-list button")].find(b => b.textContent.includes("Mixed language call")).click()`);
    await sleep(800);
    const stub = (mode = "ok") =>
      p.eval(`(() => {
        window.__pieces = [];
        globalThis.__prodliTranscribeStub = async (wav, startMs, vocabulary) => {
          const seconds = (wav.length - 44) / 32000;
          const n = window.__pieces.push({ startMs, seconds, riff: String.fromCharCode(...wav.slice(0, 4)), vocabulary });
          await new Promise((r) => setTimeout(r, 100));
          if (${JSON.stringify(mode)} === "fail") throw new Error("boom");
          return { text: n === 1 ? "Kumusta, simulan na natin." : "Okay, let's review the numbers.", segments: [{ start: 0.2, end: 1.8, text: n === 1 ? "Kumusta, simulan na natin." : "Okay, let's review the numbers." }], language: n === 1 ? "tl" : "en", usage: { usedSeconds: 6 * n, limitSeconds: 18000 } };
        };
        return true;
      })()`);
    const panel = () => p.eval(`document.querySelector('[data-testid="audio-transcribe"]')?.innerText ?? ""`);
    check("Transcribe: the button shows under the audio", /transcribe audio with ai/i.test(await panel()) && (await panel()).includes("more than one language"), await panel());

    await stub("fail");
    await p.click("🌐 Transcribe audio with AI");
    await sleep(2500);
    check("Transcribe: a failure shows a message and keeps the captions", /went wrong|try again/i.test(await panel()) && (await p.text()).includes("Garbled caption text"), await panel());

    await stub();
    await p.eval(`chrome.storage.local.set({ recorderVocabulary: ["Kumusta Corp", "DSR"] })`);
    await p.click("🌐 Transcribe audio with AI");
    await sleep(300);
    const during = await panel();
    await sleep(3500);
    const pieces = await p.eval("window.__pieces");
    check("Transcribe: shows progress while working", during.includes("Transcribing the audio") || pieces.length > 0, during);
    check("Transcribe: the recording is cut at the pause into two WAV pieces", pieces.length === 2 && pieces.every((x) => x.riff === "RIFF" && x.seconds > 2.2 && x.seconds < 3.6), JSON.stringify(pieces));
    check("Transcribe: the word list goes with every piece (spelling hint for Whisper)", pieces.every((x) => JSON.stringify(x.vocabulary) === '["Kumusta Corp","DSR"]'), JSON.stringify(pieces.map((x) => x.vocabulary)));
    await p.eval(`chrome.storage.local.remove("recorderVocabulary")`);
    const starts = pieces.map((x) => x.startMs).sort((a, b) => a - b);
    check("Transcribe: pieces start where the speech starts", Math.abs(starts[0] - 600) < 450 && Math.abs(starts[1] - 4600) < 450, JSON.stringify(starts));
    const text = await p.text();
    check("Transcribe: the transcript is replaced by the audio transcript", text.includes("Kumusta, simulan na natin.") && text.includes("Okay, let's review the numbers.") && !text.includes("Garbled caption text"));
    check("Transcribe: says which languages it heard", (await panel()).includes("Filipino") && (await panel()).includes("English"), await panel());
    const saved = await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const g = req.result.transaction("meetings").objectStore("meetings").get("mtg_audio"); g.onsuccess = () => resolve(g.result); }; })`);
    check("Transcribe: saved, with the captions kept for switching back", saved.transcriptSource === "audio" && saved.transcript.length === 2 && saved.transcript[0].source === "audio" && saved.captionTranscript?.[0]?.text === "Garbled caption text" && saved.audioLanguages.join() === "tl,en", JSON.stringify({ src: saved.transcriptSource, cap: saved.captionTranscript, langs: saved.audioLanguages }));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8") + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="audio-transcribe"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): the transcribe panel has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("transcribe-audio");
    await p.click("Use Meet captions instead");
    await sleep(400);
    const back = await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const g = req.result.transaction("meetings").objectStore("meetings").get("mtg_audio"); g.onsuccess = () => resolve({ src: g.result.transcriptSource, t: g.result.transcript.map(e => e.text) }); }; })`);
    check("Transcribe: Use Meet captions instead brings the captions back", (await p.text()).includes("Garbled caption text") && !(await p.text()).includes("Kumusta, simulan"), JSON.stringify(back) + " | " + (await p.text()).slice(-400));
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

    // Opt-in heads-up: posted in Meet's chat when recording starts (chat panel closed at first).
    const chat = await b.openPage("about:blank");
    await chat.eval(`
      document.title = "Meet - Client call";
      document.body.innerHTML = '<button aria-label="Leave call">x</button><div role="region" aria-label="Captions" id="cap"></div><button aria-label="Chat with everyone" id="chatBtn">chat</button>';
      window.__chat = [];
      document.getElementById('chatBtn').addEventListener('click', () => {
        if (document.querySelector('aside')) return;
        const a = document.createElement('aside');
        a.innerHTML = '<textarea aria-label="Send a message"></textarea><button aria-label="Send a message" id="send">send</button>';
        document.body.appendChild(a);
        a.querySelector('#send').addEventListener('click', () => { const t = a.querySelector('textarea'); window.__chat.push(t.value); t.value = ''; });
      });
      window.__sent = []; window.__listeners = [];
      window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); }, onMessage: { addListener: (f) => window.__listeners.push(f), removeListener: () => {} } } };
      true`);
    await chat.eval(script + ";true");
    await chat.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "start", meetingId: "m3", startedAtMs: Date.now(), disclosure: "Heads-up: I'm taking AI notes." }, {}, r))`);
    await sleep(1500);
    check("Captions: heads-up posted in the Meet chat (opt-in)", JSON.stringify(await chat.eval(`window.__chat`)) === JSON.stringify(["Heads-up: I'm taking AI notes."]));
    await chat.eval(`new Promise(r => window.__listeners[0]({ target: "captions", type: "stop" }, {}, r))`);
    // No chat on the page: an on-page note asks the user to paste it.
    await chat.eval(`document.getElementById('chatBtn').remove(); document.querySelector('aside').remove(); true`);
    await chat.eval(script + ";true");
    await chat.eval(`new Promise(r => window.__listeners.at(-1)({ target: "captions", type: "start", meetingId: "m4", startedAtMs: Date.now(), disclosure: "Heads-up" }, {}, r))`);
    await sleep(4000);
    check("Captions: says so when the heads-up can't be posted", await chat.eval(`!!document.querySelector('[data-prodli-chat-note]')`));
    await chat.close();

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

  async notion(b, check) {
    // Editor, Notion-style: callouts, toggles, [[note links]], block handle (move / turn into / duplicate), colours, page icon and cover.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const now = new Date().toISOString();
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, notes: [
      { id: "nb1", title: "Plan", content: "<h1>Plan</h1><p>First line</p><p>Second line</p>", createdAt: "${now}", updatedAt: "${now}" },
      { id: "nb2", title: "Copy deck", content: "<h1>Copy deck</h1><p>Words</p>", createdAt: "${now}", updatedAt: "${now}" }
    ], activeNoteId: "nb1" })`);
    await p.goto("editor");
    await sleep(900);
    const saved = async (id = "nb1") => ((await p.storage(["notes"])).notes ?? []).find((n) => n.id === id);
    const html = () => p.editorHtml();

    // / → Callout and / → Toggle list.
    await p.focusEditor();
    await p.key("Enter");
    await p.type("/callout");
    await sleep(200);
    await p.key("Enter");
    await p.type("Remember the deadline");
    await sleep(200);
    check("Notion: / → Callout makes a callout with an icon", /data-type="callout"/.test(await html()) && (await html()).includes("Remember the deadline"), (await html()).slice(0, 400));
    await p.focusEditor();
    await p.key("Enter");
    await p.type("/toggle");
    await sleep(200);
    await p.key("Enter");
    await p.type("Details");
    await sleep(900);
    const afterBlocks = await saved();
    check("Notion: / → Toggle list makes a toggle, and both save", /<details/.test(afterBlocks?.content ?? "") && /data-type="callout"/.test(afterBlocks?.content ?? ""), afterBlocks?.content);

    // [[ → link to another note; clicking it opens that note.
    await p.focusEditor();
    await p.key("Enter");
    await p.type("See [[Cop");
    await sleep(250);
    const picker = await p.eval(`document.querySelector('[data-note-picker]')?.innerText ?? ""`);
    check("Notion: [[ shows matching notes to link", picker.includes("Copy deck") && !picker.includes("Plan"), picker);
    await p.eval(axeSource + ";true");
    const pv = await p.eval(`axe.run(document.querySelector('[data-note-picker]'), { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id))`);
    check("A11y: note link picker has no serious problems", pv.length === 0, pv.join(", "));
    await p.key("Enter");
    await sleep(900);
    const linked = await saved();
    check("Notion: picking a note inserts a link to it", /data-type="note-link"[^>]*data-note-id="nb2"|data-note-id="nb2"[^>]*data-type="note-link"/.test(linked?.content ?? "") && !(linked?.content ?? "").includes("[[Cop"), linked?.content);
    await p.eval(`document.querySelector('.tiptap .note-link a')?.click()`);
    await sleep(500);
    check("Notion: clicking a note link opens that note", (await html()).includes("Words") && !(await html()).includes("Remember the deadline"));
    await p.eval(`document.querySelector('[data-note-id="nb1"]').click()`);
    await sleep(600);

    // Block handle: hover a block → ⋮⋮ → Move down / Turn into / Duplicate.
    const hoverText = async (text) => {
      const r = await p.eval(`(() => { const el = [...document.querySelectorAll(".tiptap > *")].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + 20, y: b.top + 6 }; })()`);
      if (r) await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
      await sleep(250);
      return !!r;
    };
    const order = () => p.eval(`[...document.querySelectorAll(".tiptap > p")].map((x) => x.textContent.trim()).filter(Boolean)`);
    await hoverText("First line");
    check("Notion: hovering a block shows + and ⋮⋮", await p.eval(`!!document.querySelector('[data-testid="block-handle"] [aria-label="Add a block below"]')`));
    await p.eval(`document.querySelector('[data-testid="block-handle"] [aria-haspopup="menu"]').click()`);
    await sleep(250);
    const menuText = await p.eval(`document.querySelector('[data-testid="block-menu"]')?.innerText ?? ""`);
    check("Notion: ⋮⋮ opens the block menu", /Turn into/.test(menuText) && /Duplicate/.test(menuText) && /Move down/.test(menuText) && /Delete/.test(menuText), menuText);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(120);
      const mv = await p.eval(`axe.run(document.querySelector('[data-testid="block-menu"]'), { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): block menu has no serious problems`, mv.length === 0, mv.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`[...document.querySelectorAll('[data-testid="block-menu"] button')].find((x) => /Move down/.test(x.textContent)).click()`);
    await sleep(300);
    const moved = await order();
    check("Notion: Move down swaps the block with the next one", moved.indexOf("Second line") >= 0 && moved.indexOf("Second line") < moved.indexOf("First line"), JSON.stringify(moved));
    // Keyboard: Alt+Shift+↑ moves it back.
    await p.eval(`(() => { const el = [...document.querySelectorAll(".tiptap > p")].find((x) => x.textContent.trim() === "First line"); const r = document.createRange(); r.setStart(el.firstChild, 2); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector(".ProseMirror").focus(); return true; })()`);
    await sleep(150);
    await p.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 1 | 8 });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 1 | 8 });
    await sleep(250);
    const back = await order();
    check("Notion: Alt+Shift+↑ moves the block back up", back.indexOf("First line") < back.indexOf("Second line"), JSON.stringify(back));
    await hoverText("First line");
    await p.eval(`document.querySelector('[data-testid="block-handle"] [aria-haspopup="menu"]').click()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[data-testid="block-menu"] button')].find((x) => /Turn into/.test(x.textContent)).click()`);
    await sleep(150);
    await p.eval(`[...document.querySelectorAll('[data-testid="block-menu"] button')].find((x) => x.textContent.trim().endsWith("Heading 2")).click()`);
    await sleep(250);
    check("Notion: Turn into → Heading 2 changes the block", /<h2[^>]*>First line<\/h2>/.test(await html()), (await html()).slice(0, 300));
    await hoverText("Second line");
    await p.eval(`document.querySelector('[data-testid="block-handle"] [aria-haspopup="menu"]').click()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[data-testid="block-menu"] button')].find((x) => /Duplicate/.test(x.textContent)).click()`);
    await sleep(250);
    check("Notion: Duplicate copies the block", (await order()).filter((x) => x === "Second line").length === 2, JSON.stringify(await order()));

    // Drag ⋮⋮: move "First line" (now a heading) below the last paragraph.
    {
      const box = (t) => p.eval(`(() => { const el = [...document.querySelectorAll(".tiptap > *")].find((x) => x.textContent.trim() === ${JSON.stringify(t)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, h: b.height }; })()`);
      const src = await box("First line");
      await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: src.x + 30, y: src.y + 8 });
      await sleep(300);
      const h = await p.eval(`(() => { const el = document.querySelector('[data-testid="block-handle"] [draggable="true"]'); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      const last = await p.eval(`(() => { const ps = [...document.querySelectorAll(".tiptap > p")].filter((x) => x.textContent.trim()); const b = ps[ps.length - 1].getBoundingClientRect(); return { x: b.left + 30, y: b.bottom - 2, text: ps[ps.length - 1].textContent.trim() }; })()`);
      await p.send("Input.setInterceptDrags", { enabled: true });
      const mark = b.events.length;
      await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: h.x, y: h.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 10; i++) {
        await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: h.x + 30, y: h.y + ((last.y - h.y) * i) / 10, button: "left", buttons: 1 });
        await sleep(30);
      }
      const data = b.events.slice(mark).find((e) => e.method === "Input.dragIntercepted")?.params.data;
      if (data) for (const type of ["dragEnter", "dragOver", "drop"]) await p.send("Input.dispatchDragEvent", { type, x: last.x, y: last.y, data });
      await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", clickCount: 1 });
      await p.send("Input.setInterceptDrags", { enabled: false });
      await sleep(400);
      const blocks = await p.eval(`[...document.querySelectorAll(".tiptap > *")].map((x) => x.textContent.trim()).filter(Boolean)`);
      check("Notion: dragging ⋮⋮ moves the block (once, no copy left behind)", !!data && blocks.indexOf("First line") > blocks.indexOf(last.text) && blocks.filter((x) => x === "First line").length === 1, JSON.stringify(blocks));
    }

    // + adds a block below and opens the / menu.
    await hoverText("Second line");
    await p.eval(`document.querySelector('[data-testid="block-handle"] [aria-label="Add a block below"]').click()`);
    await sleep(250);
    check("Notion: + adds a block below with the / menu open", await p.eval(`!!document.querySelector('[data-slash-menu]')`));
    await p.key("Escape");

    // Colours: select text → A → Red text.
    await p.eval(`(() => { const el = [...document.querySelectorAll(".tiptap > p")].find((x) => x.textContent.trim() === "Second line"); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector(".ProseMirror").focus(); return true; })()`);
    await sleep(350);
    await p.eval(`document.querySelector('[aria-label="Text colour"]')?.click()`);
    await sleep(150);
    await p.eval(`document.querySelector('[data-color-menu] [aria-label="Red text"]')?.click()`);
    await sleep(900);
    check("Notion: colours text with a theme-aware colour", /color:\s*var\(--note-red\)/.test((await saved())?.content ?? ""), (await saved())?.content);

    // Page icon and cover.
    await p.eval(`[...document.querySelectorAll('[data-testid="page-head"] button')].find((x) => /Add icon/.test(x.textContent))?.click()`);
    await p.eval(`[...document.querySelectorAll('[data-testid="page-head"] button')].find((x) => /Add cover/.test(x.textContent))?.click()`);
    await sleep(800);
    const withIcon = await saved();
    check("Notion: Add icon and Add cover save on the note", !!withIcon?.icon && !!withIcon?.cover, JSON.stringify({ icon: withIcon?.icon, cover: withIcon?.cover }));
    check("Notion: the note list shows the page icon", (await p.eval(`document.querySelector('[data-note-id="nb1"]')?.innerText ?? ""`)).includes(withIcon?.icon ?? "∅"));
    await p.close();
  },

  async improve(b, check) {
    // ✨ Improve (writing help) on selected text. The test build has no ProdLi
    // server, so a stub stands in for /api/ai/rewrite (lib/write.ts, test builds only).
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("editor");
    await p.click("+");
    await sleep(300);
    await p.type("I saw teh plan yesterday.");
    await p.key("Enter");
    await p.type("Second paragraph stays.");
    await sleep(900);
    const select = (text) =>
      p.eval(`(() => {
        const el = document.querySelector(".ProseMirror");
        el.focus();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && !node.data.includes(${JSON.stringify(text)}));
        if (!node) throw new Error("text not found");
        const r = document.createRange();
        const i = node.data.indexOf(${JSON.stringify(text)});
        r.setStart(node, i);
        r.setEnd(node, i + ${JSON.stringify(text)}.length);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return true;
      })()`).then(() => sleep(500)); // the selection menu shows after a short delay
    const panelText = () => p.eval(`document.querySelector('[data-testid="improve-panel"]')?.innerText ?? ""`);
    const panelOpen = () => p.eval(`!!document.querySelector('[data-testid="improve-panel"]')`);
    const stub = (mode = "ok") =>
      p.eval(`(() => {
        window.__rewrites = [];
        globalThis.__prodliRewriteStub = async (action, text) => {
          window.__rewrites.push({ action, text });
          await new Promise((r) => setTimeout(r, 150));
          if (${JSON.stringify(mode)} === "fail") throw new Error("boom");
          if (action === "fix") return { text: text.replace("teh", "the"), changed: text.includes("teh"), usage: { used: window.__rewrites.length, limit: 200 } };
          if (action === "shorter") return { text: "Saw the plan.", changed: true, usage: { used: window.__rewrites.length, limit: 200 } };
          return { text, changed: false, usage: { used: window.__rewrites.length, limit: 200 } };
        };
        return true;
      })()`);
    const audit = async () => {
      await p.eval(axeSource + ";true");
      return p.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + "]" : "")).join(" | ")))`);
    };

    // No server in this copy: a clear message, nothing changes.
    await select("teh plan");
    check("Improve: ✨ Improve shows in the selection menu", await p.eval(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "✨ Improve")`));
    await p.click("✨ Improve");
    await sleep(300);
    const menu = await panelText();
    check("Improve: the menu lists the five actions", ["Fix spelling & grammar", "Make shorter", "Make clearer", "More formal", "Friendlier"].every((x) => menu.includes(x)), menu);
    check("Improve: the selection menu hides while the panel is open", await p.eval(`![...document.querySelectorAll("button")].some(b => b.textContent.trim() === "✨ Improve" && b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden" && getComputedStyle(b).opacity !== "0")`));
    await p.click("Fix spelling & grammar", { exact: false });
    await sleep(400);
    check("Improve: without a ProdLi server it says so", (await panelText()).includes("isn't available in this copy"), await panelText());
    await p.click("Close");
    await sleep(200);
    check("Improve: Close shuts the panel", !(await panelOpen()));

    // Mouse flow: Fix → see what changed → Replace → one undo step.
    await stub();
    await select("I saw teh plan yesterday.");
    await p.click("✨ Improve");
    await sleep(250);
    await p.click("Fix spelling & grammar", { exact: false });
    await sleep(80);
    check("Improve: shows progress while waiting", (await panelText()).includes("Fix spelling & grammar…"));
    await sleep(400);
    const marks = await p.eval(`(() => { const s = document.querySelector('[data-testid="improve-suggestion"]'); return { added: [...(s?.querySelectorAll("mark") ?? [])].map(m => m.textContent), removed: [...(s?.querySelectorAll("del") ?? [])].map(m => m.textContent) }; })()`);
    check("Improve: sends only the selected text, as Markdown", JSON.stringify(await p.eval("window.__rewrites")) === JSON.stringify([{ action: "fix", text: "I saw teh plan yesterday." }]), JSON.stringify(await p.eval("window.__rewrites")));
    check("Improve: Fix marks the changed words", marks.added.join() === "the" && marks.removed.join() === "teh", JSON.stringify(marks));
    check("Improve: shows what's left this month", (await panelText()).includes("199 of 200 left this month"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      const v = await audit();
      check(`A11y (${theme}): the Improve panel has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("improve-suggestion");
    const beforeReplace = await p.editorHtml();
    check("Improve: nothing changes before Replace", beforeReplace.includes("I saw teh plan yesterday."));
    await p.click("Replace");
    await sleep(300);
    let html = await p.editorHtml();
    check("Improve: Replace swaps in the suggestion", html.includes("<p>I saw the plan yesterday.</p><p>Second paragraph stays.</p>"), html);
    check("Improve: Replace offers Undo", (await p.text()).includes("Text replaced"));
    await sleep(900);
    const saved = ((await p.storage(["notes"])).notes ?? []).find((n) => n.content.includes("Second paragraph stays."));
    check("Improve: the replaced text is saved", !!saved?.content.includes("I saw the plan yesterday."));
    await p.focusEditor();
    await p.key("z", { mod: true });
    await sleep(200);
    html = await p.editorHtml();
    check("Improve: one Ctrl/⌘+Z brings the original back", html.includes("<p>I saw teh plan yesterday.</p><p>Second paragraph stays.</p>"), html);

    // Keyboard flow: Ctrl/⌘+J, arrows, Enter; then Insert below.
    await select("I saw teh plan yesterday.");
    await p.key("j", { mod: true });
    await sleep(350);
    const focused = await p.eval(`document.activeElement?.textContent.trim() ?? ""`);
    check("Improve: Ctrl/⌘+J opens the menu with focus on the first action", (await panelOpen()) && focused.includes("Fix spelling & grammar"), focused);
    await p.key("ArrowDown");
    check("Improve: arrow keys move through the actions", (await p.eval(`document.activeElement?.textContent.trim() ?? ""`)).includes("Make shorter"));
    await p.key("Enter");
    await sleep(500);
    check("Improve: Enter runs the focused action", (await panelText()).includes("Saw the plan.") && (await p.eval(`document.activeElement?.textContent.trim()`)) === "Replace");
    await p.click("Insert below");
    await sleep(300);
    html = await p.editorHtml();
    check("Improve: Insert below keeps the original and adds the suggestion after it", html.includes("<p>I saw teh plan yesterday.</p><p>Saw the plan.</p><p>Second paragraph stays.</p>"), html);
    await p.focusEditor();
    await p.key("z", { mod: true });
    await sleep(200);

    // Discard and Escape leave the note alone; "no mistakes" is said plainly.
    await select("Second paragraph stays.");
    await p.key("j", { mod: true });
    await sleep(300);
    await p.key("Enter"); // Fix
    await sleep(500);
    check("Improve: says when there's nothing to fix", (await panelText()).includes("No mistakes found"));
    await p.key("Escape");
    await sleep(200);
    check("Improve: Escape closes the panel", !(await panelOpen()));
    await select("I saw teh plan yesterday.");
    await p.eval(`window.dispatchEvent(new CustomEvent("prodli-improve", { detail: { action: "shorter" } }))`);
    await sleep(600);
    check("Improve: the command palette can run an action on the selection", (await panelText()).includes("Saw the plan."));
    await p.click("Discard");
    await sleep(200);
    html = await p.editorHtml();
    check("Improve: Discard changes nothing", !(await panelOpen()) && html.includes("<p>I saw teh plan yesterday.</p><p>Second paragraph stays.</p>"), html);

    // Select-all (Ctrl/⌘+A) works too.
    await p.focusEditor();
    await p.key("a", { mod: true });
    await sleep(500);
    check("Improve: ✨ Improve shows after select-all (Ctrl/⌘+A)", await p.eval(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "✨ Improve")`));
    await p.key("j", { mod: true });
    await sleep(300);
    await p.key("Enter");
    await sleep(500);
    check("Improve: select-all sends the whole note", (await p.eval("window.__rewrites.at(-1)?.text")) === "I saw teh plan yesterday.\n\nSecond paragraph stays.", JSON.stringify(await p.eval("window.__rewrites.at(-1)")));
    await p.key("Escape");
    await sleep(200);

    // Errors: a message and Try again.
    await stub("fail");
    await select("I saw teh plan yesterday.");
    await p.key("j", { mod: true });
    await sleep(300);
    await p.key("Enter");
    await sleep(500);
    check("Improve: a failed request shows a message and Try again", (await panelText()).includes("Something went wrong") && (await panelText()).includes("Try again"));
    await stub();
    await p.click("Try again");
    await sleep(500);
    check("Improve: Try again works", (await p.eval(`[...document.querySelectorAll('[data-testid="improve-suggestion"] mark')].map(m => m.textContent).join()`)) === "the" && (await panelText()).includes("Replace"));
    // Editing the note meanwhile: Replace refuses rather than overwriting the wrong text.
    await p.focusEditor("start");
    await p.type("Oh! ");
    await sleep(100);
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Replace")?.click()`);
    await sleep(300);
    check("Improve: if the note changed meanwhile, Replace asks to select again", (await panelText()).includes("The note changed"), await panelText());
    await p.click("Close");
    await p.close();
  },

  async repeating(b, check) {
    // Repeating to-dos and reminders (to-dos with a time).
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("todos");
    const typeTask = async (text) => {
      await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(150);
    };
    const enter = async () => {
      await p.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
      await sleep(600);
    };
    const todos = async () => (await p.storage(["todos"])).todos ?? [];
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Quick add with a repeat and a time.
    await typeTask("Water plants every day at 11:58pm");
    const preview = await p.eval(`document.querySelector('[data-testid="smart-add-preview"]')?.innerText ?? ""`);
    check("Repeat: quick add previews the repeat and time", preview.includes("Every day") && /11:58|23:58/.test(preview), preview);
    await enter();
    let t = (await todos()).find((x) => x.title === "Water plants");
    check("Repeat: quick add saves the repeat, time and today's date", t?.repeat?.unit === "day" && t?.dueTime === "23:58" && t?.dueDate === dayKey(new Date()), JSON.stringify(t));
    check("Repeat: the task shows 🔁 and ⏰", await p.eval(`(() => { const row = [...document.querySelectorAll(".todo-row")].find(r => r.innerText.includes("Water plants")); return !!row && !!row.querySelector('[data-testid="repeat-badge"]') && row.innerText.includes("⏰"); })()`));

    // The background schedules a reminder for it.
    await sleep(800);
    const alarms = await p.eval(`chrome.alarms.getAll().then(a => a.map(x => x.name))`);
    check("Reminder: an alarm is set for the task's time", alarms.includes(`task:${t.id}`), JSON.stringify(alarms));

    // Completing it moves it to tomorrow and keeps a done copy.
    await p.eval(`[...document.querySelectorAll('button[role="checkbox"]')].find(b => b.getAttribute("aria-label") === "Mark done: Water plants").click()`);
    await sleep(800);
    const all = (await todos()).filter((x) => x.title === "Water plants");
    const open = all.find((x) => !x.completed);
    const done = all.find((x) => x.completed);
    check("Repeat: completing moves it to its next date", open?.id === t.id && open?.dueDate === dayKey(new Date(Date.now() + 86_400_000)) && open?.dueTime === "23:58", JSON.stringify(all));
    check("Repeat: and keeps a completed copy for the review", !!done && done.id !== t.id && !done.repeat && !!done.completedAt, JSON.stringify(done));
    await sleep(800);
    const alarms2 = await p.eval(`chrome.alarms.getAll().then(a => a.map(x => x.name))`);
    check("Reminder: the alarm follows the task to its next date", alarms2.includes(`task:${t.id}`), JSON.stringify(alarms2));

    // The ✎ editor: change the repeat and time of an existing task.
    await typeTask("Pay invoices");
    await enter();
    await p.eval(`document.querySelector('button[aria-label="Edit details: Pay invoices"]').click()`);
    await sleep(300);
    check("Details: ✎ opens the date/time/repeat editor", await p.eval(`!!document.querySelector('[data-testid="task-details"]')`));
    await p.eval(`(() => { const sel = document.querySelector('[data-testid="task-details"] select[aria-label="Repeat"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "month"); sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(500);
    t = (await todos()).find((x) => x.title === "Pay invoices");
    check("Details: setting a repeat gives it a start date", t?.repeat?.unit === "month" && t?.dueDate === dayKey(new Date()) && t?.repeat?.monthDay === new Date().getDate(), JSON.stringify(t));
    await p.eval(`(() => { const sel = document.querySelector('[data-testid="task-details"] select[aria-label="Repeat"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "custom"); sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(300);
    await p.eval(`(() => { const sel = document.querySelector('[data-testid="task-details"] select[aria-label="Repeat unit"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "week"); sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(300);
    for (const day of ["Tuesday", "Thursday"]) await p.eval(`document.querySelector('[data-testid="task-details"] button[aria-label="${day}"]').click()`);
    await sleep(500);
    t = (await todos()).find((x) => x.title === "Pay invoices");
    check("Details: a custom rule on chosen weekdays", t?.repeat?.unit === "week" && JSON.stringify(t?.repeat?.weekdays) === "[2,4]", JSON.stringify(t?.repeat));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="task-details"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): the task editor has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("task-details");
    // Reminders can be switched off in Settings.
    await p.eval(`chrome.storage.local.get("todaySettings").then(r => chrome.storage.local.set({ todaySettings: { ...(r.todaySettings ?? {}), taskReminders: false } }))`);
    await sleep(800);
    const off = await p.eval(`chrome.alarms.getAll().then(a => a.filter(x => x.name.startsWith("task:")).length)`);
    check("Reminder: turning reminders off clears them", off === 0, String(off));
    await p.eval(`chrome.storage.local.get("todaySettings").then(r => chrome.storage.local.set({ todaySettings: { ...(r.todaySettings ?? {}), taskReminders: true } }))`);
    await p.eval(`chrome.storage.local.set({ todos: [] })`);
    await p.close();
  },

  async lists(b, check) {
    // Lists (projects), labels and saved filters on the To-do page.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
    await p.eval(`localStorage.removeItem("prodli_todo_selection")`);
    await p.goto("todos");
    const add = async (text) => {
      await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Add a new task"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(150);
      await p.eval(`document.querySelector('input[placeholder^="Add a new task"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
      await sleep(600);
    };
    const nav = (id) => p.eval(`document.querySelector('[data-testid="${id}"]').click()`).then(() => sleep(300));
    const titles = () => p.eval(`[...document.querySelectorAll(".todo-title")].map(e => e.textContent)`);
    const store = async () => p.storage(["todos", "lists"]);
    const answer = (prompt, confirm = true) => p.eval(`(() => { window.prompt = () => ${JSON.stringify(prompt)}; window.confirm = () => ${confirm}; return true; })()`);

    await add("Buy milk #Groceries @errands");
    await add("Write report");
    let { todos = [], lists = [] } = await store();
    const groceries = lists.find((l) => l.kind === "list" && l.name === "Groceries");
    check("Lists: #Groceries in quick add creates the list", !!groceries && todos.find((t) => t.title === "Buy milk")?.listId === groceries?.id, JSON.stringify(lists));
    check("Lists: @errands becomes a label", JSON.stringify(todos.find((t) => t.title === "Buy milk")?.labels) === '["errands"]');
    check("Lists: the side panel shows the list and the label", await p.eval(`!!document.querySelector('[data-testid="nav-list-Groceries"]') && !!document.querySelector('[data-testid="nav-label-errands"]')`));
    check("Lists: tasks show their list and labels in All tasks", await p.eval(`(() => { const row = [...document.querySelectorAll(".todo-row")].find(r => r.innerText.includes("Buy milk")); return !!row?.querySelector('[data-testid="list-chip"]') && row.innerText.includes("@errands"); })()`));

    await nav("nav-list-Groceries");
    check("Lists: a list shows only its tasks", JSON.stringify(await titles()) === '["Buy milk"]', JSON.stringify(await titles()));
    await add("Eggs !high");
    ({ todos = [] } = await store());
    check("Lists: adding while viewing a list puts the task in it", todos.find((t) => t.title === "Eggs")?.listId === groceries.id);
    await nav("nav-inbox");
    check("Lists: the Inbox shows tasks without a list", JSON.stringify(await titles()) === '["Write report"]', JSON.stringify(await titles()));
    await nav("nav-label-errands");
    await add("Post office");
    ({ todos = [] } = await store());
    check("Labels: adding while viewing a label adds the label", JSON.stringify(todos.find((t) => t.title === "Post office")?.labels) === '["errands"]');
    check("Labels: a label shows only its tasks", JSON.stringify((await titles()).sort()) === '["Buy milk","Post office"]', JSON.stringify(await titles()));

    // Save view: the Groceries list + High priority becomes a saved filter.
    await nav("nav-list-Groceries");
    await p.click("🔴 High");
    await sleep(200);
    await answer("Urgent groceries");
    await p.click("☆ Save view");
    await sleep(600);
    ({ lists = [] } = await store());
    const f = lists.find((l) => l.kind === "filter");
    check("Filters: Save view stores the list, priority and name", f?.name === "Urgent groceries" && f?.query?.list === groceries.id && f?.query?.priority === "high", JSON.stringify(f));
    check("Filters: the saved filter is selected and shows its tasks", (await p.eval(`document.querySelector('[data-testid="todo-view-title"]').textContent`)).includes("Urgent groceries") && JSON.stringify(await titles()) === '["Eggs"]', JSON.stringify(await titles()));

    // Move a task to another list from the ✎ editor.
    await nav("nav-all");
    await p.eval(`document.querySelector('button[aria-label="Edit details: Write report"]').click()`);
    await sleep(300);
    await p.eval(`(() => { const sel = document.querySelector('[data-testid="task-details"] select[id$="-list"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, ${JSON.stringify(groceries.id)}); sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(500);
    ({ todos = [] } = await store());
    check("Lists: the ✎ editor moves a task to a list", todos.find((t) => t.title === "Write report")?.listId === groceries.id);

    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector(".todo-body"), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + "]" : "")).join(" | ")))`);
      check(`A11y (${theme}): lists, labels and filters have no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("todo-lists");

    // Delete the list: its tasks move to the Inbox.
    await answer("", true);
    await p.eval(`document.querySelector('button[aria-label="Rename or delete list Groceries"]').click()`);
    await sleep(600);
    ({ todos = [], lists = [] } = await store());
    check("Lists: deleting a list moves its tasks to the Inbox", !lists.some((l) => l.kind === "list") && todos.every((t) => !t.listId), JSON.stringify({ lists, ids: todos.map((t) => t.listId) }));
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
    await p.eval(`localStorage.removeItem("prodli_todo_selection")`);
    await p.close();
  },

  async quickadd(b, check) {
    // Full quick add from ⌘K and the Quick add window (dates, times, repeats, #list, @labels).
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
    await p.goto("today");
    const setValue = (sel, text) => p.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); const proto = i.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await p.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
    await sleep(300);
    await setValue('input[placeholder^="Go to, do"]', "Pay rent monthly Dec 1 #Home @bills at 9am !high");
    await sleep(300);
    const entry = await p.eval(`[...document.querySelectorAll('[role="option"], button, li')].map(e => e.textContent).find(t => t && t.includes("Add to-do:")) ?? ""`);
    check("Quick add: ⌘K shows how it reads the phrase", entry.includes("“Pay rent”") && entry.includes("Every month") && entry.includes("📁 Home") && entry.includes("@bills"), entry);
    await p.eval(`[...document.querySelectorAll('[role="option"], button, li')].find(e => e.textContent && e.textContent.includes("Add to-do:") && e.children.length < 6).click()`);
    await sleep(800);
    let { todos = [], lists = [] } = await p.storage(["todos", "lists"]);
    const rent = todos.find((t) => t.title === "Pay rent");
    const home = lists.find((l) => l.name === "Home");
    check("Quick add: ⌘K saves date, time, repeat, list, label and priority", !!rent && rent.dueDate?.endsWith("-12-01") && rent.dueTime === "09:00" && rent.repeat?.unit === "month" && rent.priority === "high" && rent.listId === home?.id && rent.labels?.[0] === "bills", JSON.stringify({ rent, lists }));

    // The Quick add window (sidebar ➕) previews the phrase too.
    await p.eval(`document.querySelector('button[title="Quick add a to-do or note"]').click()`);
    await sleep(300);
    await setValue('input[aria-label="Title"]', "Call dentist tomorrow at 4pm #Home");
    await sleep(200);
    const preview = await p.eval(`document.querySelector('[data-testid="quickadd-preview"]')?.innerText ?? ""`);
    check("Quick add: the Quick add window previews the phrase", preview.includes("Tomorrow") && /4:00|16:00/.test(preview) && preview.includes("Home"), preview);
    await p.click("Save");
    await sleep(800);
    ({ todos = [], lists = [] } = await p.storage(["todos", "lists"]));
    const dentist = todos.find((t) => t.title === "Call dentist");
    check("Quick add: the window saves into the existing list (no duplicate)", dentist?.dueTime === "16:00" && dentist?.listId === home?.id && lists.filter((l) => l.kind === "list").length === 1, JSON.stringify({ dentist, lists }));
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
    await p.close();
  },

  async focusblock(b, check) {
    // Focus blocking: a blocked site goes to the pause page during a focus session,
    // "Continue anyway" waits and then allows it, schedules and the settings panel.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<title>Distracting</title><h1>Distracting site</h1>");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const site = `http://127.0.0.1:${server.address().port}/feed`;
    const p = await b.openPage();
    await p.goto("pomodoro");
    check("Focus: the block panel shows on the Pomodoro page", await p.eval(`!!document.querySelector('[data-testid="focus-block"]')`));
    // Add the site from the panel and turn blocking on.
    await p.eval(`(() => { const i = document.querySelector('input[aria-label="Site to block"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "127.0.0.1"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(100);
    await p.eval(`document.querySelector('[data-testid="focus-block"] form button[type="submit"]').click()`);
    await sleep(400);
    let { focusBlock } = await p.storage(["focusBlock"]);
    check("Focus: adding a site saves it and turns blocking on", focusBlock?.enabled === true && focusBlock.sites.includes("127.0.0.1") && focusBlock.duringPomodoro === true, JSON.stringify(focusBlock));
    await p.shot("focus-panel");
    check("Focus: the timer's top stays visible (the column scrolls)", await p.eval(`(() => { const t = [...document.querySelectorAll("button")].find(b => /START|PAUSE/.test(b.textContent)); const r = t.getBoundingClientRect(); return r.top >= 0; })()`));
    check("Focus: the panel says it isn't blocking yet", /not blocking right now/i.test(await p.eval(`document.querySelector('[data-testid="focus-block"]').innerText`)));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="focus-block"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + "]" : "")).join(" | ")))`);
      check(`A11y (${theme}): the block panel has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);

    // Not blocked without a session.
    const free = await b.openPage(site);
    await sleep(800);
    check("Focus: the site opens normally outside focus time", (await free.eval("location.href")).startsWith("http://127.0.0.1"));
    await free.close();

    // Start a focus session: the site goes to the pause page.
    await p.eval(`chrome.storage.local.set({ pomodoroTimer: { phase: "work", running: true, endsAt: Date.now() + 20 * 60000, remaining: 1500, label: "Focus", lastCompletedAt: null, lastCompletedPhase: null } })`);
    await sleep(600);
    check("Focus: the panel says it's blocking during the session", /blocking now: focus session/i.test(await p.eval(`document.querySelector('[data-testid="focus-block"]').innerText`)));
    const blocked = await b.openPage(site);
    await sleep(1500);
    const href = await blocked.eval("location.href");
    check("Focus: during a focus session the site goes to the pause page", href.includes("#blocked?") && href.includes("r=pomodoro") && href.includes(encodeURIComponent(site)), href);
    const text = await blocked.eval(`document.body.innerText`);
    check("Focus: the pause page explains why and offers Close tab", text.includes("127.0.0.1") && /focus session: \d+ min to go/.test(text) && /close tab/i.test(text), text.slice(0, 200));
    await blocked.shot("pause-page");
    for (const theme of ["light", "dark"]) {
      await blocked.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await blocked.eval(axeSource + ";true");
      const v = await blocked.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): the pause page has no serious problems`, v.length === 0, v.join(", "));
    }
    // Continue anyway: a wait, then the site for 5 minutes.
    await blocked.click("Continue anyway");
    await sleep(500);
    check("Focus: Continue anyway makes you wait first", /take a breath/i.test(await blocked.eval("document.body.innerText")));
    await sleep(10_500);
    await blocked.eval(`[...document.querySelectorAll("button")].find(x => /^Open .* for 5 minutes$/.test(x.textContent.trim())).click()`);
    await sleep(1500);
    check("Focus: after the wait the site opens and stays open", (await blocked.eval("location.href")).startsWith("http://127.0.0.1"), await blocked.eval("location.href"));
    await blocked.close();
    const { focusBlockStats } = await p.storage(["focusBlockStats"]);
    check("Focus: pauses are counted for today", Object.values(Object.values(focusBlockStats ?? {})[0] ?? {})[0] >= 1, JSON.stringify(focusBlockStats));

    // Close tab closes it.
    await p.eval(`chrome.storage.session.set({ focusPasses: {} })`);
    const again = await b.openPage(site);
    await sleep(1500);
    const before = (await b.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").length;
    await again.eval(`[...document.querySelectorAll("button")].find(x => /close tab/i.test(x.textContent)).click()`).catch(() => {});
    await sleep(800);
    const after = (await b.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page").length;
    check("Focus: Close tab closes the tab", after === before - 1, `${before} → ${after}`);

    // Strict mode: no Continue anyway, and the panel is locked while blocking.
    await p.eval(`chrome.storage.local.get("focusBlock").then(r => chrome.storage.local.set({ focusBlock: { ...r.focusBlock, strict: true } }))`);
    await p.eval(`chrome.storage.session.set({ focusPasses: {} })`);
    await sleep(500);
    check("Focus: strict mode locks the panel during a session", /strict mode: you can change these/i.test(await p.eval(`document.querySelector('[data-testid="focus-block"]').innerText`)) && (await p.eval(`document.querySelector('[data-testid="focus-block"] input[type="checkbox"]').disabled`)));
    const strictTab = await b.openPage(site);
    await sleep(1500);
    const strictText = await strictTab.eval("document.body.innerText");
    check("Focus: strict mode removes Continue anyway", /strict mode is on/i.test(strictText) && !/continue anyway/i.test(strictText), strictText.slice(0, 200));
    await strictTab.close();
    await p.eval(`chrome.storage.local.get("focusBlock").then(r => chrome.storage.local.set({ focusBlock: { ...r.focusBlock, strict: false } }))`);
    await sleep(300);
    // Focus hours: a schedule that covers now blocks without a session.
    await p.eval(`chrome.storage.local.set({ pomodoroTimer: { phase: "work", running: false, endsAt: null, remaining: 1500, label: "Focus", lastCompletedAt: null, lastCompletedPhase: null } })`);
    const d = new Date();
    const hh = (x) => String(x).padStart(2, "0");
    focusBlock = { ...focusBlock, schedules: [{ id: "s", days: [d.getDay()], start: `${hh(d.getHours())}:00`, end: `${hh((d.getHours() + 1) % 24)}:59` }] };
    await p.eval(`chrome.storage.local.set({ focusBlock: ${JSON.stringify(focusBlock)} })`);
    await sleep(500);
    const sched = await b.openPage(site);
    await sleep(1500);
    check("Focus: focus hours block the site without a session", (await sched.eval("location.href")).includes("r=schedule"), await sched.eval("location.href"));
    await sched.close();
    await p.eval(`chrome.storage.local.remove(["focusBlock", "focusBlockStats"])`);
    await p.close();
    server.close();
  },

  async tabsessions(b, check) {
    // Saved tabs on Today: save this window's tabs (and close them), reopen them later.
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ tabSessions: [] })`);
    await p.goto("today");
    check("Tabs: the Saved tabs card shows on Today", await p.eval(`!!document.querySelector('[data-testid="tab-sessions"]')`));
    // Two web pages in the same window as ProdLi.
    const wid = await p.eval(`chrome.windows.getCurrent().then(w => w.id)`);
    await p.eval(`Promise.all(["/one", "/two"].map(path => chrome.tabs.create({ windowId: ${wid}, url: "${base}" + path, active: false })))`);
    await sleep(1500);
    const pages = () => p.eval(`chrome.tabs.query({}).then(t => t.filter(x => x.url && x.url.startsWith("${base}")).length)`);
    check("Tabs: two test pages are open", (await pages()) === 2, String(await pages()));
    await p.click("Save this window");
    await sleep(1200);
    const { tabSessions = [] } = await p.storage(["tabSessions"]);
    check("Tabs: Save this window stores the web pages (not ProdLi)", tabSessions.length === 1 && tabSessions[0].tabs.length === 2 && tabSessions[0].tabs.every((t) => t.url.startsWith(base)), JSON.stringify(tabSessions));
    check("Tabs: and closes them, keeping ProdLi open", (await pages()) === 0 && (await p.eval("location.href")).includes("index.html"));
    check("Tabs: the session is listed with its tab count", /2 tabs/.test(await p.eval(`document.querySelector('[data-testid="tab-session"]')?.innerText ?? ""`)));
    // Expand and open one tab; then open all.
    await p.eval(`document.querySelector('[data-testid="tab-session"] button[aria-expanded]').click()`);
    await sleep(300);
    check("Tabs: expanding lists the site names", (await p.eval(`document.querySelector('[data-testid="tab-session"]').innerText`)).includes("127.0.0.1"));
    await p.eval(`[...document.querySelectorAll('[data-testid="tab-session"] button')].find(x => x.getAttribute("aria-label")?.startsWith("Open all tabs")).click()`);
    await sleep(2000);
    check("Tabs: Open all reopens every tab", (await pages()) === 2, String(await pages()));
    await p.eval(`chrome.tabs.query({}).then(t => chrome.tabs.remove(t.filter(x => x.url && x.url.startsWith("${base}")).map(x => x.id)))`);
    await sleep(500);
    // Delete the session.
    await p.eval(`(() => { window.confirm = () => true; return true; })()`);
    await p.eval(`[...document.querySelectorAll('[data-testid="tab-session"] button')].find(x => x.getAttribute("aria-label")?.startsWith("Delete")).click()`);
    await sleep(600);
    check("Tabs: deleting removes the session", ((await p.storage(["tabSessions"])).tabSessions ?? []).length === 0);
    await p.close();
    server.close();
  },

  async quicklinks(b, check) {
    // Web search (default engine via chrome.search) and quick links on Today.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const server = http.createServer((_req, res) => (res.writeHead(200, { "Content-Type": "text/html" }), res.end("<title>Target</title>ok")));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const target = `http://127.0.0.1:${server.address().port}/landing`;
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ quickLinks: [] })`);
    await p.goto("today");
    const setValue = (sel, text) => p.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    check("Links: Today has a web search box", await p.eval(`!!document.querySelector('input[aria-label="Search the web"]')`));
    // Search goes through Chrome's Search API (the user's default engine).
    await p.eval(`(() => { window.__searches = []; chrome.search.query = async (q) => { window.__searches.push(q); }; return true; })()`);
    await setValue('input[aria-label="Search the web"]', "best pizza near me");
    await p.eval(`document.querySelector('form[role="search"] button[type="submit"]').click()`);
    await sleep(300);
    check("Links: search uses chrome.search with the default engine, in this tab", JSON.stringify(await p.eval("window.__searches")) === JSON.stringify([{ text: "best pizza near me", disposition: "CURRENT_TAB" }]), JSON.stringify(await p.eval("window.__searches")));
    // Add a link.
    await p.click("+ Link");
    await sleep(200);
    await setValue('input[aria-label="Link address"]', target.replace("http://", "http://"));
    await setValue('input[aria-label="Link name"]', "Landing");
    await p.eval(`document.querySelector('[data-testid="quick-links"] form:not([role]) button[type="submit"]').click()`);
    await sleep(500);
    let { quickLinks = [] } = await p.storage(["quickLinks"]);
    check("Links: + Link saves a tile", quickLinks.length === 1 && quickLinks[0].title === "Landing" && quickLinks[0].url === target, JSON.stringify(quickLinks));
    check("Links: the tile links to the address", (await p.eval(`document.querySelector('[data-testid="quick-link"]')?.getAttribute("href")`)) === target);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="quick-links"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): search and links have no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("quick-links");
    // Rename and remove in Edit mode.
    await p.click("Edit");
    await sleep(200);
    await p.eval(`(() => { window.prompt = () => "Home page"; document.querySelector('[data-testid="quick-link"]').click(); return true; })()`);
    await sleep(500);
    ({ quickLinks = [] } = await p.storage(["quickLinks"]));
    check("Links: in Edit mode, clicking a tile renames it (instead of opening it)", quickLinks[0]?.title === "Home page" && (await p.eval("location.href")).includes("index.html"));
    await p.eval(`document.querySelector('button[aria-label="Remove link Home page"]').click()`);
    await sleep(500);
    check("Links: × removes the tile", ((await p.storage(["quickLinks"])).quickLinks ?? []).length === 0);
    // An address typed into search opens directly.
    await p.click("Done").catch(() => {});
    await setValue('input[aria-label="Search the web"]', target);
    await p.eval(`document.querySelector('form[role="search"] button[type="submit"]').click()`);
    await sleep(1200);
    check("Links: typing an address opens it", (await p.eval("location.href")) === target, await p.eval("location.href"));
    await p.close();
    server.close();
  },

  async meetingnotes(b, check) {
    // Meeting types, the word list and the heads-up message.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("meetings");
    check("Meeting notes: Setup has the meeting-notes panel", await p.eval(`!!document.querySelector('[data-testid="meeting-notes-settings"]')`));
    const panelSel = '[data-testid="meeting-notes-settings"]';
    await p.eval(`(() => { const sel = document.querySelector('${panelSel} select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "interview"); sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await p.eval(`(() => { const [w, m] = document.querySelectorAll('${panelSel} textarea'); const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("focusout", { bubbles: true })); }; set(w, "Priya Shah, Flynn\\nDSR"); set(m, "Hi all, ProdLi is taking notes for me."); return true; })()`);
    await sleep(500);
    const st = await p.storage(["recorderDefaultTemplate", "recorderVocabulary", "recorderDisclosure"]);
    check("Meeting notes: the usual type, word list and message are saved", st.recorderDefaultTemplate === "interview" && JSON.stringify(st.recorderVocabulary) === '["Priya Shah","Flynn","DSR"]' && st.recorderDisclosure === "Hi all, ProdLi is taking notes for me.", JSON.stringify(st));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('${panelSel}'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): the meeting-notes panel has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // A meeting can pick its own type.
    await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const tx = req.result.transaction("meetings", "readwrite"); const now = new Date(); tx.objectStore("meetings").put({ id: "mtg_type", platform: "google-meet", title: "Customer call", meetingCode: null, url: "", startedAt: new Date(now.getTime() + 120000).toISOString(), endedAt: now.toISOString(), durationSec: 600, status: "ready", error: null, notice: null, hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: now.toISOString(), transcript: [{ id: "1", speaker: "You", text: "Budget?", startMs: 0, endMs: 1000 }], summary: null }); tx.oncomplete = () => resolve(true); }; })`);
    await p.goto("meetings");
    await p.eval(`[...document.querySelectorAll(".meetings-list button")].find(b => b.textContent.includes("Customer call")).click()`);
    await sleep(500);
    await p.eval(`(() => { const sel = document.querySelector('select[aria-label="Meeting type"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "sales"); sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(500);
    const m = await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const g = req.result.transaction("meetings").objectStore("meetings").get("mtg_type"); g.onsuccess = () => resolve(g.result); }; })`);
    check("Meeting notes: a meeting keeps its own type", m.template === "sales", JSON.stringify(m.template));
    check("Meeting notes: the type menu shows it", (await p.eval(`document.querySelector('select[aria-label="Meeting type"]').value`)) === "sales");
    await p.eval(`chrome.storage.local.remove(["recorderDefaultTemplate", "recorderVocabulary", "recorderDisclosure"])`);
    await p.close();
  },

  async templates(b, check) {
    // Note templates and the daily note.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    await p.eval(`chrome.storage.local.set({ todos: [{ id: "t1", title: "Review the budget", completed: false, plannedFor: "${today}", createdAt: "x" }] })`);
    await p.goto("editor");
    const notes = async () => (await p.storage(["notes"])).notes ?? [];
    // New from a built-in template.
    await p.eval(`document.querySelector('button[aria-label="New note from a template"]').click()`);
    await sleep(300);
    check("Templates: ▾ lists the built-in templates", /Meeting notes[\s\S]*Decision record/.test(await p.eval(`document.querySelector('[data-testid="templates-menu"]').innerText`)));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="templates-menu"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): the templates menu has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`[...document.querySelectorAll('[data-testid="templates-menu"] button')].find(b => b.textContent.includes("1:1")).click()`);
    await sleep(900);
    let html = await p.editorHtml();
    check("Templates: a note from “1:1” has its sections and today's date", html.includes("How are things?") && html.includes("Next steps") && !html.includes("{{"), html.slice(0, 200));
    // Save it as your own template, use it, edit it, delete it.
    const activeId = await p.eval(`chrome.storage.local.get("activeNoteId").then(r => r.activeNoteId)`);
    const title1 = (await notes()).find((n) => n.id === activeId)?.title;
    await p.eval(`document.querySelector(${JSON.stringify(`button[aria-label="Actions for ${title1}"]`)}).click()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent === "Save as template").click()`);
    await sleep(700);
    const tpl = (await notes()).find((n) => n.template);
    check("Templates: ⋯ → Save as template makes a template", !!tpl && tpl.content.includes("How are things?"), JSON.stringify((await notes()).map((n) => [n.title, !!n.template])));
    check("Templates: templates stay out of the note list", !(await p.eval(`document.querySelector(".editor-sidebar").innerText`)).split("Your templates")[0].includes("☆"));
    await p.eval(`document.querySelector('button[aria-label="New note from a template"]').click()`);
    await sleep(300);
    check("Templates: your template shows under Your templates", (await p.eval(`document.querySelector('[data-testid="templates-menu"]').innerText`)).includes(`☆ ${tpl.title}`));
    await p.eval(`document.querySelector('button[aria-label="Edit template ${tpl.title}"]').click()`);
    await sleep(600);
    check("Templates: ✎ opens the template with a banner", (await p.eval(`document.querySelector('[data-testid="template-banner"]')?.innerText ?? ""`)).includes("Editing the template"));
    await p.eval(`(() => { window.confirm = () => true; return true; })()`);
    await p.eval(`document.querySelector('button[aria-label="New note from a template"]').click()`);
    await sleep(300);
    await p.eval(`document.querySelector('button[aria-label="Delete template ${tpl.title}"]').click()`);
    await sleep(700);
    check("Templates: × deletes the template and opens a real note", !(await notes()).some((n) => n.template) && !(await p.eval(`!!document.querySelector('[data-testid="template-banner"]')`)));

    // Daily note: created once with today's planned tasks, then reopened.
    await p.eval(`document.querySelector('button[aria-label="Today\\'s daily note"]').click()`);
    await sleep(900);
    let daily = (await notes()).filter((n) => n.dailyFor === today);
    html = await p.editorHtml();
    check("Daily note: 📅 creates today's note with planned tasks", daily.length === 1 && html.includes("Review the budget") && daily[0].title.startsWith("Daily note"), JSON.stringify(daily.map((d) => d.title)));
    // Open another note, then 📅 again: same note, no duplicate.
    await p.click("+").catch(() => p.eval(`document.querySelector('button[aria-label="New note"]').click()`));
    await sleep(500);
    await p.eval(`document.querySelector('button[aria-label="Today\\'s daily note"]').click()`);
    await sleep(700);
    daily = (await notes()).filter((n) => n.dailyFor === today);
    check("Daily note: 📅 again opens the same note", daily.length === 1 && (await p.eval(`chrome.storage.local.get("activeNoteId").then(r => r.activeNoteId)`)) === daily[0].id);
    // From ⌘K on another page.
    await p.goto("todos");
    await p.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
    await sleep(300);
    await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Go to, do"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "daily note"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(300);
    await p.eval(`[...document.querySelectorAll('[role="option"], button, li')].find(e => e.textContent && e.textContent.includes("Open today's daily note") && e.children.length < 6).click()`);
    await sleep(2500);
    check("Daily note: ⌘K opens it from another page", (await p.lowerText()).includes("review the budget") && (await notes()).filter((n) => n.dailyFor === today).length === 1);
    await p.close();
  },

  async habitkinds(b, check) {
    // Count, timed and quit habits, chosen days, skip, the year view, and Today's buttons.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ habits: [] })`);
    await p.goto("habits");
    const habits = async () => (await p.storage(["habits"])).habits ?? [];
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const newHabit = async (name, kind, target, unit) => {
      await p.click("+ New Habit");
      await sleep(250);
      await p.eval(`(() => { const i = document.querySelector('input[placeholder="Habit name..."]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      if (kind) {
        await p.eval(`[...document.querySelectorAll('[role="radiogroup"][aria-label="Habit type"] button')].find(b => b.textContent.startsWith(${JSON.stringify(kind)})).click()`);
        await sleep(150);
        await p.eval(`(() => { const i = document.querySelector('#habit-target'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "${target}"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
        if (unit) await p.eval(`(() => { const i = document.querySelector('input[aria-label="Unit"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(unit)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      }
      await sleep(150);
      await p.click("Save");
      await sleep(500);
    };
    await newHabit("Water", "Count", 8, "glasses");
    let h = (await habits()).find((x) => x.name === "Water");
    check("Habits: a Count habit saves its target and unit", h?.kind === "count" && h?.target === 8 && h?.unit === "glasses", JSON.stringify(h));
    for (let i = 0; i < 3; i++) await p.eval(`document.querySelector('button[aria-label="+1: Water"]').click()`), await sleep(150);
    h = (await habits()).find((x) => x.name === "Water");
    check("Habits: +1 logs the amount and shows progress", h?.log?.[today] === 3 && !h.completedDays.includes(today) && (await p.text()).includes("today: 3/8 glasses"), JSON.stringify(h?.log));
    await newHabit("No smoking", "Quit", 0);
    check("Habits: a Quit habit shows days kept", (await p.text()).includes("No smoking") && (await p.eval(`!!document.querySelector('button[aria-label="Slipped: No smoking"]')`)));
    await p.eval(`document.querySelector('button[aria-label="Slipped: No smoking"]').click()`);
    await sleep(400);
    h = (await habits()).find((x) => x.name === "No smoking");
    check("Habits: Slipped logs a slip for today", h?.log?.[today] === 1 && h.completedDays.length === 0, JSON.stringify(h));
    // A habit only on another weekday isn't due today.
    await p.click("+ New Habit");
    await sleep(250);
    await p.eval(`(() => { const i = document.querySelector('input[placeholder="Habit name..."]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Gym"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    // Keep only tomorrow's weekday.
    const keep = (new Date().getDay() + 1) % 7;
    await p.eval(`[...document.querySelectorAll('[role="group"][aria-label="Days"] button')].forEach((b, i) => { if (i !== ${keep}) b.click(); })`);
    await sleep(150);
    await p.click("Save");
    await sleep(500);
    h = (await habits()).find((x) => x.name === "Gym");
    check("Habits: chosen days are saved, and it's not due today", h?.days?.length === 1 && !h.days.includes(new Date().getDay()) && (await p.text()).includes("not due today"), JSON.stringify(h?.days));
    // Skip a check-off habit today.
    await newHabit("Stretch");
    await p.eval(`document.querySelector('button[aria-label="Skip today: Stretch"]').click()`);
    await sleep(400);
    h = (await habits()).find((x) => x.name === "Stretch");
    check("Habits: Skip marks today as skipped (streak safe)", h?.skipped?.includes(today) && (await p.text()).includes("skipped today"), JSON.stringify(h));
    // Year view.
    await p.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.trim().toLowerCase() === "year").click()`);
    await sleep(300);
    check("Habits: the Year view shows a year of days", (await p.eval(`document.querySelectorAll('[role="img"][aria-label*="past year"] > div').length`)) >= 52);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80) + (n.any[0]?.data?.fgColor ? " [" + n.any[0].data.fgColor + " on " + n.any[0].data.bgColor + "]" : "")).join(" | ")))`);
      check(`A11y (${theme}): habit types, days and the year view have no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("habit-kinds");
    // Today: count habits get +1, quit habits show their status, not-due habits are hidden.
    await p.goto("today");
    const card = () => p.eval(`document.querySelector('[data-testid="habits-today"]').innerText`);
    check("Habits: Today shows progress and hides habits not due today", (await card()).includes("3/8 glasses") && !(await card()).includes("Gym"), await card());
    await p.eval(`[...document.querySelectorAll('[data-testid="habits-today"] button')].find(b => b.textContent.includes("Water")).click()`);
    await sleep(400);
    h = (await habits()).find((x) => x.name === "Water");
    check("Habits: tapping a count habit on Today adds one", h?.log?.[today] === 4, JSON.stringify(h?.log));
    await p.eval(`chrome.storage.local.set({ habits: [] })`);
    await p.close();
  },

  async readlater(b, check) {
    // Read later on Today, and the Quick add window's "Later" option.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const server = http.createServer((_req, res) => (res.writeHead(200, { "Content-Type": "text/html" }), res.end("<title>Article</title>ok")));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const article = `http://127.0.0.1:${server.address().port}/article`;
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ readLater: [] })`);
    await p.goto("today");
    const items = async () => (await p.storage(["readLater"])).readLater ?? [];
    await p.eval(`(() => { const i = document.querySelector('input[aria-label="Link to read later"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "example.com/long-read"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await p.eval(`document.querySelector('[data-testid="read-later"] form button[type="submit"]').click()`);
    await sleep(500);
    check("Read later: pasting a link saves it", (await items())[0]?.url === "https://example.com/long-read" && (await p.eval(`document.querySelectorAll('[data-testid="read-later-item"]').length`)) === 1);
    // The Quick add window (opened from a page) offers "Later".
    const qa = await b.openPage(`chrome-extension://${b.extId}/index.html#quick-add?title=${encodeURIComponent("A great article")}&url=${encodeURIComponent(article)}`);
    await sleep(800);
    await qa.eval(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent.includes("Later")).click()`);
    await sleep(150);
    await qa.click("Save");
    await sleep(800);
    check("Read later: the Quick add window saves the page with its title", (await items()).some((i) => i.url === article && i.title === "A great article"), JSON.stringify(await items()));
    await qa.close().catch(() => {});
    await sleep(300);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="read-later"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): Read later has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Opening an item marks it read (and opens it in a tab).
    await p.eval(`[...document.querySelectorAll('[data-testid="read-later-item"] button')].find(b => b.textContent.includes("A great article")).click()`);
    await sleep(1200);
    const opened = await p.eval(`chrome.tabs.query({}).then(t => t.some(x => x.url === ${JSON.stringify(article)}))`);
    check("Read later: opening an item opens it and marks it read", opened && !!(await items()).find((i) => i.url === article)?.readAt);
    await p.eval(`chrome.tabs.query({}).then(t => chrome.tabs.remove(t.filter(x => x.url === ${JSON.stringify(article)}).map(x => x.id)))`);
    await p.click("▸ Read (1)").catch(() => p.eval(`[...document.querySelectorAll('[data-testid="read-later"] button')].find(b => b.textContent.includes("Read (")).click()`));
    await sleep(300);
    check("Read later: read items are tucked away under Read", (await p.eval(`document.querySelector('[data-testid="read-later"]').innerText`)).includes("A great article"));
    await p.eval(`document.querySelector('button[aria-label="Remove A great article"]').click()`);
    await sleep(400);
    check("Read later: × removes an item", !(await items()).some((i) => i.url === article));
    // Long titles are shortened with "…": they must never make Today wider than the window.
    const long = "A very long article title that keeps going and going so it is far wider than the right-hand column of the Today page";
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await p.eval(`chrome.storage.local.set({ readLater: [{ id: "long1", url: "https://example.com/long", title: ${JSON.stringify(long)}, createdAt: new Date().toISOString() }], tabSessions: [{ id: "longs", name: "Research", tabs: [{ url: "https://example.com/a", title: ${JSON.stringify(long)} }], createdAt: new Date().toISOString() }] })`);
    await p.send("Page.reload", {});
    await sleep(1500);
    const fit = await p.eval(`(() => { const sc = document.querySelector('.today-page').parentElement; const col = document.querySelector('[data-testid="read-later-card"]').getBoundingClientRect(); const page = document.querySelector('.today-page').getBoundingClientRect(); return { scrollW: sc.scrollWidth, clientW: sc.clientWidth, cardRight: Math.round(col.right), contentRight: Math.round(page.right - 24) }; })()`);
    check("Read later: long titles don't make Today wider than the window", fit.scrollW <= fit.clientW && fit.cardRight <= fit.contentRight + 1, JSON.stringify(fit));
    await p.send("Emulation.clearDeviceMetricsOverride", {});
    await p.eval(`chrome.storage.local.set({ readLater: [], tabSessions: [] })`);
    await p.close();
    server.close();
  },

  async voicetasks(b, check) {
    // 🎙 Speak tasks: a brain dump → reviewed tasks (a stub stands in for the AI; test builds only).
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [{ id: "w", kind: "list", name: "Work", createdAt: "x" }] })`);
    await p.goto("todos");
    await p.eval(`document.querySelector('button[aria-label="Speak tasks"]').click()`);
    await sleep(400);
    check("Voice: 🎙 on To-dos opens Speak tasks", await p.eval(`!!document.querySelector('[data-testid="voice-tasks"]')`));
    await p.eval(`(() => { window.__dumps = []; globalThis.__prodliExtractStub = async (text, lists) => { window.__dumps.push({ text, lists }); await new Promise(r => setTimeout(r, 150)); return { lines: ["Call mom tomorrow at 5pm", "Finish the report friday #Work !high", "Buy milk"] }; }; return true; })()`);
    await p.eval(`(() => { const t = document.querySelector('textarea[aria-label="Your tasks, in your own words"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "ugh call mom tomorrow around five, the work report is due friday and it's urgent, oh and milk"); t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(150);
    await p.click("Make tasks");
    await sleep(80);
    check("Voice: shows progress while finding tasks", /finding tasks/i.test(await p.eval(`document.querySelector('[data-testid="voice-tasks"]').innerText`)));
    await sleep(500);
    const dumps = await p.eval("window.__dumps");
    check("Voice: sends the words and the user's list names", dumps.length === 1 && dumps[0].lists.join() === "Work" && dumps[0].text.includes("report"), JSON.stringify(dumps));
    const review = await p.eval(`document.querySelector('[data-testid="voice-tasks"]').innerText`);
    check("Voice: the review shows each task with how it was read", (await p.eval(`document.querySelectorAll('[data-testid="voice-task"]').length`)) === 3 && /Tomorrow/.test(review) && /Work/.test(review) && /High priority/.test(review), review.slice(0, 300));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="voice-tasks"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): Speak tasks has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.shot("voice-tasks");
    // Leave out "Buy milk", then add.
    await p.eval(`document.querySelector('input[type="checkbox"][aria-label="Add “Buy milk”"]').click()`);
    await sleep(150);
    await p.click("Add 2 tasks");
    await sleep(1200);
    const { todos = [] } = await p.storage(["todos"]);
    const report = todos.find((t) => t.title === "Finish the report");
    check("Voice: only the checked tasks are added, read by quick add", todos.length === 2 && report?.listId === "w" && report?.priority === "high" && todos.find((t) => t.title === "Call mom")?.dueTime === "17:00" && !todos.some((t) => t.title === "Buy milk"), JSON.stringify(todos.map((t) => [t.title, t.listId, t.priority, t.dueTime])));
    check("Voice: the window closes after adding", !(await p.eval(`!!document.querySelector('[data-testid="voice-tasks"]')`)));
    // ⌘K has it too.
    await p.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
    await sleep(300);
    await p.eval(`(() => { const i = document.querySelector('input[placeholder^="Go to, do"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "speak"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(300);
    check("Voice: ⌘K offers Speak or paste tasks", (await p.text()).includes("Speak or paste tasks"));
    await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
    await p.close();
  },

  async focusscore(b, check) {
    // Time Tracker: focus score and site categories (seeded tracking data); the weekly review's categories.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const dayKey = await p.eval(`(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    await p.eval(`chrome.storage.local.set({ siteCategories: {}, "tt_${dayKey}": { "github.com": 3600, "youtube.com": 1200, "mail.google.com": 1800, "chatgpt.com": 600 } })`);
    await p.goto("tracker");
    await sleep(600);
    const card = () => p.eval(`document.querySelector('[data-testid="focus-score"]')?.innerText ?? ""`);
    let text = await card();
    check("Focus score: shows today's score and label", /Focus score\s*78\s*Focused/i.test(text), text.slice(0, 200));
    check("Focus score: shows time by kind and by category", /Productive 1:10:00/.test(text) && /Distracting 0:20:00/.test(text) && text.includes("AI tools") && text.includes("Email & chat"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('main') ?? document.body, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): Time Tracker with the focus score has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Recategorise YouTube as Learning.
    await p.eval(`(() => { const s = document.querySelector('select[aria-label="Category for youtube.com"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "learning"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(500);
    const { siteCategories = {} } = await p.storage(["siteCategories"]);
    text = await card();
    check("Focus score: changing a site's category saves it and updates the score", siteCategories["youtube.com"] === "learning" && /Focus score\s*100/i.test(text), JSON.stringify({ siteCategories, text: text.slice(0, 80) }));
    // The weekly review (this week) shows the score and categories.
    await p.goto("review");
    await sleep(600);
    if (!(await p.eval(`document.querySelector('[data-testid="review-week"]').parentElement.innerText.includes("This week")`))) await p.click("Next ›");
    await sleep(500);
    const review = await p.eval(`document.querySelector('[data-testid="review-categories"]')?.innerText ?? ""`);
    check("Focus score: the weekly review shows time by category", review.includes("Work & tools") && review.includes("AI tools") && review.includes("Learning"), review);
    // Focus trends (Pro, open during early access): 30 days of scores with the average.
    const prevKey = await p.eval(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    await p.eval(`chrome.storage.local.set({ siteCategories: {}, "tt_${prevKey}": { "github.com": 1800, "reddit.com": 1800 } })`);
    await p.goto("tracker");
    await sleep(800);
    const trends = await p.eval(`document.querySelector('[data-testid="focus-trends"]')?.innerText ?? ""`);
    check("Focus trends: 30 days of scores with the average and the biggest distraction", /average over 30 days/.test(trends) && /Biggest distraction: .*Social media/.test(trends), trends);
    await p.eval(`[...document.querySelectorAll('[data-testid="focus-trends"] button')].find((x) => x.textContent.includes("90 days")).click()`);
    await sleep(300);
    check("Focus trends: switches to 90 days", /average over 90 days/.test(await p.eval(`document.querySelector('[data-testid="focus-trends"]').innerText`)));
    await p.eval(`chrome.storage.local.remove(["siteCategories", "tt_${dayKey}", "tt_${prevKey}"])`);
    await p.close();
  },

  async timebox(b, check) {
    // Today → Agenda → Day: drag tasks onto the timeline, move and resize blocks, unblock, and the keyboard.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const day = await p.eval(`(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    await p.eval(`chrome.storage.local.remove("agendaView").then(() => chrome.storage.local.set({ hasSeenOnboarding: true, days: [], todaySettings: { workStart: "09:00", workEnd: "18:00", reminder: null, startOnToday: false, autoBrief: false, blockReminders: false }, todos: [
      { id: "w1", title: "Write report", completed: false, plannedFor: "${day}", estimateMin: 60, createdAt: new Date().toISOString() },
      { id: "w2", title: "Email Sam", completed: false, plannedFor: "${day}", estimateMin: 30, block: { day: "${day}", start: "10:00" }, createdAt: new Date().toISOString() }
    ] }))`);
    await p.goto("today");
    await sleep(800);
    check("Timebox: the agenda opens in Day view", await p.eval(`!!document.querySelector('[data-testid="day-view"]')`));
    const todos = async () => (await p.storage(["todos"])).todos;
    const PX = 1.1;
    // Scroll so a time is visible, then return a point on the grid for it.
    const pointAt = async (hhmm) => p.eval(`(() => { const [h, m] = "${hhmm}".split(":").map(Number); const grid = document.querySelector('[data-testid="day-grid"]'); grid.parentElement.scrollTop = Math.max(0, (h * 60 + m - 540) * ${PX} - 150); document.querySelector('[data-testid="day-view"]').scrollIntoView({ block: "start" }); const r = grid.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + (h * 60 + m - 540) * ${PX} }; })()`);
    // Where an element is now (no scrolling: positions must stay put during a drag).
    const center = async (sel) => p.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const drag = async (from, to) => {
      await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6, button: "left", buttons: 1 });
      await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
      await sleep(500);
    };
    // Drag "Write report" (60 min) from the tray so it's centred on 13:30 → 13:00–14:00.
    const target = await pointAt("13:30");
    await drag(await center('[data-testid="tray-task"]'), target);
    let t = await todos();
    check("Timebox: dragging a task onto the timeline blocks it there", t.find((x) => x.id === "w1")?.block?.start === "13:00", JSON.stringify(t.map((x) => x.block)));
    // Move "Email Sam" from 10:00 down an hour.
    const sam = '[data-testid="day-block"][data-id="w2"]';
    await pointAt("10:00");
    let from = await center(sam);
    await drag(from, { x: from.x, y: from.y + 60 * PX });
    t = await todos();
    check("Timebox: dragging a block moves it (snapped to 15 minutes)", t.find((x) => x.id === "w2")?.block?.start === "11:00", JSON.stringify(t.find((x) => x.id === "w2")?.block));
    // Make it 30 minutes longer by dragging its bottom edge.
    from = await center(`${sam} [data-testid="block-resize"]`);
    await drag(from, { x: from.x, y: from.y + 30 * PX });
    t = await todos();
    check("Timebox: dragging the bottom edge changes the length", t.find((x) => x.id === "w2")?.estimateMin === 60, String(t.find((x) => x.id === "w2")?.estimateMin));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="agenda"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): the Day view has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Drag it back to the tray to unblock it.
    await pointAt("11:00");
    from = await center(sam);
    await drag(from, await center('[data-testid="day-tray"]'));
    t = await todos();
    check("Timebox: dragging a block to the tray unblocks it", !t.find((x) => x.id === "w2")?.block && (await p.eval(`document.querySelector('[data-testid="day-tray"]').innerText`)).includes("Email Sam"));
    // Keyboard: move, lengthen and unblock "Write report"; Enter places "Email Sam".
    const key = async (sel, k, shift = false) => {
      await p.eval(`document.querySelector(${JSON.stringify(sel)}).focus()`);
      await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Delete: 46, Enter: 13 }[k], modifiers: shift ? 8 : 0 });
      await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Delete: 46, Enter: 13 }[k], modifiers: shift ? 8 : 0 });
      await sleep(400);
    };
    const report = '[data-testid="day-block"][data-id="w1"]';
    await key(report, "ArrowDown");
    await key(report, "ArrowDown", true);
    t = await todos();
    const w1 = t.find((x) => x.id === "w1");
    check("Timebox: arrow keys move a block; Shift+arrows change its length", w1?.block?.start === "13:15" && w1?.estimateMin === 75, JSON.stringify(w1));
    check("Timebox: changes are announced", (await p.eval(`document.querySelector('[data-testid="day-view"] [role="status"]').innerText`)).includes("Write report: 75 minutes"));
    await key(report, "Delete");
    t = await todos();
    check("Timebox: Delete unblocks a block", !t.find((x) => x.id === "w1")?.block);
    // "Next free time" starts from now, so open the working day up to the whole day (CI runs at any hour).
    await p.eval(`chrome.storage.local.set({ todaySettings: { workStart: "00:00", workEnd: "23:59", reminder: null, startOnToday: false, autoBrief: false, blockReminders: false } })`);
    await sleep(500);
    await key('[data-testid="tray-task"][aria-label^="Email Sam"]', "Enter");
    t = await todos();
    const placed = t.find((x) => x.id === "w2")?.block?.start ?? "";
    const lateNight = new Date().getHours() * 60 + new Date().getMinutes() > 23 * 60 + 20;
    const said = await p.eval(`document.querySelector('[data-testid="day-view"] [role="status"]').innerText`);
    check("Timebox: Enter on a task places it in the next free time", /^\d\d:\d\d$/.test(placed) || (lateNight && /no free time left today/.test(said)), JSON.stringify({ blocks: t.map((x) => [x.id, x.block]), said }));
    // List view is still there, and remembered.
    await p.eval(`[...document.querySelectorAll('[aria-label="Agenda view"] button')].find((b) => b.textContent === "List").click()`);
    await sleep(400);
    check("Timebox: List view switches back and is remembered", !(await p.eval(`!!document.querySelector('[data-testid="day-view"]')`)) && (await p.storage(["agendaView"])).agendaView === "list");
    await p.eval(`chrome.storage.local.set({ todos: [], days: [] }).then(() => chrome.storage.local.remove(["agendaView", "todaySettings"]))`);
    await p.close();
  },

  async actionitems(b, check) {
    // Meetings → ✅ Action items (Pro, open during early access): open items from all meetings by owner; Done, + To-do, open the meeting. Plus the template gallery.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("meetings");
    await sleep(500);
    const now = new Date().toISOString();
    const mk = (id, title, items) => ({ id, platform: "zoom", title, meetingCode: null, url: "", startedAt: now, endedAt: now, durationSec: 600, status: "ready", error: null, notice: null, hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: now, transcript: [{ id: "1", speaker: "You", text: "Hi", startMs: 0, endMs: 1000 }],
      summary: { title, overview: "o", keyPoints: [], decisions: [], openQuestions: [], model: "t", generatedAt: now, actionItems: items.map(([task, owner, dueDate]) => ({ task, owner, dueDate, priority: "medium" })) } });
    const ms = [mk("ai1", "Acme pilot review", [["Send the pilot plan", "You", "2020-01-01"], ["Book the venue", "Priya", null]]), mk("ai2", "Hiring sync", [["Write the job post", "You", null]])];
    await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const t = r.result.transaction("meetings", "readwrite"); for (const m of ${JSON.stringify(ms)}) t.objectStore("meetings").put(m); t.oncomplete = () => resolve(true); }; })`);
    await p.eval(`chrome.storage.local.set({ todos: [] })`);
    await p.goto("meetings");
    await sleep(800);
    await p.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.includes("Action items")).click()`);
    await sleep(500);
    const view = () => p.eval(`document.querySelector('[data-testid="action-items"]')?.innerText ?? ""`);
    let text = await view();
    const groups = await p.eval(`[...document.querySelectorAll('[data-testid="action-owner"] h3')].map((h) => h.innerText.replace(/\\s+\\d+$/, ""))`);
    // (Other suites may leave meetings behind, so check order and our items rather than an exact list.)
    check("Action items: open items from all meetings, grouped by owner (you first)", groups[0] === "YOU" && groups.includes("PRIYA") && text.includes("Send the pilot plan") && text.includes("Write the job post") && text.includes("Book the venue"), JSON.stringify({ groups, text: text.slice(0, 200) }));
    check("Action items: overdue items say so, with the meeting they came from", /Overdue · 2020-01-01/.test(text) && text.includes("Acme pilot review"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="action-items"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): Action items has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`document.querySelector('input[aria-label="Done: Book the venue"]').click()`);
    await sleep(600);
    const done = await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const g = r.result.transaction("meetings").objectStore("meetings").get("ai1"); g.onsuccess = () => resolve(g.result.doneActions ?? []); }; })`);
    check("Action items: Done marks it done on its meeting and hides it", JSON.stringify(done) === '["Book the venue"]' && !(await view()).includes("Book the venue"), JSON.stringify(done));
    await p.eval(`document.querySelector('button[aria-label="+ To-do: Write the job post"]').click()`);
    await sleep(600);
    const { todos = [] } = await p.storage(["todos"]);
    check("Action items: + To-do adds it to your to-dos", todos.some((t) => t.title === "Write the job post") && (await view()).includes("In to-dos ✓"));
    await p.eval(`[...document.querySelectorAll('[data-testid="action-items"] button')].find((x) => x.textContent.includes("Hiring sync")).click()`);
    await sleep(500);
    check("Action items: the meeting link opens that meeting", !(await p.eval(`!!document.querySelector('[data-testid="action-items"]')`)) && (await p.text()).includes("Hiring sync"));
    // Template gallery (Setup → Meeting notes).
    await p.eval(`chrome.storage.local.set({ recorderCustomTemplates: [] })`);
    if (!(await p.eval(`!!document.querySelector('[data-testid="custom-templates"]')`))) await p.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.includes("Setup"))?.click()`);
    await sleep(500);
    await p.eval(`(() => { const s = document.querySelector('select[aria-label="Add a ready-made template"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "Sales discovery"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(500);
    const { recorderCustomTemplates: tpl = [] } = await p.storage(["recorderCustomTemplates"]);
    check("Template gallery: one click adds a ready-made template you can edit", tpl.length === 1 && tpl[0].name === "Sales discovery" && tpl[0].sections.includes("Decision process") && (await p.eval(`document.querySelector('[data-testid="custom-templates"]').innerText`)).includes("Sales discovery"), JSON.stringify(tpl));
    await p.eval(`chrome.storage.local.set({ recorderCustomTemplates: [], todos: [] })`);
    await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const t = r.result.transaction("meetings", "readwrite"); t.objectStore("meetings").delete("ai1"); t.objectStore("meetings").delete("ai2"); t.oncomplete = () => resolve(true); }; })`);
    await p.close();
  },

  async talktime(b, check) {
    // Meetings → Insights: talk time from the speaker timeline (You / Others), labelled transcript lines.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    await p.goto("meetings");
    await sleep(500);
    const now = new Date().toISOString();
    const m = { id: "mtg_talk", platform: "zoom", title: "Pipeline review", meetingCode: null, url: "", startedAt: now, endedAt: now, durationSec: 60, status: "ready", error: null, notice: null, hasAudio: false, micIncluded: true, audioMimeType: null, updatedAt: now,
      transcript: [{ id: "1", speaker: "You", text: "Where are we on Acme?", startMs: 0, endMs: 3000, source: "audio" }, { id: "2", speaker: "Others", text: "They signed the pilot.", startMs: 21000, endMs: 24000, source: "audio" }],
      speakerActivity: [[0, 20000, 0], [20000, 30000, 1], [30000, 45000, 0], [45000, 60000, 1]],
      marks: [25000, 50000],
      coaching: { verdict: "A focused review; you let Acme do most of the talking.", strengths: ["You opened with a clear question"], improvements: ["Confirm who signs before the pilot ends"], nextStepsAgreed: false, nextStepsNote: "No date was set for the follow-up.", missedQuestions: ["Who else needs to approve?"], focus: "sales", model: "t", generatedAt: now },
      summary: { title: "Pipeline review", overview: "Acme signed the pilot.", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], model: "t", generatedAt: now } };
    const earlier = { ...m, id: "mtg_talk_prev", startedAt: new Date(Date.now() - 7 * 86400000).toISOString(), speakerActivity: undefined, marks: undefined, coaching: undefined, summary: { ...m.summary, title: "Pipeline review", decisions: ["Push Acme to sign"], actionItems: [{ task: "Send Acme the contract", owner: "You", dueDate: null, priority: "high" }] } };
    await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const t = r.result.transaction("meetings", "readwrite"); t.objectStore("meetings").put(${JSON.stringify(m)}); t.objectStore("meetings").put(${JSON.stringify(earlier)}); t.oncomplete = () => resolve(true); }; })`);
    await p.goto("meetings");
    await sleep(800);
    await p.eval(`[...document.querySelectorAll("button")].find((x) => x.title === "Pipeline review")?.click()`);
    await sleep(500);
    const text = await p.eval(`document.querySelector('[data-testid="talk-time"]')?.innerText ?? ""`);
    const series = await p.eval(`document.querySelector('[data-testid="meeting-series"]')?.innerText ?? ""`);
    check("Series: earlier occurrences show with their decisions and open items", /Earlier in this series \(1\)/.test(series) && series.includes("Push Acme to sign") && series.includes("Send Acme the contract"), series);
    check("Talk time: shows how the talking was split, your longest stretch and turns", /You 58%/.test(text) && /Others 42%/.test(text) && /longest stretch: 20 s/.test(text) && /changed 3 times/.test(text), text);
    await p.eval(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Copy notes"))?.click(); true`);
    await sleep(300);
    const copied = await p.eval(`window.__copied ?? ""`);
    check("📋 Copy notes copies the summary as Markdown, with key moments", copied.startsWith("# Pipeline review") && copied.includes("Acme signed the pilot.") && copied.includes("## Key moments") && copied.includes("They signed the pilot."), copied.slice(0, 300));
    const coachText = await p.eval(`document.querySelector('[data-testid="coach-result"]')?.innerText ?? ""`);
    check("Coach: saved feedback shows what worked, what to try, next steps and missed questions", /What worked/i.test(coachText) && coachText.includes("Confirm who signs") && /Left open/.test(coachText) && coachText.includes("Who else needs to approve?"), coachText);
    const moments = await p.eval(`document.querySelector('[data-testid="key-moments"]')?.innerText ?? ""`);
    check("Key moments: each marked moment shows its time and what was said", /★ 00:25/.test(moments) && moments.includes("They signed the pilot.") && /★ 00:50/.test(moments) && /Nothing in the transcript at this point/.test(moments), moments);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const km = await p.eval(`axe.run(document.querySelector('[data-testid="key-moments"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): key moments have no serious problems`, km.length === 0, km.join(", "));
      const cv = await p.eval(`axe.run(document.querySelector('[data-testid="meeting-coach"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): coaching has no serious problems`, cv.length === 0, cv.join(", "));
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="talk-time"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): talk time has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`document.querySelector('[aria-label="Remove the moment at 00:50"]')?.click()`);
    await sleep(600);
    const after = await p.eval(`document.querySelector('[data-testid="key-moments"]')?.innerText ?? ""`);
    const saved = await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").get("mtg_talk"); q.onsuccess = () => resolve(q.result?.marks ?? null); }; })`);
    check("Key moments: × removes a moment", !/00:50/.test(after) && /00:25/.test(after) && JSON.stringify(saved) === "[25000]", `${after} ${JSON.stringify(saved)}`);
    // 📊 Insights: where meeting time goes (other suites may leave meetings, so only what's ours is checked).
    await p.eval(`[...document.querySelectorAll("button")].find((x) => /Insights/.test(x.textContent) && x.getAttribute("aria-pressed") !== null)?.click()`);
    await sleep(500);
    const ins = await p.eval(`document.querySelector('[data-testid="meeting-insights"]')?.innerText ?? ""`);
    const seriesText = await p.eval(`document.querySelector('[data-testid="insight-series"]')?.innerText ?? ""`);
    check("Insights: this week, the weekly chart, recurring meetings and call apps", /This week/i.test(ins) && /Meeting time per week/i.test(ins) && !/\d{3,}%/.test(ins) && /Pipeline review/.test(seriesText) && /2×/.test(seriesText) && /Zoom/.test(ins) && /What came out/i.test(ins), ins.slice(0, 600));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      const iv = await p.eval(`axe.run(document.querySelector('[data-testid="meeting-insights"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): insights have no serious problems`, iv.length === 0, iv.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`[...document.querySelectorAll('[data-testid="insight-series"] button')].find((x) => x.textContent.includes("Pipeline review"))?.click()`);
    await sleep(400);
    check("Insights: a recurring meeting opens its latest one", (await p.eval(`!!document.querySelector('[data-testid="key-moments"]')`)) === true);
    check("Your notes: a finished meeting has its notepad", await p.eval(`!!document.querySelector('[data-testid="your-notes"] textarea')`));
    // 🧭 Decisions: every decision from every meeting, searchable.
    await p.eval(`[...document.querySelectorAll("button")].find((x) => /Decisions/.test(x.textContent) && x.getAttribute("aria-pressed") !== null)?.click()`);
    await sleep(500);
    const log = await p.eval(`document.querySelector('[data-testid="decision-log"]')?.innerText ?? ""`);
    check("Decisions: the log lists decisions with their meeting", log.includes("Push Acme to sign") && log.includes("Pipeline review"), log.slice(0, 400));
    await p.eval(`(() => { const i = document.querySelector('input[aria-label="Search decisions"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "acme to sign"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(300);
    const filtered = await p.eval(`[...document.querySelectorAll('[data-testid="decision-group"] li')].map((x) => x.textContent)`);
    check("Decisions: searching keeps only matching decisions", filtered.length === 1 && filtered[0] === "Push Acme to sign", JSON.stringify(filtered));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      const dv = await p.eval(`axe.run(document.querySelector('[data-testid="decision-log"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
      check(`A11y (${theme}): decision log has no serious problems`, dv.length === 0, dv.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Setup → Meeting notes → rules that pick the type from the meeting's name.
    await p.eval(`[...document.querySelectorAll("button")].find((x) => /Decisions/.test(x.textContent) && x.getAttribute("aria-pressed") === "true")?.click()`);
    await p.eval(`(() => { if (!document.querySelector('[data-testid="template-rules"]')) [...document.querySelectorAll("button")].find((x) => /Setup/.test(x.textContent))?.click(); return true; })()`);
    await sleep(500);
    await p.eval(`(() => { const i = document.querySelector('input[aria-label^="Words in the meeting"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Pipeline, deal review"); i.dispatchEvent(new Event("input", { bubbles: true })); const s = document.querySelector('select[aria-label="Meeting type for this rule"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "sales"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[data-testid="template-rules"] button')].find((x) => /Add rule/.test(x.textContent))?.click()`);
    await sleep(400);
    const rulesText = await p.eval(`document.querySelector('[data-testid="template-rules"]')?.innerText ?? ""`);
    const storedRules = await p.eval(`chrome.storage.local.get("meetingTemplateRules").then((r) => r.meetingTemplateRules ?? [])`);
    check("Type rules: a rule is added and saved", /Name has pipeline, deal review → Sales \/ customer call/i.test(rulesText) && storedRules.length === 1 && storedRules[0].template === "sales", `${rulesText} ${JSON.stringify(storedRules)}`);
    await p.eval(`document.querySelector('[aria-label="Remove the rule for pipeline, deal review"]')?.click()`);
    await sleep(300);
    check("Type rules: × removes it", (await p.eval(`chrome.storage.local.get("meetingTemplateRules").then((r) => (r.meetingTemplateRules ?? []).length)`)) === 0);
    await p.eval(`(() => { if (document.querySelector('[data-testid="template-rules"]')) [...document.querySelectorAll("button")].find((x) => /Setup/.test(x.textContent))?.click(); return true; })()`);
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings", 1); r.onsuccess = () => { const t = r.result.transaction("meetings", "readwrite"); t.objectStore("meetings").delete("mtg_talk"); t.objectStore("meetings").delete("mtg_talk_prev"); t.oncomplete = () => resolve(true); }; })`);
    await p.close();
  },

  async boards(b, check) {
    // To-dos → ▦ Board and ⊞ Matrix: columns and quadrants from dates, plans, priority and done; move by menu or drag.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const [today, later] = await p.eval(`(() => { const k = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); const d = new Date(); const l = new Date(); l.setDate(l.getDate() + 10); return [k(d), k(l)]; })()`);
    const now = new Date().toISOString();
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, todos: [
      { id: "b1", title: "Pick a venue", completed: false, createdAt: "${now}" },
      { id: "b2", title: "Draft the agenda", completed: false, dueDate: "${later}", priority: "high", createdAt: "${now}" },
      { id: "b3", title: "Send invites", completed: false, dueDate: "${today}", priority: "high", createdAt: "${now}" },
      { id: "b4", title: "Book flights", completed: true, completedAt: "${now}", createdAt: "${now}" }
    ] })`);
    await p.eval(`localStorage.setItem("prodli_todo_view", "date"); localStorage.removeItem("prodli_todo_selection"); true`);
    await p.goto("todos");
    await sleep(600);
    await p.eval(`[...document.querySelectorAll('[role="radio"]')].find((x) => x.textContent.includes("Board")).click()`);
    await sleep(400);
    const zone = (id) => p.eval(`document.querySelector('[data-testid="board-zone-${id}"]')?.innerText ?? ""`);
    check("Board: tasks sit in No date, Upcoming, Today and Done", (await zone("nodate")).includes("Pick a venue") && (await zone("upcoming")).includes("Draft the agenda") && (await zone("today")).includes("Send invites") && (await zone("done")).includes("Book flights"));
    const todos = async () => (await p.storage(["todos"])).todos;
    const moveBy = async (title, value) => {
      await p.eval(`(() => { const s = document.querySelector('select[aria-label="Move ${title} to"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "${value}"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await sleep(400);
    };
    await moveBy("Pick a venue", "today");
    check("Board: Move to Today plans the task for today", (await todos()).find((x) => x.id === "b1")?.plannedFor === today && (await zone("today")).includes("Pick a venue"));
    check("Board: the move is announced", (await p.eval(`document.querySelector('[data-testid="todo-board"] ~ [role="status"]').innerText`)).includes("Pick a venue: planned for today"));
    await moveBy("Send invites", "done");
    check("Board: Move to Done completes the task", (await todos()).find((x) => x.id === "b3")?.completed === true);
    await moveBy("Book flights", "upcoming");
    const flights = (await todos()).find((x) => x.id === "b4");
    check("Board: moving out of Done reopens the task with a date", flights?.completed === false && !!flights?.dueDate && flights.dueDate > today, JSON.stringify(flights));
    // Drag "Draft the agenda" from Upcoming to No date with the mouse.
    const rect = (sel) => p.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60) }; })()`);
    const from = await rect('[data-testid="board-card"][data-id="b2"] [aria-roledescription="draggable task"]');
    const to = await rect('[data-testid="board-zone-nodate"]');
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, button: "left", buttons: 1 });
    await sleep(150);
    await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    check("Board: dragging a card to No date clears its date", !(await todos()).find((x) => x.id === "b2")?.dueDate && (await zone("nodate")).includes("Draft the agenda"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="todo-board"]').parentElement, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): the Board has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Matrix.
    await p.eval(`[...document.querySelectorAll('[role="radio"]')].find((x) => x.textContent.includes("Matrix")).click()`);
    await sleep(400);
    // Now: "Pick a venue" planned today (urgent), "Book flights" due tomorrow (urgent), "Draft the agenda" high with no date; "Send invites" is done (not shown).
    check("Matrix: open tasks sit by importance and urgency", (await zone("quick")).includes("Pick a venue") && (await zone("quick")).includes("Book flights") && (await zone("schedule")).includes("Draft the agenda") && !(await zone("do")).includes("Send invites") && (await zone("later")) === (await zone("later")).split("\n").slice(0, 2).join("\n"), JSON.stringify({ do: await zone("do"), quick: await zone("quick"), schedule: await zone("schedule"), later: await zone("later") }));
    await moveBy("Pick a venue", "do");
    const venue = (await todos()).find((x) => x.id === "b1");
    check("Matrix: Move to Do first makes it high priority (still planned for today)", venue?.priority === "high" && venue?.plannedFor === today && (await zone("do")).includes("Pick a venue"));
    await p.eval(axeSource + ";true");
    const mv = await p.eval(`axe.run(document.querySelector('[data-testid="todo-matrix"]').parentElement, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
    check("A11y: the Matrix has no serious problems", mv.length === 0, mv.join(", "));
    check("Board/Matrix: the chosen view is remembered", (await p.eval(`localStorage.getItem("prodli_todo_view")`)) === "matrix");
    await p.eval(`localStorage.setItem("prodli_todo_view", "date"); chrome.storage.local.set({ todos: [] })`);
    await p.close();
  },

  async inperson(b, check) {
    // In person: "🎙 Record in person" on Meetings records from the microphone, keeps going across
    // sections (chip), transcribes on Stop (stubbed AI; test builds only), and keeps the audio of a
    // recording cut short by a closed page.
    const ip = await b.openPage();
    const readMeetings = () => ip.eval(`new Promise((res) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => res(q.result.map((m) => ({ id: m.id, platform: m.platform, title: m.title, status: m.status, hasAudio: m.hasAudio, notice: m.notice, error: m.error, source: m.transcriptSource, transcript: m.transcript.map((e) => e.speaker + ": " + e.text) }))); }; })`);
    await ip.goto("meetings");
    await sleep(600);
    // Headless Chrome gives extension pages no microphone, so stand in for one: a beeping tone (speech-like bursts and pauses).
    const fakeMic = `(() => { navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = 300; const g = ctx.createGain(); g.gain.value = 0; o.connect(g); const d = ctx.createMediaStreamDestination(); g.connect(d); o.start(); let on = false; setInterval(() => { on = !on; g.gain.setValueAtTime(on ? 0.3 : 0, ctx.currentTime); }, 700); return d.stream; }; return true; })()`;
    await ip.eval(fakeMic);
    await ip.eval(`(() => { globalThis.__ipPieces = 0; globalThis.__prodliTranscribeStub = async () => { __ipPieces++; return { text: "Let's book the venue for the offsite.", segments: [{ start: 0, end: 2, text: "Let's book the venue for the offsite." }], language: "en" }; }; return true; })()`);
    await ip.eval(`document.querySelector('[data-testid="record-in-person"]').click()`);
    await sleep(1500);
    check("In person: Record in person starts recording from the microphone", await ip.eval(`!!document.querySelector('[data-testid="in-person-bar"]')`), await ip.eval(`document.body.innerText.slice(0, 300)`));
    await ip.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true }))`); // Ctrl+1: Notes
    await sleep(1200);
    check("In person: switching sections keeps recording and shows a chip", await ip.eval(`!!document.querySelector('[data-testid="in-person-chip"]')`));
    await sleep(9000);
    await ip.eval(`document.querySelector('[data-testid="in-person-chip"]')?.click()`);
    await sleep(1200);
    // 📝 Your notes: open under the recording bar, saved on the meeting as you type.
    const typed = await ip.eval(`(() => { const t = document.querySelector('[data-testid="your-notes"] textarea'); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Venue budget 5k\\nPriya books it"); t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(1200);
    check("In person: 📝 Your notes is open under the recording bar and saves as you type", typed && (await ip.eval(`document.querySelector('[data-testid="your-notes"]').innerText`)).includes("Saved"));
    await ip.eval(`[...document.querySelectorAll('[data-testid="in-person-bar"] button')].find((x) => /Stop/.test(x.textContent)).click()`);
    let inPerson;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      inPerson = (await readMeetings()).find((x) => x.platform === "in-person");
      if (inPerson && inPerson.status === "ready") break;
    }
    check("In person: stopping saves the recording and transcribes it", inPerson?.status === "ready" && inPerson.hasAudio && inPerson.source === "audio" && inPerson.transcript?.[0] === "Speaker: Let's book the venue for the offsite." && /^In person · /.test(inPerson.title), JSON.stringify(inPerson));
    const rawNotes = await ip.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => resolve(q.result.find((x) => x.platform === "in-person" && x.status === "ready")?.userNotes ?? null); }; })`);
    check("In person: your notes are kept with the saved meeting", rawNotes === "Venue budget 5k\nPriya books it", JSON.stringify(rawNotes));
    check("In person: the recording bar and chip are gone", !(await ip.eval(`!!document.querySelector('[data-testid="in-person-bar"], [data-testid="in-person-chip"]')`)));
    // A recording cut short by a closed page keeps its saved audio when Meetings opens again.
    await ip.eval(`new Promise((resolve) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const db = r.result; const t = db.transaction(["meetings", "audioChunks"], "readwrite"); const now = new Date().toISOString(); t.objectStore("meetings").put({ id: "mtg_cut", platform: "in-person", title: "In person · cut", meetingCode: null, url: "", startedAt: now, endedAt: null, durationSec: 0, status: "recording", transcript: [], summary: null, error: null, notice: null, hasAudio: false, micIncluded: true, audioMimeType: null, updatedAt: now }); t.objectStore("audioChunks").put({ meetingId: "mtg_cut", seq: 0, data: new Blob([new Uint8Array(2048)], { type: "audio/webm" }) }); t.oncomplete = () => resolve(true); }; })`);
    await ip.goto("meetings");
    await sleep(1500);
    const cut = (await readMeetings()).find((x) => x.id === "mtg_cut");
    check("In person: an interrupted recording is kept when Meetings opens again", cut?.status === "ready" && cut.hasAudio && /page closed/.test(cut.notice ?? ""), JSON.stringify(cut));
    await ip.close();

  },

  async meetingprep(b, check) {
    // Meeting prep on Today: an upcoming calendar event (stubbed calendar; test builds only) matched to an earlier recorded meeting.
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const d = new Date();
    const mins = Math.min(d.getHours() * 60 + d.getMinutes() + 5, 23 * 60 + 50);
    const start = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    const event = { id: "ev1", title: "Acme pilot review", start, end: "23:59", allDay: false, meetLink: "https://meet.google.com/aaa-bbbb-ccc", attendees: [{ name: "Priya Shah", email: "priya@acme.com" }] };
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__prodliCalendarStub = () => ${JSON.stringify([event])};` });
    await p.goto("today"); // opens (creates) the meetings database
    const past = new Date(Date.now() - 7 * 86400000).toISOString();
    const meeting = { id: "mtg_prep", platform: "google-meet", title: "Acme pilot review", meetingCode: "aaa-bbbb-ccc", url: "https://meet.google.com/aaa-bbbb-ccc", startedAt: past, endedAt: past, durationSec: 1800, status: "ready", error: null, notice: null, hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: past, transcript: [{ id: "1", speaker: "Priya Shah", text: "Let's run a pilot.", startMs: 0, endMs: 1000 }], summary: { title: "Acme pilot review", overview: "Agreed on a two-week pilot.", keyPoints: [], decisions: ["Pilot starts Monday"], openQuestions: ["Who signs the contract?"], actionItems: [{ task: "Send Priya the pilot plan", owner: "You", dueDate: null, priority: "high" }, { task: "Draft the pricing sheet", owner: null, dueDate: null, priority: "medium" }], model: "t", generatedAt: past } };
    await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const tx = req.result.transaction("meetings", "readwrite"); tx.objectStore("meetings").put(${JSON.stringify(meeting)}); tx.oncomplete = () => resolve(true); }; })`);
    const now = new Date().toISOString();
    await p.eval(`chrome.storage.local.set({ days: [], todos: [{ id: "t-done", title: "Draft the pricing sheet", completed: true, createdAt: "${now}" }, { id: "t-rel", title: "Call Priya about pricing", completed: false, createdAt: "${now}" }, { id: "t-other", title: "Buy milk", completed: false, createdAt: "${now}" }], todaySettings: { workStart: "00:00", workEnd: "23:59", reminder: "08:30", startOnToday: true, autoBrief: true, blockReminders: true } })`);
    await p.goto("today");
    await sleep(800);
    const card = await p.eval(`document.querySelector('[data-testid="meeting-prep"]')?.innerText ?? ""`);
    check("Meeting prep: shows last time's summary, decisions and open questions", card.includes("Acme pilot review") && card.includes("Agreed on a two-week pilot.") && card.includes("Pilot starts Monday") && card.includes("Who signs the contract?") && /same meet link/i.test(card), card.slice(0, 400));
    check("Meeting prep: open items exclude done to-dos; related to-dos show", card.includes("Send Priya the pilot plan") && !card.includes("Draft the pricing sheet") && card.includes("Call Priya about pricing") && !card.includes("Buy milk"));
    const brief = await p.eval(`document.querySelector('[data-testid="brief-prep"]')?.innerText ?? ""`);
    check("Meeting prep: the daily brief has a line for the meeting", brief.includes("Acme pilot review") && brief.includes("Send Priya the pilot plan"), brief);
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('[data-testid="meeting-prep"]'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): Meeting prep has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    await p.eval(`document.querySelector('button[aria-label="+ To-do: Send Priya the pilot plan"]').click()`);
    await sleep(900);
    const { todos = [] } = await p.storage(["todos"]);
    check("Meeting prep: + To-do adds the action item", todos.some((t) => t.title === "Send Priya the pilot plan" && !t.completed));
    check("Meeting prep: the item then shows as in to-dos", (await p.eval(`document.querySelector('[data-testid="meeting-prep"]').innerText`)).includes("In to-dos ✓"));
    await p.click("Open last meeting");
    await sleep(1800);
    check("Meeting prep: Open last meeting opens it in Meetings", (await p.eval(`document.body.innerText`)).includes("Agreed on a two-week pilot.") && (await p.eval(`chrome.storage.local.get("lastSection").then(r => r.lastSection)`)) === "meetings");
    await p.eval(`new Promise((resolve) => { const req = indexedDB.open("prodli-meetings", 1); req.onsuccess = () => { const tx = req.result.transaction("meetings", "readwrite"); tx.objectStore("meetings").delete("mtg_prep"); tx.oncomplete = () => resolve(true); }; })`);
    await p.eval(`chrome.storage.local.set({ todos: [], days: [] }).then(() => chrome.storage.local.remove("todaySettings"))`);
    await p.close();
  },

  async asksources(b, check) {
    // Ask ProdLi: sources you can open, saved prompts, schedules, and a scheduled answer (stubbed AI; test builds only).
    const axeSource = readFileSync(path.resolve(path.dirname(EXT), "node_modules/axe-core/axe.min.js"), "utf8");
    const p = await b.openPage();
    const now = new Date().toISOString();
    await p.eval(`chrome.storage.local.set({ askPrompts: [], askInbox: [], notes: [{ id: "n-launch", title: "Launch plan", content: "<h1>Launch plan</h1><p>Ship the beta on Friday.</p>", createdAt: "${now}", updatedAt: "${now}" }, { id: "n-other", title: "Groceries", content: "<p>Milk</p>", createdAt: "${now}", updatedAt: "${now}" }], activeNoteId: "n-other" })`);
    await p.goto("today");
    const stub = `(() => { window.__asks = []; globalThis.__prodliAskStub = async (body) => { window.__asks.push(body); const n = body.snippets.findIndex((x) => x.title === "Launch plan") + 1; return { answer: "You ship the beta on Friday.", actions: [], sources: n ? [n] : [] }; }; return true; })()`;
    await p.eval(stub);
    await p.eval(`document.querySelector('button[title="Ask ProdLi (AI assistant)"]').click()`);
    await sleep(500);
    await p.eval(`(() => { const t = document.querySelector('textarea[aria-label="Ask ProdLi a question"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "When do we ship the launch?"); t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(100);
    await p.eval(`document.querySelector('.ask-panel form button[type="submit"]').click()`);
    await sleep(800);
    const sent = await p.eval("window.__asks");
    check("Ask: note snippets are sent without their ids", sent.length === 1 && sent[0].snippets.some((x) => x.title === "Launch plan") && sent[0].snippets.every((x) => !("id" in x)), JSON.stringify(sent[0]?.snippets));
    check("Ask: the answer shows its source", (await p.eval(`document.querySelector('[data-testid="ask-sources"]')?.innerText ?? ""`)).includes("Launch plan"));
    for (const theme of ["light", "dark"]) {
      await p.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
      await sleep(150);
      await p.eval(axeSource + ";true");
      const v = await p.eval(`axe.run(document.querySelector('.ask-panel'), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
      check(`A11y (${theme}): Ask with sources and saving has no serious problems`, v.length === 0, v.join(", "));
    }
    await p.eval(`document.documentElement.classList.remove("dark")`);
    // Save the question.
    await p.eval(`document.querySelector('button[aria-label="Save prompt: When do we ship the launch?"]').click()`);
    await sleep(400);
    let { askPrompts = [] } = await p.storage(["askPrompts"]);
    check("Ask: ☆ Save prompt saves the question", askPrompts.length === 1 && askPrompts[0].text === "When do we ship the launch?");
    // Clicking the source opens that note.
    await p.eval(`[...document.querySelectorAll('[data-testid="ask-sources"] button')].find(b => b.textContent.includes("Launch plan")).click()`);
    await sleep(1800);
    check("Ask: clicking a source opens that note", (await p.eval(`chrome.storage.local.get("activeNoteId").then(r => r.activeNoteId)`)) === "n-launch" && (await p.editorHtml()).includes("Ship the beta"));
    // A new chat shows saved prompts; schedule one.
    await p.eval(stub);
    await p.eval(`document.querySelector('button[title="Ask ProdLi (AI assistant)"]').click()`);
    await sleep(400);
    await p.click("New chat").catch(() => {});
    await sleep(300);
    check("Ask: saved prompts show in a new chat", (await p.eval(`document.querySelector('[data-testid="saved-prompts"]')?.innerText ?? ""`)).includes("When do we ship the launch?"));
    await p.eval(`document.querySelector('button[aria-label="Schedule: When do we ship the launch?"]').click()`);
    await sleep(200);
    await p.eval(`document.querySelector('[data-testid="saved-prompts"] button[aria-label="Monday"]').click()`);
    await sleep(800);
    ({ askPrompts = [] } = await p.storage(["askPrompts"]));
    const alarms = await p.eval(`chrome.alarms.getAll().then(a => a.map(x => x.name))`);
    check("Ask: scheduling saves the days and sets an alarm", askPrompts[0]?.schedule?.time === "08:30" && JSON.stringify(askPrompts[0]?.schedule?.days) === "[1]" && alarms.includes(`askprompt:${askPrompts[0].id}`), JSON.stringify({ s: askPrompts[0]?.schedule, alarms }));
    await p.eval(`document.querySelector('[data-testid="saved-prompts"] button[aria-label^="Remove saved prompt"]').click()`);
    await sleep(800);
    check("Ask: removing a saved prompt clears its alarm", !(await p.eval(`chrome.alarms.getAll().then(a => a.some(x => x.name.startsWith("askprompt:")))`)));
    // A scheduled answer's notification opens Ask with the answer.
    await p.eval(`chrome.storage.local.set({ askInbox: [{ id: "in1", promptId: "x", question: "What's overdue?", answer: "Nothing is overdue.", sources: [], at: "${now}" }], openAskInbox: "in1" })`);
    await p.send("Page.reload", {});
    await sleep(1800);
    check("Ask: a scheduled answer opens in Ask ProdLi", (await p.eval(`document.querySelector('.ask-panel')?.innerText ?? ""`)).includes("Nothing is overdue.") && !(await p.storage(["openAskInbox"])).openAskInbox, JSON.stringify({ panel: await p.eval(`document.querySelector('.ask-panel')?.innerText?.slice(0, 200) ?? "none"`), key: (await p.storage(["openAskInbox"])).openAskInbox }));
    await p.eval(`chrome.storage.local.set({ askPrompts: [], askInbox: [], notes: [] })`);
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

  async settings(b, check) {
    // Settings › Sections: each section's own settings, in one place.
    const p = await b.openPage();
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true })`);
    await p.goto("pomodoro");
    const open = (tab) => p.eval(`window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "${tab}" } }))`);
    await p.click("⚙ Settings", { exact: false });
    await sleep(500);
    check("Settings: Pomodoro's ⚙ opens Settings › Pomodoro", await p.eval(`!!document.querySelector('[data-testid="pomodoro-settings"]')`));
    await p.eval(`(() => { const i = document.querySelector('[data-testid="pomodoro-settings"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "40"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(200);
    await p.eval(`[...document.querySelectorAll('[data-testid="pomodoro-settings"] button')].find(b => b.textContent === "Save").click()`);
    await sleep(500);
    const { pomodoroSettings } = await p.storage(["pomodoroSettings"]);
    check("Settings: Pomodoro lengths are saved", pomodoroSettings?.workDuration === 40, JSON.stringify(pomodoroSettings));
    await open("tracker");
    await sleep(1200);
    check("Settings: Time Tracker settings are there", /idle threshold/i.test(await p.eval(`document.querySelector('[data-testid="settings-tracker"]').innerText`)));
    await open("meetings");
    await sleep(1200);
    check("Settings: Meetings setup is there", /AI summaries/i.test(await p.eval(`document.querySelector('[data-testid="settings-meetings"]').innerText`)));
    await open("files");
    await sleep(800);
    check("Settings: Files 'open from anywhere' is there", await p.eval(`!!document.querySelector('[data-testid="settings-files"] [data-testid="open-anywhere"]')`));
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
      ["pomodoro settings", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "pomodoro" } }))`],
      ["time tracker settings", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "tracker" } }))`],
      ["meetings settings", `window.dispatchEvent(new CustomEvent("prodli-settings", { detail: { tab: "meetings" } }))`],
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
    await p.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, agendaView: "list", todaySettings: { workStart: "00:00", workEnd: "23:59", reminder: null, startOnToday: false, autoBrief: false, blockReminders: true }, todos: [
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
      // Late at night some or all tasks may not fit: the message must match what happened.
      const unplaced = todos.filter((t) => ["b1", "b2"].includes(t.id) && !t.block).length;
      const agendaText = await p.eval(`document.querySelector('[data-testid="agenda"]').innerText`);
      check("Blocks: late at night, Block time says which tasks don't fit", unplaced > 0 ? /didn't fit/.test(agendaText) : !/didn't fit/.test(agendaText), `${unplaced} unplaced | ${agendaText.slice(0, 160)}`);
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
