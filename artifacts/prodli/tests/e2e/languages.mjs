// End-to-end tests for Settings → Language (A12): choosing Hindi makes
// dictation ask Whisper for Hindi and tell the clean-up, and makes 🎙 Speak
// tasks listen in hi-IN. Same set-up as dictation.mjs: a test build with the
// optional permissions granted, Chrome's fake microphone, and stand-ins for
// Whisper (__prodliTranscribeStub), the clean-up (__prodliDictateStub), the
// task finder (__prodliExtractStub) and the browser's SpeechRecognition.
//
//   pnpm run build:extension:test && node tests/e2e/languages.mjs

import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-lang-")));
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
manifest.permissions = [...new Set([...manifest.permissions, "offscreen", "scripting"])];
manifest.host_permissions = ["https://compose.example/*"];
writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));
const extId = [...createHash("sha256").update(EXT).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
process.env.PRODLI_OUT_DIR = path.relative(path.resolve(here, "../.."), EXT);
process.env.PRODLI_CHROME_ARGS = `--allowlisted-extension-id=${extId} --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`;
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const COMPOSE = `<!doctype html><html lang="hi"><head><title>Compose</title></head><body>
<label>Notes <textarea id="t" rows="4" cols="60"></textarea></label>
</body></html>`;

const b = new Browser();
try {
  await b.loadExtension();
  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);
  const axeSource = readFileSync(path.resolve(here, "../..", "node_modules/axe-core/axe.min.js"), "utf8");

  // ── Settings → Language: choose Hindi ──────────────────────────────────────
  const settings = await b.openPage(`chrome-extension://${extId}/index.html#settings=language`);
  await sleep(1500);
  const text = await settings.eval(`document.querySelector('[data-testid="settings-language"]')?.innerText ?? ""`);
  check("index.html#settings=language opens Settings → Language", /Language/.test(text) && /daily brief/i.test(text), text.slice(0, 200));
  const options = await settings.eval(`[...document.querySelectorAll('[data-testid="language-settings"] option')].map((o) => o.textContent)`);
  check("The list has Automatic first and native names", options[0] === "Automatic" && options.includes("Hindi (हिन्दी)") && options.includes("Hinglish (Hindi in Latin letters)") && options.includes("Malayalam (മലയാളം)") && options.length === 13, JSON.stringify(options));
  check("Automatic is the default", (await settings.eval(`document.querySelector('[data-testid="language-settings"] select').value`)) === "auto");
  await settings.eval(`(() => { const s = document.querySelector('[data-testid="language-settings"] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "hi"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(300);
  check("Choosing Hindi saves it on this device", (await settings.storage("voiceLanguage")).voiceLanguage === "hi", JSON.stringify(await settings.storage("voiceLanguage")));
  for (const theme of ["light", "dark"]) {
    await settings.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
    await sleep(150);
    await settings.eval(axeSource + ";true");
    const v = await settings.eval(`axe.run(document.querySelector('[data-testid="settings-language"]'), { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length))`);
    check(`A11y (${theme}): Settings → Language has no serious problems`, v.length === 0, v.join(", "));
  }
  await settings.eval(`document.documentElement.classList.remove("dark")`);

  // The same setting shows in Settings → Dictation.
  await settings.eval(`document.querySelector('[data-settings-tab="dictation"]').click()`);
  await sleep(800);
  check("Settings → Dictation shows the same language", (await settings.eval(`document.querySelector('[data-testid="dictation-settings"] [data-testid="language-settings"] select')?.value ?? ""`)) === "hi");

  // ── Dictation: Whisper and the clean-up both get Hindi ─────────────────────
  await swEval(`(() => {
    globalThis.__langs = [];
    globalThis.__bodies = [];
    globalThis.__prodliTranscribeStub = async (_wav, _start, _vocab, language) => { __langs.push(language ?? null); return { text: "कल मिलते हैं", segments: [], language: "hi" }; };
    globalThis.__prodliDictateStub = async (body) => { __bodies.push(body); return { text: "कल मिलते हैं।" }; };
    return true;
  })()`);
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  await b.send("Runtime.enable", {}, sessionId);
  await b.send("Page.enable", {}, sessionId);
  await b.send("Fetch.enable", { patterns: [{ urlPattern: "https://compose.example/*" }] }, sessionId);
  const served = new Set();
  const pump = setInterval(() => {
    for (const e of b.events) {
      if (e.method !== "Fetch.requestPaused" || e.sessionId !== sessionId || served.has(e.params.requestId)) continue;
      served.add(e.params.requestId);
      void b.send("Fetch.fulfillRequest", { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: Buffer.from(COMPOSE).toString("base64") }, sessionId);
    }
  }, 30);
  await b.send("Page.navigate", { url: "https://compose.example/new" }, sessionId);
  await sleep(1200);
  await b.send("Page.bringToFront", {}, sessionId);
  const pageEval = async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  const dictate = () => swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://compose.example/*" }); await __prodliToggleDictation(t); return true; })()`);
  await pageEval(`(() => { document.getElementById("t").focus(); return true; })()`);
  await dictate();
  await sleep(2900);
  await dictate();
  let typed = "";
  for (let i = 0; i < 40 && !typed; i++) {
    await sleep(100);
    typed = await pageEval(`document.getElementById("t").value`);
  }
  const langs = await swEval(`__langs`);
  check("Dictation asks Whisper for Hindi (language: \"hi\")", langs.length > 0 && langs.every((l) => l === "hi"), JSON.stringify(langs));
  const body = await swEval(`__bodies[0] ?? null`);
  check("The clean-up request carries language: \"hi\"", body?.mode === "polish" && body?.language === "hi" && body?.text === "कल मिलते हैं", JSON.stringify(body));
  check("The Hindi text is typed in Devanagari", typed === "कल मिलते हैं।", JSON.stringify(typed));

  // Hinglish: Whisper still gets "hi", the clean-up gets "hinglish" (it writes Latin letters).
  await swEval(`chrome.storage.local.set({ voiceLanguage: "hinglish" }).then(() => { __langs = []; __bodies = []; __prodliDictateStub = async (body) => { __bodies.push(body); return { text: "Kal milte hain." }; }; return true; })`);
  await pageEval(`(() => { const t = document.getElementById("t"); t.value = ""; t.focus(); return true; })()`);
  await dictate();
  await sleep(2900);
  await dictate();
  let typed2 = "";
  for (let i = 0; i < 40 && !typed2; i++) {
    await sleep(100);
    typed2 = await pageEval(`document.getElementById("t").value`);
  }
  const hl = await swEval(`({ langs: __langs, body: __bodies[0] ?? null })`);
  check("Hinglish: Whisper gets \"hi\" and the clean-up gets \"hinglish\"", hl.langs.length > 0 && hl.langs.every((l) => l === "hi") && hl.body?.language === "hinglish" && typed2 === "Kal milte hain.", JSON.stringify({ ...hl, typed2 }));
  clearInterval(pump);
  await b.send("Target.closeTarget", { targetId });

  // ── 🎙 Speak tasks listens in hi-IN and keeps Hindi titles ──────────────────
  await swEval(`chrome.storage.local.set({ voiceLanguage: "hi" })`);
  const p = await b.openPage();
  await p.eval(`chrome.storage.local.set({ todos: [], lists: [] })`);
  await p.goto("todos");
  await p.eval(`(() => {
    window.__recLangs = [];
    class FakeRecognition extends EventTarget {
      constructor() { super(); this.lang = ""; this.continuous = false; this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null; }
      start() { window.__recLangs.push(this.lang); setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "कल शाम 5 बजे माँ को फ़ोन करना" }], { isFinal: true })] }), 50); }
      stop() { setTimeout(() => this.onend?.(), 10); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
    window.__dumps = [];
    globalThis.__prodliExtractStub = async (text, lists, language) => { window.__dumps.push({ text, language }); return { lines: ["माँ को फ़ोन करना tomorrow at 5pm"] }; };
    return true;
  })()`);
  await p.eval(`document.querySelector('button[aria-label="Speak tasks"]').click()`);
  await sleep(400);
  await p.click("🎙 Talk");
  await sleep(400);
  check("Speak tasks listens in hi-IN", (await p.eval(`window.__recLangs`)).join() === "hi-IN", JSON.stringify(await p.eval(`window.__recLangs`)));
  await p.click("■ Stop");
  await sleep(200);
  await p.click("Make tasks");
  await sleep(500);
  const dumps = await p.eval(`window.__dumps`);
  check("Speak tasks sends the Hindi words with language: \"hi\"", dumps.length === 1 && dumps[0].language === "hi" && dumps[0].text.includes("माँ"), JSON.stringify(dumps));
  const review = await p.eval(`(() => { const li = document.querySelector('[data-testid="voice-task"]'); return li ? { line: li.querySelector('input:not([type="checkbox"])').value, chips: li.innerText } : null; })()`);
  check("The Hindi title keeps its date and time (📅 ⏰)", review?.line === "माँ को फ़ोन करना tomorrow at 5pm" && /📅/.test(review.chips) && /⏰/.test(review.chips), JSON.stringify(review));
  await p.close();
} catch (err) {
  console.log(`  ✗ languages crashed: ${err?.stack ?? err}`);
  failures++;
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
