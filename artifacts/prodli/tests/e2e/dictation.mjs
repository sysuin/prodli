// End-to-end tests for voice dictation (Alt+Shift+D): a test build with the
// optional permissions granted, Chrome's fake microphone (beeps), and stand-ins
// for Whisper (__prodliTranscribeStub) and the AI clean-up (__prodliDictateStub).
// Pages are served by intercepting requests, so nothing goes over the network.
//
//   pnpm run build:extension:test && node tests/e2e/dictation.mjs

import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-dict-")));
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
// Granted up front (the user grants them in Settings → Dictation / by pressing the shortcut).
manifest.permissions = [...new Set([...manifest.permissions, "offscreen", "scripting"])];
manifest.host_permissions = ["https://compose.example/*", "https://mail.google.com/*"];
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

const COMPOSE = `<!doctype html><html><head><title>Compose</title></head><body>
<label>Notes <textarea id="t" rows="4" cols="60">Hello</textarea></label>
<label>Subject <input id="i" value=""></label>
</body></html>`;
const GMAIL = `<!doctype html><html><head><title>Inbox - Gmail</title></head><body>
<div id="body" contenteditable="true" role="textbox" aria-multiline="true" style="min-height:80px;border:1px solid #ccc">Hi Sam,<br><br></div>
</body></html>`;

const b = new Browser();
try {
  await b.loadExtension();
  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);

  // Pages, served by intercepting requests.
  async function open(url, html) {
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Runtime.enable", {}, sessionId);
    await b.send("Page.enable", {}, sessionId);
    const origin = new URL(url).origin;
    await b.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*` }] }, sessionId);
    const served = new Set();
    const pump = setInterval(() => {
      for (const e of b.events) {
        if (e.method !== "Fetch.requestPaused" || e.sessionId !== sessionId || served.has(e.params.requestId)) continue;
        served.add(e.params.requestId);
        void b.send("Fetch.fulfillRequest", { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from(html).toString("base64") }, sessionId);
      }
    }, 30);
    await b.send("Page.navigate", { url }, sessionId);
    await sleep(1200);
    await b.send("Page.bringToFront", {}, sessionId);
    const page = {
      eval: async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value,
      key: (key) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: key === "Escape" ? 27 : 0 }, sessionId),
      close: async () => {
        clearInterval(pump);
        await b.send("Target.closeTarget", { targetId });
      },
    };
    return page;
  }
  const dictate = (urlPrefix) => swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "${urlPrefix}*" }); await __prodliToggleDictation(t); return true; })()`);
  const pill = (page) => page.eval(`(() => { const h = document.querySelector("[data-prodli-dictation]"); return h ? h.shadowRoot.querySelector(".pill").innerText : null; })()`);

  // Stand-ins for Whisper and the clean-up.
  await swEval(`(() => {
    globalThis.__heard = "um so let's meet on tuesday no wait wednesday";
    globalThis.__bodies = [];
    globalThis.__prodliTranscribeStub = async () => ({ text: globalThis.__heard, segments: [], language: "en" });
    globalThis.__prodliDictateStub = async (body) => { __bodies.push(body); return { text: body.mode === "command" ? "THURSDAY" : "So let's meet on Wednesday." }; };
    return true;
  })()`);

  // ── Dictating into a textarea on a website ─────────────────────────────────
  const page = await open("https://compose.example/new", COMPOSE);
  await page.eval(`(() => { const t = document.getElementById("t"); t.focus(); t.setSelectionRange(5, 5); return true; })()`);
  await dictate("https://compose.example/");
  await sleep(700);
  const listening = await pill(page);
  check("Shortcut: a pill shows in the page while listening", !!listening && /Listening/.test(listening) && /Esc cancels/.test(listening), String(listening));
  await sleep(2200);
  await dictate("https://compose.example/");
  let typed = "";
  let doneMsg = "";
  for (let i = 0; i < 40 && !typed.includes("Wednesday"); i++) {
    await sleep(100);
    typed = await page.eval(`document.getElementById("t").value`);
    doneMsg = (await pill(page)) ?? "";
  }
  check("Finishing types the cleaned-up text where the cursor was (with a space)", typed === "Hello So let's meet on Wednesday.", JSON.stringify(typed));
  const body = await swEval(`__bodies[0] ?? null`);
  check("The raw speech goes to the AI clean-up with the site's style and the field kind", body?.mode === "polish" && body?.text === "um so let's meet on tuesday no wait wednesday" && body?.style === "neutral" && body?.field === "document", JSON.stringify(body));
  check("The pill says what happened", /Typed 5 words/.test(doneMsg), doneMsg);
  const hist = await swEval(`chrome.storage.local.get("dictationHistory").then((r) => r.dictationHistory ?? [])`);
  check("The dictation is kept in the history on this device", hist.length === 1 && hist[0].text === "So let's meet on Wednesday." && hist[0].site === "compose.example" && hist[0].words === 5, JSON.stringify(hist));

  // ── Command Mode: selected text + a spoken instruction ─────────────────────
  await page.eval(`(() => { const t = document.getElementById("t"); t.focus(); const v = t.value; const at = v.indexOf("Wednesday"); t.setSelectionRange(at, at + "Wednesday".length); return true; })()`);
  await swEval(`(() => { globalThis.__heard = "make it thursday"; return true; })()`);
  await dictate("https://compose.example/");
  await sleep(700);
  check("With text selected, the pill asks how to change it (Command Mode)", /change the selection/.test((await pill(page)) ?? ""), String(await pill(page)));
  await sleep(1800);
  await dictate("https://compose.example/");
  await sleep(1800);
  const commanded = await page.eval(`document.getElementById("t").value`);
  const cbody = await swEval(`__bodies[__bodies.length - 1]`);
  check("Command Mode replaces the selection with the edited text", commanded === "Hello So let's meet on THURSDAY." && cbody.mode === "command" && cbody.selection === "Wednesday" && cbody.text === "make it thursday", JSON.stringify({ commanded, cbody }));

  // ── Snippets: the whole dictation is a cue ─────────────────────────────────
  await swEval(`chrome.storage.local.set({ dictationSnippets: [{ id: "s1", cue: "my calendar link", text: "https://cal.example/me" }] }).then(() => { globalThis.__heard = "My calendar link."; globalThis.__bodies = []; return true; })`);
  await page.eval(`(() => { document.getElementById("i").focus(); return true; })()`);
  await dictate("https://compose.example/");
  await sleep(2400);
  await dictate("https://compose.example/");
  await sleep(1600);
  check("Saying a snippet's cue types the snippet, without the AI", (await page.eval(`document.getElementById("i").value`)) === "https://cal.example/me" && (await swEval(`__bodies.length`)) === 0, await page.eval(`document.getElementById("i").value`));

  // ── Spacing: dictating in front of existing text keeps a space after it ─────
  await swEval(`(() => { globalThis.__heard = "quick note"; globalThis.__prodliDictateStub = async (body) => ({ text: "Quick note." }); return true; })()`);
  await page.eval(`(() => { const i = document.getElementById("i"); i.value = "Done"; i.focus(); i.setSelectionRange(0, 0); return true; })()`);
  await dictate("https://compose.example/");
  await sleep(2400);
  await dictate("https://compose.example/");
  await sleep(1600);
  check("Dictating before existing text adds a space between them", (await page.eval(`document.getElementById("i").value`)) === "Quick note. Done", await page.eval(`document.getElementById("i").value`));

  // ── Esc cancels ─────────────────────────────────────────────────────────────
  await page.eval(`(() => { const t = document.getElementById("t"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`);
  const before = await page.eval(`document.getElementById("t").value`);
  await dictate("https://compose.example/");
  await sleep(900);
  await page.key("Escape");
  await sleep(1500);
  check("Esc cancels: nothing is typed and the pill goes away", (await page.eval(`document.getElementById("t").value`)) === before && (await pill(page)) === null, String(await pill(page)));
  check("…and the microphone is released (no offscreen document left)", (await swEval(`chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).then((c) => c.length)`)) === 0);
  await page.close();

  // ── Email: formal style, typed into a rich text editor ─────────────────────
  await swEval(`(() => { globalThis.__heard = "thanks for the update ill send it tomorrow"; globalThis.__bodies = []; globalThis.__prodliDictateStub = async (body) => { __bodies.push(body); return { text: "Thanks for the update.\\nI'll send it tomorrow." }; }; return true; })()`);
  const gmail = await open("https://mail.google.com/mail/u/0/", GMAIL);
  await gmail.eval(`(() => { const el = document.getElementById("body"); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await dictate("https://mail.google.com/");
  await sleep(2400);
  await dictate("https://mail.google.com/");
  await sleep(1800);
  const ebody = await swEval(`__bodies[0] ?? null`);
  check("Email sites get the formal style and email formatting", ebody?.style === "formal" && ebody?.field === "email", JSON.stringify(ebody));
  const html = await gmail.eval(`document.getElementById("body").innerHTML`);
  check("Rich text editors get the text, with its line breaks", html.includes("Thanks for the update.") && html.includes("I'll send it tomorrow.") && /<br>/.test(html.split("Thanks")[1] ?? ""), html);
  await gmail.close();

  // ── Settings → Dictation ───────────────────────────────────────────────────
  const settings = await b.openPage(`chrome-extension://${extId}/index.html#settings=dictation`);
  await sleep(1500);
  const text = await settings.eval(`document.querySelector('[data-testid="dictation-settings"]')?.innerText ?? ""`);
  check("index.html#settings=dictation opens Settings → Dictation", /Dictation/i.test(text) && /Snippets/i.test(text) && /Command Mode/i.test(text), text.slice(0, 200));
  check("Settings shows this device's dictation stats", await (async () => { const words = (await settings.eval(`chrome.storage.local.get("dictationHistory").then((r) => r.dictationHistory.reduce((n, e) => n + e.words, 0))`)); return new RegExp(`\\b${words}\\b words this week`, "i").test(await settings.eval(`document.querySelector('[data-testid="dictation-stats"]').innerText`)); })(), await settings.eval(`document.querySelector('[data-testid="dictation-stats"]')?.innerText ?? ""`));
  await settings.eval(`(() => { const set = (sel, v) => { const el = document.querySelector(sel); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }; set('[aria-label="Snippet cue"]', "my address"); set('[aria-label="Snippet text"]', "1 Main St"); return true; })()`);
  await sleep(150);
  await settings.eval(`[...document.querySelectorAll('[data-testid="dictation-settings"] button')].find((x) => /Add snippet/.test(x.textContent)).click()`);
  await sleep(300);
  const snips = await settings.eval(`chrome.storage.local.get("dictationSnippets").then((r) => r.dictationSnippets ?? [])`);
  check("Settings: + Add snippet saves it", snips.some((s) => s.cue === "my address" && s.text === "1 Main St"), JSON.stringify(snips));
  const axeSource = readFileSync(path.resolve(here, "../..", "node_modules/axe-core/axe.min.js"), "utf8");
  for (const theme of ["light", "dark"]) {
    await settings.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
    await sleep(150);
    await settings.eval(axeSource + ";true");
    const v = await settings.eval(`axe.run(document.querySelector('[data-testid="dictation-settings"]'), { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
    check(`A11y (${theme}): Settings → Dictation has no serious problems`, v.length === 0, v.join(", "));
  }
  const errors = b.consoleErrors?.() ?? [];
  void errors;
} catch (err) {
  console.log(`  ✗ dictation crashed: ${err?.stack ?? err}`);
  failures++;
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
