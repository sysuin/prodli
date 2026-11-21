// A tiny Chrome DevTools Protocol client for the phone app's web build:
// launches a throwaway headless Chrome over --remote-debugging-pipe, opens a
// page at phone size and drives it the way a person would (tap, type, Enter).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const CHROME =
  process.env.CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  constructor() {
    if (!CHROME) throw new Error("Chrome not found — set CHROME_PATH.");
    this.profile = mkdtempSync(path.join(tmpdir(), "prodli-mobile-e2e-"));
    process.once("exit", () => this.close());
    this.proc = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${this.profile}`, "--no-first-run", "--no-default-browser-check", "--mute-audio", ...(process.env.CI ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
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
  /** A page at phone size (CSS px) with the given pixel ratio. */
  async openPage(url, { width = 390, height = 844, scale = 2, dark = false } = {}) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    for (const m of ["Runtime.enable", "Page.enable"]) await this.send(m, {}, sessionId);
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: true }, sessionId);
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] }, sessionId);
    const page = new Page(this, sessionId, targetId);
    if (url !== "about:blank") await page.navigate(url);
    return page;
  }
  jsErrors() {
    return this.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.proc.kill();
    } catch {}
    try {
      rmSync(this.profile, { recursive: true, force: true });
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
  async navigate(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor(() => this.eval("document.readyState === 'complete' && !!document.querySelector('#root')"), "page load");
    await sleep(600);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  text() {
    return this.eval("document.body.innerText");
  }
  async waitFor(fn, what, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        if (await fn()) return;
      } catch (e) {
        last = e;
      }
      await sleep(120);
    }
    throw new Error(`Timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
  }
  waitForText(s, timeoutMs) {
    return this.waitFor(async () => (await this.text()).includes(s), `text "${s}"`, timeoutMs);
  }
  /** Taps the element with this accessible label, or the button/link whose text is `label`. */
  async tap(label) {
    await this.waitFor(
      () =>
        this.eval(`(() => {
          const want = ${JSON.stringify(label)};
          const els = [...document.querySelectorAll('[aria-label], [role="button"], [role="checkbox"], [role="link"], button')];
          const el = els.find((e) => e.getAttribute("aria-label") === want) ?? els.find((e) => e.textContent.trim() === want);
          if (!el) return false;
          el.scrollIntoView({ block: "center" });
          el.click();
          return true;
        })()`),
      `"${label}" to tap`,
    );
    await sleep(250);
  }
  /** Types into the input whose placeholder or label starts with `field`. */
  async type(field, text, { enter = false } = {}) {
    await this.waitFor(
      () =>
        this.eval(`(() => {
          const want = ${JSON.stringify(field)};
          const el = [...document.querySelectorAll("input, textarea")].find((e) => (e.placeholder || "").startsWith(want) || (e.getAttribute("aria-label") || "").startsWith(want));
          if (!el) return false;
          el.scrollIntoView({ block: "center" });
          el.focus();
          el.select?.();
          return true;
        })()`),
      `field "${field}"`,
    );
    await this.send("Input.insertText", { text });
    if (enter) {
      for (const type of ["keyDown", "char", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "char" ? "\r" : undefined });
    }
    await sleep(250);
  }
  async shot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(data, "base64"));
  }
}
