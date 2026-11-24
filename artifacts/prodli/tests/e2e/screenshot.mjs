// End-to-end tests for Screenshot to ProdLi: the test build as shipped (no
// host permission), activeTab granted the way a user gesture grants it
// (Extensions.triggerAction stands in for the right-click / shortcut, which
// CDP can't press), then crop, mark up, save as a note and as a to-do, with a
// stand-in for "Pull out the text" (__prodliOcrStub). Pages are served by
// intercepting requests, so nothing goes over the network.
//
//   pnpm run build:extension:test && node tests/e2e/screenshot.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// A white page with a green block (100,100)–(400,300) in CSS pixels.
const PAGE = `<!doctype html><html><head><title>Shots fixture</title><style>
html,body{margin:0;background:#fff;overflow:hidden}
#box{position:absolute;left:100px;top:100px;width:300px;height:200px;background:#00a000;color:#fff;font:bold 28px sans-serif;display:flex;align-items:center;justify-content:center}
</style></head><body><div id="box">Invoice 42</div></body></html>`;

const b = new Browser();
try {
  const extId = await b.loadExtension();
  const sw = await b.serviceWorker();
  const swEval = (expr) => sw.eval(expr);
  const manifest = JSON.parse(readFileSync(path.resolve(here, "../..", "dist-extension-test/manifest.json"), "utf8"));
  check("The manifest asks for no host permission and nothing new", !manifest.host_permissions && ["activeTab", "contextMenus", "tabs"].every((p) => manifest.permissions.includes(p)) && !manifest.permissions.includes("<all_urls>"), JSON.stringify(manifest.host_permissions));

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
    await sleep(1000);
    await b.send("Page.bringToFront", {}, sessionId);
    return {
      targetId,
      eval: async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value,
      close: async () => {
        clearInterval(pump);
        await b.send("Target.closeTarget", { targetId });
      },
    };
  }

  /** Attaches to the newest extension page whose address contains `part`. */
  async function attach(part, timeoutMs = 6000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const { targetInfos } = await b.send("Target.getTargets");
      const t = targetInfos.filter((x) => x.type === "page" && x.url.includes(extId) && x.url.includes(part)).pop();
      if (t) {
        const { sessionId } = await b.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
        await b.send("Runtime.enable", {}, sessionId);
        await b.send("Page.enable", {}, sessionId);
        const send = (m, p = {}) => b.send(m, p, sessionId);
        const evalIn = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        };
        return { targetId: t.targetId, url: t.url, send, eval: evalIn };
      }
      await sleep(150);
    }
    return null;
  }
  const pageTargets = async (part) => (await b.send("Target.getTargets")).targetInfos.filter((x) => x.type === "page" && x.url.includes(part));
  async function waitFor(fn, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    let v;
    while (Date.now() < end) {
      v = await fn();
      if (v) return v;
      await sleep(100);
    }
    return v;
  }

  const fixture = await open("https://shots.example/page", PAGE);
  const shoot = () => swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://shots.example/*" }); return await __prodliScreenshot(t); })()`);

  // ── No permission, no screenshot: clear messages ───────────────────────────
  const noGrant = await shoot();
  check("Without a click on the page there's no access: a clear message, no window", /couldn't take a screenshot/.test(noGrant ?? "") && (await pageTargets("screenshot.html")).length === 0, String(noGrant));
  const blocked = await swEval(`__prodliScreenshot({ id: 99, windowId: 1, active: true, url: "chrome://settings/" })`);
  check("Chrome's own pages get a clear message", /Chrome doesn't let extensions/.test(blocked ?? "") && /Web Store/.test(blocked ?? ""), String(blocked));
  const store = await swEval(`__prodliScreenshot({ id: 99, windowId: 1, active: true, url: "https://chromewebstore.google.com/detail/abc" })`);
  check("…and so does the Chrome Web Store", /Chrome doesn't let extensions/.test(store ?? ""), String(store));
  const menu = await swEval(`new Promise((r) => chrome.contextMenus.update("prodli-screenshot", { title: "Screenshot to ProdLi" }, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : "ok")))`);
  check("The right-click menu has “Screenshot to ProdLi”", menu === "ok", String(menu));

  // ── A user gesture grants activeTab for the tab (here: the toolbar action) ──
  const tabTarget = (await b.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos.find((t) => t.url.startsWith("https://shots.example/"));
  await b.send("Extensions.triggerAction", { id: extId, targetId: tabTarget?.targetId ?? fixture.targetId });
  await sleep(800);
  // The action is the recorder's; on a normal page it opens Meetings in a new tab. Go back to the page.
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://shots.example/*" }); for (const x of await chrome.tabs.query({ url: chrome.runtime.getURL("*") })) await chrome.tabs.remove(x.id); await chrome.tabs.update(t.id, { active: true }); return true; })()`);
  await sleep(300);
  const cssWidth = await fixture.eval("innerWidth");
  const err = await shoot();
  check("With activeTab (no host permission) the visible area is captured and the window opens", err === null, String(err));
  let ann = await attach("screenshot.html");
  check("The screenshot window opened", !!ann);
  if (!ann) throw new Error("no screenshot window");
  await waitFor(() => ann.eval(`!!document.querySelector('[data-testid="shot-canvas"]')`));
  await sleep(300);
  const full = (await ann.eval(`document.querySelector('[data-testid="shot-canvas"]').dataset.crop`)).split(",").map(Number);
  const r = full[2] / cssWidth; // screenshot pixels per CSS pixel
  check("It starts with the whole visible area as the crop", full[0] === 0 && full[1] === 0 && full[2] > 0 && full[3] > 0, String(full));
  check("The title is taken from the page", (await ann.eval(`document.querySelector('[data-testid="shot-title"]').value`)) === "Screenshot: Shots fixture");
  check("The capture was removed from session storage once read", (await swEval(`chrome.storage.session.get("screenshotPending").then((x) => !x.screenshotPending)`)) === true);

  // Mouse helpers: screenshot pixels → points on the canvas.
  const canvasBox = () => ann.eval(`(() => { const b = document.querySelector('[data-testid="shot-canvas"]').getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })()`);
  const at = (box, x, y) => ({ x: box.left + (x * box.width) / full[2], y: box.top + (y * box.height) / full[3] });
  async function drag(x1, y1, x2, y2) {
    const box = await canvasBox();
    const a = at(box, x1 * r, y1 * r);
    const z = at(box, x2 * r, y2 * r);
    await ann.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y });
    await ann.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await ann.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + ((z.x - a.x) * i) / 4, y: a.y + ((z.y - a.y) * i) / 4, button: "left", buttons: 1 });
    await ann.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: z.x, y: z.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(150);
  }
  const key = async (k, modifiers = 0) => {
    const codes = { Enter: 13, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38 };
    const vk = codes[k] ?? k.toUpperCase().charCodeAt(0);
    const code = codes[k] ? k : `Key${k.toUpperCase()}`;
    await ann.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
    if (k === "Enter") await ann.send("Input.dispatchKeyEvent", { type: "char", key: k, text: "\r", modifiers });
    await ann.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(80);
  };
  const clickBtn = (label) => ann.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().includes(${JSON.stringify(label)})); if (!b) throw new Error("No button " + ${JSON.stringify(label)}); b.click(); return true; })()`);
  const shapes = () => ann.eval(`Number(document.querySelector('[data-testid="shot-canvas"]').dataset.shapes)`);
  const crop = async () => (await ann.eval(`document.querySelector('[data-testid="shot-canvas"]').dataset.crop`)).split(",").map(Number);
  const near = (a, b, tol = 3 * r) => Math.abs(a - b) <= tol;

  // ── Crop with the mouse ────────────────────────────────────────────────────
  await drag(80, 80, 420, 320);
  const c1 = await crop();
  check("Dragging crops to that area", near(c1[0], 80 * r) && near(c1[1], 80 * r) && near(c1[2], 340 * r) && near(c1[3], 240 * r), `${c1} (×${r})`);
  check("The crop size is shown", (await ann.eval(`document.querySelector('[data-testid="shot-crop"]').textContent`)) === `Crop: ${c1[2]} × ${c1[3]}`);

  // ── Crop with the keyboard, then undo ──────────────────────────────────────
  await ann.eval(`document.querySelector('[data-testid="shot-canvas"]').focus()`);
  await key("ArrowRight");
  const c2 = await crop();
  check("Arrow keys move the crop", c2[0] > c1[0] && c2[2] === c1[2], `${c1} → ${c2}`);
  await key("z", 2);
  check("Ctrl+Z undoes it", (await crop()).join() === c1.join(), String(await crop()));

  // ── Mark up: highlight, box, arrow; undo ───────────────────────────────────
  await clickBtn("Highlight");
  check("Picking a tool shows it as pressed", (await ann.eval(`[...document.querySelectorAll('[role="toolbar"] button')].find((x) => x.getAttribute("aria-pressed") === "true")?.textContent.trim()`)) === "🖍 Highlight");
  await drag(84, 84, 96, 316);
  await clickBtn("Box");
  await drag(150, 150, 350, 250);
  check("Dragging adds a highlight and a box", (await shapes()) === 2, String(await shapes()));
  await clickBtn("Arrow");
  await drag(390, 310, 300, 200);
  check("…and an arrow", (await shapes()) === 3, String(await shapes()));
  await clickBtn("Undo");
  check("↶ Undo removes the last one", (await shapes()) === 2, String(await shapes()));
  // Keyboard drawing: R picks the box, Enter adds the box shown on the picture, Ctrl+Z takes it back.
  await ann.eval(`document.querySelector('[data-testid="shot-canvas"]').focus()`);
  await key("r");
  await key("ArrowDown", 8);
  await key("Enter");
  check("Keyboard: R, then Enter adds a box", (await shapes()) === 3 && (await ann.eval(`[...document.querySelectorAll('[role="toolbar"] button')].find((x) => x.getAttribute("aria-pressed") === "true")?.textContent.trim()`)) === "▭ Box", String(await shapes()));
  await key("z", 2);
  check("Keyboard: Ctrl+Z takes it back", (await shapes()) === 2, String(await shapes()));
  if (shots) writeFileSync(path.join(shots, "screenshot-annotator.png"), Buffer.from((await ann.send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  // ── Accessibility, light and dark ──────────────────────────────────────────
  const axeSource = readFileSync(path.resolve(here, "../..", "node_modules/axe-core/axe.min.js"), "utf8");
  await ann.eval(axeSource + ";true");
  for (const theme of ["light", "dark"]) {
    await ann.eval(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
    await sleep(150);
    const v = await ann.eval(`axe.run(document.querySelector('[data-testid="screenshot-annotator"]'), { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] }).then(r => r.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => v.id + "×" + v.nodes.length + " " + v.nodes.slice(0, 2).map(n => n.html.slice(0, 80)).join(" | ")))`);
    check(`A11y (${theme}): the screenshot window has no serious problems`, v.length === 0, v.join(", "));
    if (shots && theme === "dark") writeFileSync(path.join(shots, "screenshot-annotator-dark.png"), Buffer.from((await ann.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  }
  await ann.eval(`document.documentElement.classList.remove("dark")`);

  // ── Save as a note ─────────────────────────────────────────────────────────
  await clickBtn("Save as note");
  const status = await waitFor(async () => {
    const t = await ann.eval(`document.querySelector('[data-testid="shot-status"]')?.textContent ?? ""`);
    return /Saved note/.test(t) ? t : "";
  });
  check("Save as note says it's saved", /Saved note: Screenshot: Shots fixture/.test(status), status);
  const notes = await swEval(`chrome.storage.local.get("notes").then((r) => r.notes ?? [])`);
  const note = notes[0];
  const src = /<img src="(data:image\/webp;base64,[^"]+)"/.exec(note?.content ?? "")?.[1] ?? "";
  check("The note holds the picture as a WebP note image, and the source", note?.title === "Screenshot: Shots fixture" && note.content.startsWith('<figure data-type="note-image"><img src="data:image/webp;base64,') && note.content.includes('Source: <a href="https://shots.example/page">'), (note?.content ?? "").slice(0, 120));
  check("The picture is within the note size limits (≤ 300 KB WebP)", src.length > 1000 && src.length * 0.75 <= 300_000, String(src.length));
  // Look inside the saved picture: its size is the crop, and the marks are where they were drawn.
  const px = await ann.eval(`new Promise((resolve) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); const k = i.naturalWidth / ${c1[2]}; const p = (a, b) => [...x.getImageData(Math.round(a * k), Math.round(b * k), 1, 1).data].slice(0, 3); resolve({ w: i.naturalWidth, h: i.naturalHeight, highlight: p(${10 * r}, ${120 * r}), white: p(${30 * r}, ${10 * r}), stroke: p(${70 * r}, ${120 * r}), green: p(${40 * r}, ${200 * r}) }); }; i.src = ${JSON.stringify(src)}; })`);
  const wanted = Math.min(1, 1600 / Math.max(c1[2], c1[3]));
  check("The saved picture is the crop", near(px.w, c1[2] * wanted, 2) && near(px.h, c1[3] * wanted, 2), JSON.stringify(px));
  check("…with the highlight (yellow over white)", px.highlight[0] > 220 && px.highlight[1] > 190 && px.highlight[2] < 190 && px.white.every((v) => v > 235), JSON.stringify(px));
  check("…the red box", px.stroke[0] > 150 && px.stroke[1] < 120, JSON.stringify(px.stroke));
  check("…and the page under it", px.green[1] > 120 && px.green[0] < 90, JSON.stringify(px.green));

  // ── The note in Notes ──────────────────────────────────────────────────────
  const app = await b.openPage(`chrome-extension://${extId}/index.html`);
  await app.eval(`chrome.storage.local.set({ hasSeenOnboarding: true, lastSection: "editor", activeNoteId: ${JSON.stringify(note.id)} })`);
  await app.send("Page.reload", {});
  await sleep(1800);
  const shown = await waitFor(() => app.eval(`document.querySelector('.ProseMirror figure[data-type="note-image"] img')?.getAttribute("src")?.slice(0, 30) ?? ""`));
  check("Notes shows the screenshot in the note", shown === "data:image/webp;base64,".concat(src.slice(23, 30)), String(shown));

  // ── Again, with Pull out the text, saved as a to-do ────────────────────────
  check("The window can be closed after saving", (await clickBtn("Close")) === true);
  await sleep(300);
  check("…and closes", (await pageTargets("screenshot.html")).length === 0);
  // Opening ProdLi above made a new active tab: a page that isn't showing can't be captured.
  const notShowing = await shoot();
  check("A tab that isn't showing gets a clear message", notShowing === "Go back to that page and try again.", String(notShowing));
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://shots.example/*" }); await chrome.tabs.update(t.id, { active: true }); return true; })()`);
  await sleep(300);
  const again = await shoot();
  check("Back on the page, a second capture works (the grant lasts until the page changes)", again === null, String(again));
  ann = await attach("screenshot.html");
  await waitFor(() => ann.eval(`!!document.querySelector('[data-testid="shot-canvas"]')`));
  await sleep(300);
  await drag(100, 100, 400, 300);
  await ann.eval(`(() => { globalThis.__ocrSeen = []; globalThis.__prodliOcrStub = async (image) => { __ocrSeen.push(image.slice(0, 23)); return { text: "Invoice 42\\n\\nTotal: $18.00" }; }; return true; })()`);
  check("Nothing is sent before clicking Pull out the text", (await ann.eval(`__ocrSeen.length`)) === 0);
  await clickBtn("Pull out the text");
  const pulled = await waitFor(() => ann.eval(`document.querySelector('[data-testid="shot-text"]')?.value ?? ""`));
  check("✨ Pull out the text puts the text in the box", pulled === "Invoice 42\n\nTotal: $18.00", JSON.stringify(pulled));
  check("…from a WebP of the crop", JSON.stringify(await ann.eval(`__ocrSeen`)) === JSON.stringify(["data:image/webp;base64,"]));
  await ann.eval(`(() => { const el = document.querySelector('[data-testid="shot-title"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Pay invoice 42"); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(100);
  await clickBtn("Save as to-do");
  const status2 = await waitFor(async () => {
    const t = await ann.eval(`document.querySelector('[data-testid="shot-status"]')?.textContent ?? ""`);
    return /Added to-do/.test(t) ? t : "";
  });
  check("Save as to-do says it's added", /Added to-do: Pay invoice 42/.test(status2), status2);
  const after = await swEval(`chrome.storage.local.get(["notes", "todos"])`);
  const todo = after.todos[0];
  const tnote = after.notes[0];
  check("The to-do links to a new note with the picture and the text", todo?.title === "Pay invoice 42" && todo.noteId === tnote.id && tnote.content.includes('<img src="data:image/webp;base64,') && tnote.content.includes("<p>Invoice 42</p><p>Total: $18.00</p>"), JSON.stringify({ todo, content: tnote?.content?.slice(-200) }));
  check("…and the page's address as a step", todo?.subtasks?.some((s) => s.title === "https://shots.example/page"), JSON.stringify(todo?.subtasks));

  // ── 🖼 on the to-do opens the note ────────────────────────────────────────
  await app.eval(`chrome.storage.local.set({ lastSection: "todos" })`);
  await app.send("Page.reload", {});
  await sleep(1800);
  const opened = await app.eval(`(() => { const b = document.querySelector('button[aria-label="Open note: Pay invoice 42"]'); if (!b) return false; b.click(); return true; })()`);
  check("The to-do has a 🖼 button for its note", opened === true);
  const noteText = await waitFor(async () => {
    const t = await app.eval(`document.querySelector(".ProseMirror")?.innerText ?? ""`);
    return t.includes("Total: $18.00") ? t : "";
  });
  check("…which opens the note with the picture and its text", noteText.includes("Invoice 42") && (await app.eval(`!!document.querySelector('.ProseMirror figure img[src^="data:image/webp"]')`)), noteText.slice(0, 120));
  await ann.eval("window.close()").catch(() => {});

  // ── Quick add window: 📸 Screenshot this page ─────────────────────────────
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://shots.example/*" }); await __prodliOpenQuickAdd(t); return true; })()`);
  const qa = await attach("#quick-add");
  check("Quick add opened for the page knows its tab", !!qa && /[?&]tab=\d+/.test(qa.url), qa?.url);
  if (qa) {
    await waitFor(() => qa.eval(`[...document.querySelectorAll("button")].some((x) => x.textContent.includes("Screenshot this page"))`));
    await qa.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.includes("Screenshot this page")).click()`);
    const fromQa = await attach("screenshot.html");
    check("📸 Screenshot this page in Quick add opens the screenshot window", !!fromQa && (await waitFor(() => fromQa.eval(`!!document.querySelector('[data-testid="shot-canvas"]')`))) === true);
    check("…and Quick add closes", (await waitFor(async () => (await pageTargets("#quick-add")).length === 0)) === true);
    await fromQa?.eval("window.close()").catch(() => {});
  }
  // Without a tab (opened any other way) there's no button.
  const plain = await b.openPage(`chrome-extension://${extId}/index.html#quick-add?title=Hello`);
  check("Quick add without a page has no screenshot button", !(await plain.eval(`document.body.innerText.includes("Screenshot this page")`)) && (await plain.eval(`document.body.innerText.toLowerCase().includes("add to prodli")`)));
  await plain.close();

  // ── A page the extension wasn't given: the Quick add button says so ────────
  const other = await open("https://other.example/x", PAGE.replace("Shots fixture", "Other page"));
  await swEval(`(async () => { const [t] = await chrome.tabs.query({ url: "https://other.example/*" }); await chrome.tabs.update(t.id, { active: true }); await __prodliOpenQuickAdd(t); return true; })()`);
  const qa2 = await attach("#quick-add");
  if (qa2) {
    await waitFor(() => qa2.eval(`[...document.querySelectorAll("button")].some((x) => x.textContent.includes("Screenshot this page"))`));
    await qa2.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent.includes("Screenshot this page")).click()`);
    const alert = await waitFor(() => qa2.eval(`document.querySelector('[role="alert"]')?.textContent ?? ""`));
    check("Without access to that tab, Quick add shows a clear message and stays open", /couldn't take a screenshot/.test(alert ?? "") && (await pageTargets("screenshot.html")).length === 0, String(alert));
  } else check("Quick add opened for the second page", false);
  await other.close();
  await fixture.close();

  const errors = b.jsErrors().map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.args?.map((a) => a.value ?? a.description).join(" ")).filter((m) => m && !/ERR_|net::|favicon/i.test(m));
  check("No JavaScript errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  console.log(`  ✗ screenshot crashed: ${err?.stack ?? err}`);
  failures++;
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
