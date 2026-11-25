#!/usr/bin/env node
// The phone's note editor bundle (src/ui/noteEditorHtml.js, built by
// editor-web/build.mjs) in a real browser, booted the way the app boots it
// (TenTap's own boot config and bridges, as NoteEditor.native.tsx sets them),
// with notes the computer's editor writes. Each must come back unchanged, and
// typing inside a callout or a table must keep the block.
//
//   node tests/e2e/noteEditor.mjs   (CI=1 on Linux adds --no-sandbox)

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { Browser, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../..");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

// TenTap's own boot config and bridges (its source), as the app uses them.
const vite = await createServer({ configFile: false, root: app, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
const { buildBootConfig, injectBootIntoHtml } = await vite.ssrLoadModule("@10play/tentap-editor/src/shared/bootConfig.ts");
const { TenTapStartKit } = await vite.ssrLoadModule("@10play/tentap-editor/src/bridges/StarterKit.ts");
const { LinkBridge } = await vite.ssrLoadModule("@10play/tentap-editor/src/bridges/link.ts");
const { phoneBridgeList } = await vite.ssrLoadModule("/src/lib/editorConfig.ts");
const { editorHtml } = await import(pathToFileURL(path.join(app, "src/ui/noteEditorHtml.js")).href);
await vite.close();
const bridges = phoneBridgeList(TenTapStartKit, LinkBridge);

// What the computer's note editor writes (artifacts/prodli sections/editor; see its phoneEditable test).
const NOTES = {
  callout: '<div data-emoji="🚀" data-color="blue" data-type="callout"><p>Remember</p></div>',
  toggle: '<details class="note-toggle" open=""><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details>',
  "code block": '<pre><code class="language-js">const a = 1;\nconsole.log(a);</code></pre>',
  divider: "<p>a</p><hr><p>b</p>",
  table: '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>H1</p></th><th colspan="1" rowspan="1"><p>H2</p></th><th colspan="1" rowspan="1"><p>H3</p></th></tr><tr><td colspan="1" rowspan="1"><p>a</p></td><td colspan="1" rowspan="1"><p>b</p></td><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>',
  "note link": '<p>See<a data-note-id="n1" title="Plan" data-type="note-link" href="#note-n1">Plan</a></p>',
  picture: '<figure data-type="note-image" class="note-figure" data-width="60"><img src="data:image/webp;base64,AAA" alt="Board" class="note-image" style="width:60%" data-width="60"><figcaption>The whiteboard</figcaption></figure>',
  "background colour": '<p><span style="background-color: var(--note-yellow-bg);">yellow</span></p>',
  "checklist and link": '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p><a target="_blank" rel="noopener noreferrer" href="https://example.com">done</a></p></div></li></ul>',
};

const dir = mkdtempSync(path.join(tmpdir(), "prodli-note-editor-"));
const b = new Browser();

/** Opens the editor page with this note, as RichText would. */
async function openEditor(note) {
  const config = buildBootConfig({ editorId: "e2e", bridges, platform: "android", initialContent: note, editable: true });
  // The native side's message channel, recorded.
  const shim = "<script>window.__toNative=[];window.ReactNativeWebView={postMessage:function(m){window.__toNative.push(m)}};</script>";
  const file = path.join(dir, `editor-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(file, injectBootIntoHtml(editorHtml, config).replace(/<head>/i, `<head>${shim}`));
  const p = await b.openPage(pathToFileURL(file).href);
  await p.waitFor(() => p.eval(`window.__toNative.some((m) => m.includes("editor-ready")) && !!document.querySelector(".ProseMirror")`), "editor ready");
  return p;
}

let rpc = 0;
/** Asks the editor for its HTML, as the app's getHTML() does. */
async function getHtml(p) {
  const id = `m${++rpc}`;
  await p.eval(`window.postMessage(JSON.stringify({ type: "action", payload: { type: "get-html", payload: { messageId: ${JSON.stringify(id)} } } }), "*"); true`);
  for (let i = 0; i < 40; i++) {
    const reply = await p.eval(`(() => { for (const m of window.__toNative) { try { const v = JSON.parse(m); const r = v.type === "send-html-back" ? v : v.payload; if (r?.type === "send-html-back" && r.payload?.messageId === ${JSON.stringify(id)}) return r.payload.content; } catch {} } return null; })()`);
    if (reply !== null) return reply;
    await sleep(50);
  }
  return null;
}

/** The same note, written the same way: attributes sorted, styles as the browser reads them, default table spans left out. */
const canonical = (p, html) =>
  p.eval(`(() => {
    const walk = (n) => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return "";
      const attrs = [...n.attributes]
        .filter((a) => !((a.name === "colspan" || a.name === "rowspan") && a.value === "1"))
        .map((a) => a.name + "=" + JSON.stringify(a.name === "style" ? n.style.cssText : a.value))
        .sort();
      return "<" + n.localName + (attrs.length ? " " + attrs.join(" ") : "") + ">" + [...n.childNodes].map(walk).join("") + "</" + n.localName + ">";
    };
    const t = document.createElement("template");
    t.innerHTML = ${JSON.stringify(html ?? "")};
    return [...t.content.childNodes].map(walk).join("");
  })()`);

try {
  console.log("phone note editor (built bundle, real browser)");
  for (const [name, note] of Object.entries(NOTES)) {
    const p = await openEditor(note);
    const html = await getHtml(p);
    check(`keeps a ${name}`, html !== null && (await canonical(p, html)) === (await canonical(p, note)), `\n      got:  ${html}\n      want: ${note}`);
    await p.close?.();
  }

  // Typing inside a callout and a table cell keeps the block.
  let p = await openEditor(NOTES.callout);
  await p.eval(`(() => { const t = document.querySelector('.ProseMirror [data-type="callout"] p'); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector(".ProseMirror").focus(); return true; })()`);
  await sleep(150);
  await p.send("Input.insertText", { text: " to call" });
  await sleep(200);
  let html = await getHtml(p);
  check("typing in a callout keeps the callout", (await canonical(p, html)) === (await canonical(p, '<div data-emoji="🚀" data-color="blue" data-type="callout"><p>Remember to call</p></div>')), html);
  p = await openEditor(NOTES.table);
  await p.eval(`(() => { const t = [...document.querySelectorAll(".ProseMirror td p")][1]; const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector(".ProseMirror").focus(); return true; })()`);
  await sleep(150);
  await p.send("Input.insertText", { text: "2" });
  await sleep(200);
  html = await getHtml(p);
  check("typing in a table cell keeps the table", !!html && html.startsWith("<table") && html.includes("<p>b2</p>") && html.includes("<p>H3</p>"), html);
  const errors = b.jsErrors();
  check("no script errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} catch (err) {
  failures++;
  console.error(err);
} finally {
  b.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
