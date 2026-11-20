#!/usr/bin/env node
// Meeting recorder, end to end, in a real (headless) Chrome with the built extension:
// toolbar click → tab audio capture (offscreen recorder) → captions read from the
// Meet page → stop → meeting saved with transcript and audio. Then Zoom and Teams
// web calls: audio only, transcribed with (stubbed) AI after the call.
//
// The Meet page is a stand-in served at a real meet.google.com address (requests are
// intercepted), with Meet's caption controls. Chrome needs the toolbar click to allow
// tab capture; the test build exposes the click's code path and Chrome is told to trust
// this extension (--allowlisted-extension-id), the standard way Chrome's own tests do it.
//
//   pnpm --filter @workspace/prodli run build:extension:test && node tests/e2e/recording.mjs

import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
// A copy with the recorder's optional permissions already granted (Chrome would ask the user).
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-rec-"))); // Chrome hashes the real path
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
manifest.permissions = [...new Set([...manifest.permissions, "tabCapture", "offscreen", "scripting"])];
manifest.host_permissions = ["https://meet.google.com/*"];
writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));
const extId = [...createHash("sha256").update(EXT).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

process.env.PRODLI_OUT_DIR = path.relative(path.resolve(here, "../.."), EXT);
process.env.PRODLI_CHROME_ARGS = `--allowlisted-extension-id=${extId}`;
// Sound on: a muted browser also silences captured tab audio, and the Zoom check needs real audio.
// The stand-in calls play a very quiet tone for a few seconds.
process.env.PRODLI_UNMUTE = "1";
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

// A stand-in for a Meet call: title, Leave button, captions button that shows the captions region.
const MEET_HTML = `<!doctype html><html><head><title>Meet - Weekly product sync</title></head><body>
<button aria-label="Leave call">Leave</button>
<button aria-label="Turn on captions" aria-pressed="false">CC</button>
<audio id="a" autoplay loop></audio>
<script>
  // A little sound so there is tab audio to record.
  const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.02; o.connect(g); g.connect(ctx.destination); o.start();
  document.querySelector('[aria-label="Turn on captions"]').addEventListener('click', (e) => {
    e.currentTarget.setAttribute('aria-pressed', 'true');
    const r = document.createElement('div'); r.setAttribute('role', 'region'); r.setAttribute('aria-label', 'Captions'); r.id = 'cap'; document.body.appendChild(r);
  });
  window.__say = (who, text) => { const d = document.createElement('div'); d.innerHTML = '<img alt=""><div>' + who + '</div><div class="t">' + text + '</div>'; document.getElementById('cap').appendChild(d); };
</script></body></html>`;

// A call where captions don't come on by themselves (e.g. a work account where ProdLi can't find the CC button).
const NO_CC_HTML = `<!doctype html><html><head><title>Meet - Captions off call</title></head><body>
<button aria-label="Leave call">Leave</button>
<script>
  window.__captionsOn = () => { const r = document.createElement('div'); r.setAttribute('role', 'region'); r.setAttribute('aria-label', 'Captions'); r.id = 'cap'; document.body.appendChild(r); };
</script></body></html>`;

const b = new Browser();
try {
  const id = await b.loadExtension();
  check("Extension loaded with the expected ID", id === extId, `${id} vs ${extId}`);

  // Open the "Meet call" (intercepted).
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  await b.send("Runtime.enable", {}, sessionId);
  await b.send("Page.enable", {}, sessionId);
  await b.send("Fetch.enable", { patterns: [{ urlPattern: "https://meet.google.com/*" }] }, sessionId);
  const served = new Set();
  const pump = setInterval(() => {
    for (const e of b.events) {
      if (e.method !== "Fetch.requestPaused" || served.has(e.params.requestId) || !e.params.request.url.startsWith("https://meet.google.com/")) continue;
      served.add(e.params.requestId);
      const html = e.params.request.url.includes("zzz-yyyy-xxx") ? NO_CC_HTML : MEET_HTML;
      void b.send("Fetch.fulfillRequest", { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from(html).toString("base64") }, e.sessionId);
    }
  }, 50);
  await b.send("Page.navigate", { url: "https://meet.google.com/abc-defg-hij?authuser=0" }, sessionId);
  await sleep(1500);
  const meet = { eval: async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value };
  check("Meet stand-in is open at meet.google.com", (await meet.eval("location.href")).startsWith("https://meet.google.com/abc-defg-hij"));

  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);
  check("Test hook for the toolbar click is available", await swEval("typeof __prodliToggleRecording === 'function'"));

  // Click (start).
  const startErr = await swEval(`(async () => { try { const [t] = await chrome.tabs.query({ url: "https://meet.google.com/*" }); await __prodliToggleRecording(t); return null; } catch (e) { return String(e); } })()`);
  await sleep(2500);
  const badge = await swEval("chrome.action.getBadgeText({})");
  const state = await swEval(`chrome.storage.session.get("rec_state").then(r => r.rec_state ?? null)`);
  const notifications = await swEval(`(async () => { const r = await new Promise((res) => indexedDB.open("prodli-meetings").onsuccess = (e) => { const q = e.target.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => res(q.result); }); return r.map((m) => m.status + ": " + (m.error ?? "")); })()`);
  check("Clicking ProdLi on a Meet call starts recording (REC badge)", badge === "REC" && !!state, `badge=${JSON.stringify(badge)} state=${JSON.stringify(state)} err=${startErr} notifications=${JSON.stringify(notifications)}`);
  check("Meet: no microphone warning (Meet's captions include you)", !(await swEval(`chrome.notifications.getAll().then((n) => Object.keys(n))`)).includes("rec_mic_off"));
  check("No new ProdLi tab was opened instead", !(await b.send("Target.getTargets")).targetInfos.some((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${extId}/index.html`)));
  check("Captions were switched on, with no label in the call (off by default)", await meet.eval(`!!document.getElementById('cap') && !document.querySelector('[data-prodli-badge]')`));

  // People talk.
  await meet.eval(`__say('Priya Shah', 'Let us ship the onboarding emails on Friday.'); true`);
  await sleep(1500);
  await meet.eval(`__say('You', 'I will prepare the release notes.'); true`);
  await sleep(3500);

  // Click again (stop).
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://meet.google.com/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(3000);
  check("Clicking again stops (badge cleared)", (await swEval("chrome.action.getBadgeText({})")) === "");

  // The saved meeting, read the way the Meetings section reads it.
  const page = await b.openPage(`chrome-extension://${extId}/index.html`);
  const meetings = await page.eval(`new Promise((res, rej) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); })`);
  const m = meetings[0];
  check("The meeting is saved", meetings.length === 1, JSON.stringify(meetings.map((x) => ({ status: x.status, error: x.error }))));
  check("…with its title from the Meet page", m?.title === "Weekly product sync" || m?.title?.includes("abc-defg-hij"), m?.title);
  check("…and the transcript from captions", JSON.stringify((m?.transcript ?? []).map((e) => `${e.speaker}: ${e.text}`)) === JSON.stringify(["Priya Shah: Let us ship the onboarding emails on Friday.", "You: I will prepare the release notes."]), JSON.stringify(m?.transcript));
  check("…and the audio recording", m?.hasAudio === true, JSON.stringify({ hasAudio: m?.hasAudio, error: m?.error, notice: m?.notice }));
  check("…and it isn't left in an error state", m && m.status !== "error" && !String(m.error ?? "").startsWith("Recording couldn't start"), `${m?.status} ${m?.error}`);

  // Captions don't come on: warn in the call and turn the icon amber (CC); clear both once they're on.
  const { targetId: t2 } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s2 } = await b.send("Target.attachToTarget", { targetId: t2, flatten: true });
  await b.send("Runtime.enable", {}, s2);
  await b.send("Page.enable", {}, s2);
  await b.send("Fetch.enable", { patterns: [{ urlPattern: "https://meet.google.com/*" }] }, s2);
  await b.send("Page.navigate", { url: "https://meet.google.com/zzz-yyyy-xxx" }, s2);
  await sleep(1500);
  const noCc = { eval: async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s2)).result.value };
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://meet.google.com/zzz-yyyy-xxx*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(4000);
  check("Captions off: no warning during the first seconds (ProdLi is still turning them on)", !(await noCc.eval(`!!document.querySelector('[data-prodli-captions-warning]')`)) && (await swEval("chrome.action.getBadgeText({})")) === "REC");
  await sleep(14000);
  const warnText = await noCc.eval(`document.querySelector('[data-prodli-captions-warning]')?.textContent ?? ""`);
  check("Captions off: a note in the call asks to turn on CC", /turn on captions \(CC\)/i.test(warnText), warnText);
  check("Captions off: the ProdLi icon turns amber CC", (await swEval("chrome.action.getBadgeText({})")) === "CC" && /captions are off/i.test(await swEval("chrome.action.getTitle({})")));
  await noCc.eval(`__captionsOn(); true`);
  await sleep(4500);
  check("Captions on again: the note goes away and the icon is back to REC", !(await noCc.eval(`!!document.querySelector('[data-prodli-captions-warning]')`)) && (await swEval("chrome.action.getBadgeText({})")) === "REC");
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://meet.google.com/zzz-yyyy-xxx*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(2500);

  // Zoom and Teams calls in the browser: tab audio, no captions; AI transcription after the call (stubbed AI).
  const CALL_HTML = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><script>const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = 330; const g = ctx.createGain(); g.gain.value = 0.02; o.connect(g); g.connect(ctx.destination); o.start();</script></body></html>`;
  const openCall = async (pattern, url, title) => {
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Runtime.enable", {}, sessionId);
    await b.send("Page.enable", {}, sessionId);
    await b.send("Fetch.enable", { patterns: [{ urlPattern: pattern }] }, sessionId);
    const done = new Set();
    const serve = setInterval(() => {
      for (const e of b.events) {
        if (e.method !== "Fetch.requestPaused" || e.sessionId !== sessionId || done.has(e.params.requestId)) continue;
        done.add(e.params.requestId);
        b.send("Fetch.fulfillRequest", { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from(CALL_HTML(title)).toString("base64") }, sessionId).catch(() => {});
      }
    }, 50);
    await b.send("Page.navigate", { url }, sessionId);
    await sleep(1500);
    return { targetId, stop: () => clearInterval(serve) };
  };
  const readMeetings = () => swEval(`new Promise((res) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => res(q.result.map((m) => ({ id: m.id, platform: m.platform, title: m.title, code: m.meetingCode, status: m.status, hasAudio: m.hasAudio, notice: m.notice, error: m.error, source: m.transcriptSource, languages: m.audioLanguages, transcript: m.transcript.map((e) => e.speaker + ": " + e.text) }))); }; })`);
  const waitReady = async (platform) => {
    for (let i = 0; i < 40; i++) {
      const m = (await readMeetings()).find((x) => x.platform === platform);
      if (m && m.status !== "recording" && m.status !== "processing") return m;
      await sleep(500);
    }
    return (await readMeetings()).find((x) => x.platform === platform);
  };
  await swEval(`(() => { globalThis.__pieces = []; globalThis.__prodliTranscribeStub = async (wav, startMs) => { __pieces.push({ bytes: wav.length, startMs }); return { text: "We agreed on a two-week pilot.", segments: [{ start: 0, end: 2, text: "We agreed on a two-week pilot." }], language: "en" }; }; return true; })()`);
  const zoom = await openCall("https://app.zoom.us/*", "https://app.zoom.us/wc/86012345678/join?pwd=abc", "Acme pilot review - Zoom");
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://app.zoom.us/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(2000);
  check("Zoom: clicking ProdLi on a Zoom web call starts recording", (await swEval("chrome.action.getBadgeText({})")) === "REC" && /Zoom call's audio/.test(await swEval("chrome.action.getTitle({})")), await swEval("chrome.action.getTitle({})"));
  check("Zoom: with the microphone off, a notification and the icon say your voice isn't recorded", (await swEval(`chrome.notifications.getAll().then((n) => Object.keys(n))`)).includes("rec_mic_off") && /microphone is off/.test(await swEval("chrome.action.getTitle({})")));
  await sleep(5000);
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://app.zoom.us/*" }); await __prodliToggleRecording(t); return true; })()`);
  const zm = await waitReady("zoom");
  check("Zoom: the meeting is saved with its name from the tab and the meeting ID", zm?.title === "Acme pilot review" && zm?.code === "86012345678", JSON.stringify(zm));
  check("Zoom: the audio is recorded and transcribed with AI after the call", zm?.hasAudio === true && zm?.source === "audio" && zm?.transcript?.[0] === "Speaker: We agreed on a two-week pilot." && JSON.stringify(zm?.languages) === '["en"]', JSON.stringify(zm));
  check("Zoom: the saved meeting notes that your own voice isn't in it", /Your own voice isn't in this recording/.test(zm?.notice ?? "") && !/couldn't be transcribed/.test(zm?.notice ?? ""), zm?.notice);
  const pieces = await swEval("__pieces");
  check("Zoom: audio went to the AI in WAV pieces through the background", pieces.length >= 1 && pieces.every((x) => x.bytes > 44), JSON.stringify(pieces));
  check("Zoom: the badge is cleared", (await swEval("chrome.action.getBadgeText({})")) === "");
  zoom.stop();

  // Teams, with AI transcription switched off: the audio is kept and the meeting says how to get a transcript.
  await swEval(`chrome.storage.local.set({ recorderAutoTranscribe: false }).then(() => { __pieces = []; return true; })`);
  const teams = await openCall("https://teams.microsoft.com/*", "https://teams.microsoft.com/v2/", "Weekly sync | Microsoft Teams");
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://teams.microsoft.com/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(4000);
  check("Teams: clicking ProdLi on a Teams tab starts recording", (await swEval("chrome.action.getBadgeText({})")) === "REC");
  // Closing the call's tab stops the recording.
  await b.send("Target.closeTarget", { targetId: teams.targetId });
  const tm = await waitReady("teams");
  check("Teams: closing the tab saves the meeting with audio", tm?.title === "Weekly sync" && tm?.hasAudio === true && (await swEval("chrome.action.getBadgeText({})")) === "", JSON.stringify(tm));
  check("Teams: with AI transcription off, nothing is sent and the meeting says how to get a transcript", (await swEval("__pieces")).length === 0 && /saved as audio.*Transcribe audio with AI/.test(tm?.notice ?? ""), tm?.notice);
  teams.stop();
  await swEval(`chrome.storage.local.remove("recorderAutoTranscribe").then(() => { delete globalThis.__prodliTranscribeStub; return true; })`);

  // More call apps: Webex is recognised from its address; any other site only with "Record any website" on.
  const waitPlatform = async (platform) => {
    for (let i = 0; i < 40; i++) {
      const m = (await readMeetings()).find((x) => x.platform === platform);
      if (m && m.status !== "recording" && m.status !== "processing") return m;
      await sleep(500);
    }
    return (await readMeetings()).find((x) => x.platform === platform);
  };
  const webex = await openCall("https://acme.webex.com/*", "https://acme.webex.com/meet/jordan", "Weekly sync - Webex");
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://acme.webex.com/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(2500);
  check("Webex: clicking ProdLi on a Webex call starts recording", (await swEval("chrome.action.getBadgeText({})")) === "REC" && /Webex call's audio/.test(await swEval("chrome.action.getTitle({})")), await swEval("chrome.action.getTitle({})"));
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://acme.webex.com/*" }); await __prodliToggleRecording(t); return true; })()`);
  const wx = await waitPlatform("webex");
  check("Webex: the meeting is saved with its name from the tab", wx?.title === "Weekly sync" && wx?.status === "ready", JSON.stringify(wx));
  webex.stop();
  await swEval(`chrome.storage.local.set({ recorderAnyTab: true }).then(() => true)`);
  const anySite = await openCall("https://meetings.example.org/*", "https://meetings.example.org/room/42", "Zoho Meeting - Design review");
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://meetings.example.org/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(2500);
  check("Any website (Setup option on): clicking ProdLi on another site records that tab", (await swEval("chrome.action.getBadgeText({})")) === "REC" && /recording this tab's audio/.test(await swEval("chrome.action.getTitle({})")), await swEval("chrome.action.getTitle({})"));
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://meetings.example.org/*" }); await __prodliToggleRecording(t); return true; })()`);
  const br = await waitPlatform("browser");
  check("Any website: the meeting is saved as a browser call with the tab's title", br?.title === "Zoho Meeting - Design review" && br?.status === "ready", JSON.stringify(br));
  anySite.stop();
  await swEval(`chrome.storage.local.remove("recorderAnyTab").then(() => true)`);

  // Clicking on a page that isn't a Meet call explains why instead of silently opening ProdLi.
  const other = await b.openPage("https://example.com/");
  await sleep(500);
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://example.com/*" }); await __prodliToggleRecording(t); return true; })()`);
  await sleep(1500);
  const last = await swEval(`chrome.storage.local.get("recorderLastProblem").then(r => r.recorderLastProblem ?? null)`);
  check("Clicking on a tab that isn't a call records why (shown in ProdLi)", !!last?.message && /Webex, Slack huddles, Discord/.test(last.message) && /Record any website/.test(last.message), JSON.stringify(last));
  await sleep(1500);
  const prodliTab = (await b.send("Target.getTargets")).targetInfos.find((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${extId}/index.html`) && t.targetId !== page.targetId);
  if (prodliTab) {
    const { sessionId: ps } = await b.send("Target.attachToTarget", { targetId: prodliTab.targetId, flatten: true });
    await b.send("Runtime.enable", {}, ps);
    await sleep(1500);
    const banner = (await b.send("Runtime.evaluate", { expression: `document.querySelector('[data-testid="recorder-problem"]')?.innerText ?? ""`, returnByValue: true }, ps)).result.value;
    check("…and ProdLi opens on Meetings showing that reason", /Recording didn't start/.test(banner) && /Google Meet/.test(banner), banner);
  } else check("…and ProdLi opens on Meetings showing that reason", false, "no ProdLi tab opened");
  clearInterval(pump);

  const errors = b.jsErrors().filter((e) => !/Failed to load resource|favicon/.test(JSON.stringify(e)));
  for (const e of errors.slice(0, 5)) console.log("   JS error:", (e.params.exceptionDetails?.exception?.description ?? JSON.stringify(e.params.args ?? e.params)).slice(0, 300));
  check("No JavaScript errors", errors.length === 0);
} finally {
  b.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
