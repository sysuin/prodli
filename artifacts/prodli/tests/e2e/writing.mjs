// End-to-end tests for the writing check: right-click → "Check writing with
// ProdLi" (here: the background's start function) puts the checker in a web
// page; it underlines mistakes as you type, fixes them from the card or "Fix
// all", rewrites from the badge's panel, skips passwords and spellcheck="false"
// fields, and turns off per site. ProdLi's AI is a stand-in in the background.
// The test build gets a host permission for the test page (real use relies on
// activeTab from the click). Pages are served by intercepting requests.
//
//   pnpm run build:extension:test && node tests/e2e/writing.mjs

import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-writing-")));
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
manifest.host_permissions = ["https://mail.example/*"];
writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));
process.env.PRODLI_OUT_DIR = path.relative(path.resolve(here, "../.."), EXT);
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const PAGE = `<!doctype html><html><head><title>Compose</title><style>body{font:15px/1.5 Arial;margin:20px} textarea,div[contenteditable]{width:520px;display:block;margin:10px 0}</style></head><body>
<textarea id="t" rows="5"></textarea>
<div id="ce" contenteditable="true" style="min-height:60px;border:1px solid #ccc;padding:6px"><div><br></div></div>
<input id="pw" type="password" style="width:300px">
<textarea id="code" spellcheck="false" rows="2"></textarea>
</body></html>`;

const b = new Browser();
try {
  await b.loadExtension();
  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);
  console.log("writing check");

  check("The manifest asks for all-sites access only as an optional permission, and the shortcut has no default key", manifest.optional_host_permissions.includes("<all_urls>") && !(manifest.host_permissions_original ?? []).includes("<all_urls>") && !!manifest.commands["check-writing"] && !manifest.commands["check-writing"].suggested_key);

  // ProdLi's AI, stood in: "teh" → "the", "alot" → "a lot" (spelling), "very good" → "excellent" (better word).
  await swEval(`(() => {
    globalThis.__checks = [];
    globalThis.__prodliProofreadStub = (paragraphs) => { __checks.push(...paragraphs); return paragraphs.map((p) => {
      const out = [];
      for (const [re, rep, type] of [[/\\bteh\\b/g, "the", "spelling"], [/\\balot\\b/g, "a lot", "spelling"], [/\\bvery good\\b/g, "excellent", "word_choice"]])
        for (const m of p.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, original: m[0], replacement: rep, type, explanation: type === "spelling" ? "Spelling" : "A stronger word" });
      return out.sort((a, b) => a.start - b.start);
    }); };
    globalThis.__prodliRewriteStub = (text, action) => action + ": " + text;
    return chrome.storage.local.set({ writingCheck: { level: "polish", onDevice: false, everywhere: false, offSites: [], dictionary: [] } });
  })()`);

  const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  await b.send("Runtime.enable", {}, sessionId);
  await b.send("Page.enable", {}, sessionId);
  await b.send("Fetch.enable", { patterns: [{ urlPattern: "https://mail.example/*" }] }, sessionId);
  const served = new Set();
  const pump = setInterval(() => {
    for (const e of b.events) {
      if (e.method !== "Fetch.requestPaused" || e.sessionId !== sessionId || served.has(e.params.requestId)) continue;
      served.add(e.params.requestId);
      void b.send("Fetch.fulfillRequest", { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from(PAGE).toString("base64") }, sessionId);
    }
  }, 30);
  await b.send("Page.navigate", { url: "https://mail.example/compose" }, sessionId);
  await sleep(1200);
  await b.send("Page.bringToFront", {}, sessionId);
  const ev = async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  const type = (text) => b.send("Input.insertText", { text }, sessionId);
  const ui = `document.querySelector("[data-prodli-writing]")?.shadowRoot`;
  const badge = () => ev(`(() => { const b = ${ui}?.querySelector(".badge"); return b && b.style.display !== "none" ? b.textContent : null; })()`);
  const shot = async (name) => {
    if (!process.env.E2E_SHOTS) return;
    const { data } = await b.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(path.join(process.env.E2E_SHOTS, `${name}.png`), Buffer.from(data, "base64"));
  };
  const waitFor = async (expr, ms = 6000) => {
    for (let t = 0; t < ms; t += 150) {
      if (await ev(expr)) return true;
      await sleep(150);
    }
    return false;
  };

  // Start it (right-click → Check writing with ProdLi) with the textarea focused.
  await ev(`document.getElementById("t").focus(); true`);
  const started = await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://mail.example/*" }); return __prodliStartWriting(t); })()`);
  check("Check writing starts in the page", started === true && (await waitFor(`!!${ui}?.querySelector(".badge")`)));
  await type("I think teh plan is alot better and very good.");
  const counted = await waitFor(`${ui}?.querySelector(".badge")?.textContent === "3"`);
  check("Mistakes and a better word are found while typing (badge shows 3)", counted, String(await badge()));
  const spans = await ev(`[...(${ui}?.querySelectorAll(".mirror .u") ?? [])].map((s) => s.className + ":" + s.textContent)`);
  check("The textarea's suggestions are underlined in their colours", JSON.stringify(spans) === JSON.stringify(["u correct:teh", "u correct:alot", "u clear:very good"]), JSON.stringify(spans));
  check("Nothing was added to the page's own text box", (await ev(`document.getElementById("t").value`)) === "I think teh plan is alot better and very good." && (await ev(`document.getElementById("t").children.length`)) === 0);

  // Put the caret inside "teh": the card offers the fix.
  await ev(`(() => { const t = document.getElementById("t"); t.focus(); t.setSelectionRange(9, 9); document.dispatchEvent(new Event("selectionchange")); return true; })()`);
  const card = await waitFor(`!!${ui}?.querySelector(".card .fix")`, 2000);
  await shot("writing-card");
  check("The card shows the fix and why", card && /teh.*→.*the/s.test(await ev(`${ui}.querySelector(".card").textContent`)) && /Spelling/.test(await ev(`${ui}.querySelector(".card").textContent`)));
  const before = (await swEval(`__checks.length`)) ?? 0;
  await ev(`${ui}.querySelector(".card .fix").click(); true`);
  await sleep(400);
  check("Accepting types the fix into the text box", (await ev(`document.getElementById("t").value`)) === "I think the plan is alot better and very good.");
  await waitFor(`${ui}?.querySelector(".badge")?.textContent === "2"`, 3000);
  check("The other suggestions stay, without checking the paragraph again", (await badge()) === "2" && (await swEval(`__checks.length`)) === before, `${await badge()} / ${await swEval("__checks.length")} vs ${before}`);
  await ev(`document.execCommand("undo"); true`);
  check("Undo brings the original back (the fix was typed, not pasted over)", (await ev(`document.getElementById("t").value`)) === "I think teh plan is alot better and very good.");
  await ev(`document.execCommand("redo"); true`);

  // The panel: Fix all.
  await ev(`${ui}.querySelector(".badge").click(); true`);
  const panel = await waitFor(`!!${ui}?.querySelector(".panel [data-action='fix-all']")`, 2000);
  await shot("writing-panel");
  check("The badge opens a panel with every suggestion and Fix all", panel && (await ev(`${ui}.querySelectorAll(".panel .item").length`)) === 2);
  await ev(`${ui}.querySelector(".panel [data-action='fix-all']").click(); true`);
  await sleep(500);
  check("Fix all applies them all", (await ev(`document.getElementById("t").value`)) === "I think the plan is a lot better and excellent.", await ev(`document.getElementById("t").value`));
  await waitFor(`${ui}?.querySelector(".badge")?.textContent === "✓"`, 3000);
  check("The badge shows a tick when there's nothing left", (await badge()) === "✓");

  // Rewrite from the panel.
  await ev(`${ui}.querySelector(".badge").click(); true`);
  await sleep(200);
  await ev(`[...${ui}.querySelectorAll(".panel .chip")].find((c) => c.textContent === "Shorter").click(); true`);
  await waitFor(`!!${ui}?.querySelector(".panel [data-action='replace']")`, 3000);
  await ev(`${ui}.querySelector(".panel [data-action='replace']").click(); true`);
  await sleep(400);
  check("Rewrite (Shorter) replaces the text when you press Replace", (await ev(`document.getElementById("t").value`)) === "shorter: I think the plan is a lot better and excellent.", await ev(`document.getElementById("t").value`));

  // A rich editor (contenteditable, like Gmail): underlines with the Highlight API, no change to the markup.
  await ev(`(() => { const ce = document.getElementById("ce"); ce.focus(); const r = document.createRange(); r.selectNodeContents(ce.firstChild); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`);
  await sleep(300);
  await type("Thanks for teh update.");
  const hl = await waitFor(`CSS.highlights.has("prodli-wc-correct") && [...CSS.highlights.get("prodli-wc-correct")][0]?.toString() === "teh"`);
  await shot("writing-rich");
  check("In a rich editor the mistake is underlined without changing the page's markup", hl && (await ev(`document.getElementById("ce").querySelectorAll("span, mark, u").length`)) === 0);
  await ev(`${ui}.querySelector(".badge").click(); true`);
  await sleep(200);
  await ev(`${ui}.querySelector(".panel .item").click(); true`);
  await sleep(400);
  check("Accepting in a rich editor fixes the text there", (await ev(`document.getElementById("ce").textContent`)) === "Thanks for the update.", await ev(`document.getElementById("ce").textContent`));

  // Fields it leaves alone.
  await ev(`document.getElementById("pw").focus(); true`);
  await type("teh");
  await sleep(1500);
  check("Password boxes are never checked", (await badge()) === null || (await ev(`document.activeElement.id`)) === "pw" && !(await ev(`${ui}.querySelector(".mirror")?.textContent?.includes("teh")`)));
  await ev(`document.getElementById("code").focus(); true`);
  await type("teh code");
  await sleep(1500);
  check("Boxes marked spellcheck=false are left alone", !(await swEval(`__checks.some((p) => p.includes("teh code"))`)));

  // Dictionary: a word added is never flagged.
  await swEval(`chrome.storage.local.get("writingCheck").then((r) => chrome.storage.local.set({ writingCheck: { ...r.writingCheck, dictionary: ["teh"] } }))`);
  await ev(`(() => { const t = document.getElementById("t"); t.focus(); t.value = ""; return true; })()`);
  await type("Our product teh is great.");
  await sleep(2000);
  check("Words in your dictionary aren't flagged", (await badge()) === "✓", String(await badge()));

  // Turn off on this site.
  await ev(`${ui}.querySelector(".badge").click(); true`);
  await sleep(200);
  await ev(`[...${ui}.querySelectorAll(".panel .link")].find((l) => l.textContent.startsWith("Turn off")).click(); true`);
  await sleep(500);
  const off = await swEval(`chrome.storage.local.get("writingCheck").then((r) => r.writingCheck.offSites)`);
  check("Turn off on this site remembers the site and hides the checker", JSON.stringify(off) === JSON.stringify(["mail.example"]) && (await badge()) === null, JSON.stringify(off));

  // Everywhere can't stay on without the permission.
  await swEval(`chrome.storage.local.get("writingCheck").then((r) => chrome.storage.local.set({ writingCheck: { ...r.writingCheck, everywhere: true } }))`);
  await sleep(600);
  const ever = await swEval(`chrome.storage.local.get("writingCheck").then((r) => r.writingCheck.everywhere)`);
  const scripts = await swEval(`chrome.scripting.getRegisteredContentScripts().then((s) => s.length)`);
  check("“Check on every site” switches itself off when Chrome hasn't given the permission", ever === false && scripts === 0, JSON.stringify({ ever, scripts }));

  // Pages where extensions can't run.
  const blocked = await swEval(`__prodliStartWriting({ id: 1, url: "chrome://settings/" })`);
  check("Chrome's own pages are refused politely", blocked === false);

  const errors = b.jsErrors().filter((e) => !JSON.stringify(e).includes("favicon"));
  check("No script errors", errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  clearInterval(pump);
} catch (err) {
  failures++;
  console.error(err);
} finally {
  b.close();
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
