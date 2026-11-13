// Minimal Chrome DevTools Protocol client for tests and tooling: launches a
// throwaway headless Chrome over --remote-debugging-pipe, loads the built
// extension, and drives pages. Shared by run.mjs and scripts/store-screenshots.mjs.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
// Tests run against their own build (see package.json "test:e2e") so they never
// replace the dist-extension folder you may have loaded in Chrome.
export const EXT = path.resolve(here, "../..", process.env.PRODLI_OUT_DIR || "dist-extension-test");
export const FIXTURES = path.join(here, "fixtures");
export const CHROME =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);


// ── Minimal CDP client over --remote-debugging-pipe ───────────────────────────

export class Browser {
  constructor() {
    if (!CHROME) throw new Error("Chrome not found — set CHROME_PATH.");
    if (!existsSync(path.join(EXT, "manifest.json"))) throw new Error(`${path.basename(EXT)} missing — run: PRODLI_OUT_DIR=${path.basename(EXT)} node scripts/build-extension.mjs`);
    this.profile = mkdtempSync(path.join(tmpdir(), "prodli-e2e-"));
    this.downloads = mkdtempSync(path.join(tmpdir(), "prodli-dl-"));
    this.proc = spawn(
      CHROME,
      ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${this.profile}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--mute-audio", ...(process.env.CI ? ["--no-sandbox"] : []), ...(process.env.PRODLI_CHROME_ARGS ? process.env.PRODLI_CHROME_ARGS.split(" ") : []), "about:blank"],
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

export class Page {
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForDownload(browser, prefix, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const f = readdirSync(browser.downloads).find((n) => n.startsWith(prefix) && !n.endsWith(".crdownload"));
    if (f) return readFileSync(path.join(browser.downloads, f), "utf8");
    await sleep(200);
  }
  throw new Error(`No download starting with ${prefix}`);
}

