#!/usr/bin/env node
// "Open files from anywhere in Chrome", end to end: a local Markdown/CSV file opened
// in a Chrome tab (as when dropped on the tab bar) is shown in ProdLi's Files viewer;
// an HTML file is left to Chrome; without file access Chrome's behaviour is unchanged.
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../..", "dist-extension-test");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "prodli-files-")));
const EXT = path.join(dir, "ext");
cpSync(built, EXT, { recursive: true });
// Two copies: one as if the user clicked "Turn on" (file permission granted), one not set up.
const EXT_OFF = path.join(dir, "ext-off");
cpSync(built, EXT_OFF, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
manifest.host_permissions = ["file:///*"];
writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(dir, "page.html"), "<!doctype html><title>Local page</title><h1>Hello</h1>");

process.env.PRODLI_OUT_DIR = path.relative(path.resolve(here, "../.."), EXT);
const { Browser, sleep, FIXTURES } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

async function openTab(b, url) {
  // Chrome may give the tab a new target id when ProdLi takes it over, so find what's new.
  const before = new Set((await b.send("Target.getTargets")).targetInfos.map((t) => t.targetId));
  const { targetId } = await b.send("Target.createTarget", { url });
  await sleep(2500);
  const { targetInfos } = await b.send("Target.getTargets");
  const info = targetInfos.find((t) => t.targetId === targetId) ?? targetInfos.find((t) => t.type === "page" && !before.has(t.targetId));
  const { sessionId } = await b.send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
  await b.send("Runtime.enable", {}, sessionId);
  const evalIn = async (expr) => (await b.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  return { url: info?.url ?? "", eval: evalIn };
}

// (Unpacked extensions loaded for testing always get "Allow access to file URLs", so the
// not-set-up case is the missing permission; the "one more step" message is checked by
// having the page see the switch as off.)
for (const allowFileAccess of [true, false]) {
  const b = new Browser();
  try {
    const { id } = await b.send("Extensions.loadUnpacked", { path: allowFileAccess ? EXT : EXT_OFF, allowFileAccess });
    b.extId = id;
    await sleep(1500);
    const md = await openTab(b, pathToFileURL(path.join(FIXTURES, "sample.md")).href);
    if (allowFileAccess) {
      check("A local Markdown file opens in ProdLi's Files viewer", md.url.startsWith(`chrome-extension://${id}/index.html`), md.url);
      const text = await md.eval("document.body.innerText");
      check("…showing the file (rendered Markdown)", /sample\.md/i.test(text) && (await md.eval(`!!document.querySelector("h1, h2")`)), text.slice(0, 200));
      const csv = await openTab(b, pathToFileURL(path.join(FIXTURES, "people.csv")).href);
      check("A local CSV file opens as a table", csv.url.startsWith(`chrome-extension://${id}/`) && (await csv.eval(`!!document.querySelector("table") && document.body.innerText.includes("Shah, Priya")`)), csv.url);
      const html = await openTab(b, pathToFileURL(path.join(dir, "page.html")).href);
      check("A local web page (HTML) stays with Chrome", html.url.startsWith("file:///"), html.url);
      const files = await openTab(b, `chrome-extension://${id}/index.html?section=files`);
      check("Files shows the feature as on", /✓ On\. Drop a Markdown/.test(await files.eval(`document.querySelector('[data-testid="open-anywhere"]')?.innerText ?? ""`)));
      await files.eval(`chrome.extension.isAllowedFileSchemeAccess = async () => false; window.dispatchEvent(new Event("focus")); new Promise(r => setTimeout(r, 500))`);
      check("If Chrome's 'Allow access to file URLs' is off, Files explains that one step", /Allow access to file URLs/.test(await files.eval(`document.querySelector('[data-testid="open-anywhere"]')?.innerText ?? ""`)) && (await files.eval(`[...document.querySelectorAll('[data-testid="open-anywhere"] button')].some(b => b.textContent.includes("Open ProdLi"))`)));
    } else {
      check("Not set up: Chrome opens the file as usual", md.url.startsWith("file:///"), md.url);
      const files = await openTab(b, `chrome-extension://${id}/index.html?section=files`);
      const offText = await files.eval(`document.querySelector('[data-testid="open-anywhere"]')?.innerText ?? ("NO CARD: " + document.body.innerText.slice(0, 300))`);
      check("…and Files offers to turn it on", /turn on/i.test(offText) && /drop a markdown/i.test(offText), offText.replace(/\n/g, " | "));
    }
    const errors = b.jsErrors().filter((e) => !/Failed to load resource|favicon/.test(JSON.stringify(e)));
    check(`No JavaScript errors (file access ${allowFileAccess ? "on" : "off"})`, errors.length === 0, JSON.stringify(errors.slice(0, 2)).slice(0, 300));
  } finally {
    b.close();
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
