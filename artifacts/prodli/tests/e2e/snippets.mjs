// End-to-end tests for "Insert a snippet": the picker injected into a web page
// (right-click → Insert a ProdLi snippet, or its shortcut) types the chosen
// snippet into the text box the user was in. The test build gets a host
// permission for the test page (real use relies on activeTab from the click).
// Pages are served by intercepting requests, so nothing goes over the network.
//
//   pnpm run build:extension:test && node tests/e2e/snippets.mjs

import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-snip-")));
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
manifest.host_permissions = ["https://forms.example/*"];
writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));
process.env.PRODLI_OUT_DIR = path.relative(path.resolve(here, "../.."), EXT);
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const FORM = `<!doctype html><html><head><title>Form</title></head><body>
<label>Message <textarea id="t" rows="4" cols="60">Dear team,</textarea></label>
<label>Name <input id="i" value=""></label>
<div id="ce" contenteditable="true" style="min-height:40px;border:1px solid #ccc">Hi </div>
</body></html>`;

const b = new Browser();
try {
  await b.loadExtension();
  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);
  console.log("snippets");

  check("The manifest offers an Insert snippet shortcut without taking a fifth suggested key", !!manifest.commands["insert-snippet"] && !manifest.commands["insert-snippet"].suggested_key && Object.values(manifest.commands).filter((c) => c.suggested_key).length <= 4);

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
    return {
      eval: async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value,
      key: (key, code = 0) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code }, sessionId),
      type: (text) => b.send("Input.insertText", { text }, sessionId),
      close: async () => {
        clearInterval(pump);
        await b.send("Target.closeTarget", { targetId });
      },
    };
  }
  const openPicker = (frame) => swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://forms.example/*" }); return __prodliOpenSnippetPicker(t${frame === undefined ? "" : `, ${frame}`}); })()`);
  const picker = (page) => page.eval(`(() => { const h = document.querySelector("[data-prodli-snippets]"); if (!h) return null; const r = h.shadowRoot; return { items: [...r.querySelectorAll('li[role="option"] .cue')].map(e => e.textContent), active: r.querySelector('li[aria-selected="true"] .cue')?.textContent ?? null, empty: r.querySelector("li.empty")?.textContent ?? null, focused: r.activeElement?.tagName ?? null }; })()`);

  await swEval(`chrome.storage.local.set({ dictationSnippets: [
    { id: "a", cue: "my address", text: "12 Park Road, Pune" },
    { id: "b", cue: "calendar link", text: "Book a time: https://cal.example/me" },
    { id: "c", cue: "sign-off", text: "Thanks,\\nSunita ({isodate})" },
  ] }).then(() => true)`);

  const page = await open("https://forms.example/contact", FORM);
  // ── Textarea: right-click → Insert a ProdLi snippet (the main frame) ────────
  await page.eval(`(() => { const t = document.getElementById("t"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`);
  const opened = await openPicker(0);
  await sleep(300);
  let pk = await picker(page);
  check("Right-click: the picker opens next to the field with every snippet, search focused", opened === true && pk?.items.join("|") === "my address|calendar link|sign-off" && pk.focused === "INPUT", JSON.stringify(pk));
  await page.type("cal");
  await sleep(150);
  pk = await picker(page);
  check("Typing filters the list", pk?.items.join("|") === "calendar link", JSON.stringify(pk));
  await page.key("Enter", 13);
  await sleep(300);
  check("Enter types the snippet where the cursor was", (await page.eval(`document.getElementById("t").value`)) === "Dear team,Book a time: https://cal.example/me", await page.eval(`document.getElementById("t").value`));
  check("…and the picker closes, with focus back in the field", (await picker(page)) === null && (await page.eval(`document.activeElement.id`)) === "t");

  // ── Single-line input via the shortcut: newlines become spaces, placeholders filled ──
  await page.eval(`(() => { document.getElementById("i").focus(); return true; })()`);
  await openPicker();
  await sleep(300);
  await page.key("ArrowDown", 40);
  await page.key("ArrowDown", 40);
  await sleep(100);
  check("Arrow keys move the choice", (await picker(page))?.active === "sign-off");
  await page.key("Enter", 13);
  await sleep(300);
  const today = await page.eval(`(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
  check("Shortcut: types into the focused input, one line, with {isodate} filled in", (await page.eval(`document.getElementById("i").value`)) === `Thanks, Sunita (${today})`, await page.eval(`document.getElementById("i").value`));

  // ── Contenteditable, and Escape ────────────────────────────────────────────
  await page.eval(`(() => { const c = document.getElementById("ce"); c.focus(); const r = document.createRange(); r.selectNodeContents(c); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await openPicker();
  await sleep(300);
  await page.key("Escape", 27);
  await sleep(150);
  check("Escape closes it without typing anything", (await picker(page)) === null && (await page.eval(`document.getElementById("ce").innerText`)).trim() === "Hi");
  await openPicker();
  await sleep(300);
  await page.type("addr");
  await page.key("Enter", 13);
  await sleep(300);
  check("Rich text boxes (contenteditable) get the snippet too, at the cursor", /^Hi ?12 Park Road, Pune/.test((await page.eval(`document.getElementById("ce").innerText`)).trim()), await page.eval(`document.getElementById("ce").innerText`));

  // ── No snippets yet ────────────────────────────────────────────────────────
  await swEval(`chrome.storage.local.set({ dictationSnippets: [] }).then(() => true)`);
  await page.eval(`(() => { document.getElementById("i").focus(); return true; })()`);
  await openPicker(0);
  await sleep(300);
  check("With no snippets, it says where to add them", /Settings → Dictation → Snippets/.test((await picker(page))?.empty ?? ""), JSON.stringify(await picker(page)));
  await page.key("Escape", 27);
  await page.close();

  // ── Pages Chrome doesn't allow ─────────────────────────────────────────────
  const blocked = await swEval(`__prodliOpenSnippetPicker({ id: 1, url: "chrome://settings/" })`);
  check("chrome:// pages: nothing is injected (a notification explains)", blocked === false);
} catch (err) {
  console.log(`  ✗ snippets crashed: ${err?.stack ?? err}`);
  failures++;
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
