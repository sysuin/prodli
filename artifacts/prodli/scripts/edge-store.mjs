#!/usr/bin/env node
/**
 * Microsoft Edge Add-ons API (v1.1): upload ProdLi's store zip to the Edge
 * listing and, if asked, submit it for certification. Used by
 * .github/workflows/store.yml (edge-upload / edge-submit); runs anywhere with Node 22.
 *
 *   node scripts/edge-store.mjs upload <zip>                → replaces the package of the draft
 *   node scripts/edge-store.mjs submit <zip> ["notes"]      → uploads, then submits the draft
 *
 * Settings (environment): EDGE_CLIENT_ID and EDGE_API_KEY (Partner Center →
 * Microsoft Edge → Publish API), EDGE_PRODUCT_ID (the listing's Product ID).
 * The first Edge listing is created by hand in Partner Center; this only updates it.
 * Setup: EDGE_SUBMISSION.md. API: https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api
 */

import { readFileSync } from "fs";
import { pathToFileURL } from "url";

const API = "https://api.addons.microsoftedge.microsoft.com";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function settings(env) {
  const missing = ["EDGE_CLIENT_ID", "EDGE_API_KEY", "EDGE_PRODUCT_ID"].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")} (EDGE_SUBMISSION.md)`);
  const productId = env.EDGE_PRODUCT_ID.trim();
  if (!GUID.test(productId)) throw new Error("EDGE_PRODUCT_ID should look like d34f98f5-f9b7-42b1-bebb-98707202b21d (Partner Center → the extension's overview)");
  return { productId, headers: { Authorization: `ApiKey ${env.EDGE_API_KEY.trim()}`, "X-ClientID": env.EDGE_CLIENT_ID.trim() } };
}

/** The operation ID from a 202's Location header (an ID or a URL ending in it). */
export function operationIdFrom(location) {
  const id = (location ?? "").trim().split("/").filter(Boolean).pop() ?? "";
  if (!id) throw new Error("Edge didn't say how to follow the operation (no Location header)");
  return id;
}

async function readBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 300) };
  }
}

const describe = (b) => [b?.message, b?.errorCode, ...(Array.isArray(b?.errors) ? b.errors.map((e) => (typeof e === "string" ? e : e?.message ?? JSON.stringify(e))) : [])].filter(Boolean).join(" — ");

/** Starts an operation (expects 202 + Location) and returns its ID. */
async function start(fetchImpl, url, init, what) {
  const res = await fetchImpl(url, init);
  if (res.status !== 202) {
    const b = await readBody(res);
    if (res.status === 401 || res.status === 403) throw new Error(`Edge refused the API key (HTTP ${res.status}). API keys expire: make a new one in Partner Center → Publish API and update EDGE_API_KEY.`);
    throw new Error(`${what} failed (HTTP ${res.status})${describe(b) ? `: ${describe(b)}` : ""}`);
  }
  return operationIdFrom(res.headers.get("Location"));
}

/** Polls an operation until it's no longer InProgress. */
async function follow(fetchImpl, url, headers, what, { waitMs, pollMs, sleep, log }) {
  for (let waited = 0; ; waited += pollMs) {
    const res = await fetchImpl(url, { headers });
    const b = await readBody(res);
    if (!res.ok) throw new Error(`Checking ${what} failed (HTTP ${res.status})${describe(b) ? `: ${describe(b)}` : ""}`);
    if (b.status === "Succeeded") return b;
    if (b.status === "Failed") throw new Error(`${what} failed: ${describe(b) || "no details"}`);
    if (waited >= waitMs) throw new Error(`${what} is still in progress after ${Math.round(waitMs / 1000)} s; check Partner Center`);
    log(`${what}: still in progress…`);
    await sleep(pollMs);
  }
}

export async function main(args, { env = process.env, fetchImpl = fetch, log = console.log, readZip = (p) => readFileSync(p), waitMs = 300_000, pollMs = 5_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const [cmd, zipPath, notes] = args;
  if (!["upload", "submit"].includes(cmd) || !zipPath) {
    log('Usage: edge-store.mjs upload <zip> | submit <zip> ["notes for certification"]');
    return 2;
  }
  const poll = { waitMs, pollMs, sleep, log };
  try {
    const s = settings(env);
    const zip = readZip(zipPath);
    const base = `${API}/v1/products/${s.productId}/submissions`;
    log(`Uploading ${zipPath} (${Math.round(zip.length / 1024)} KB) to the Edge listing ${s.productId}…`);
    const up = await start(fetchImpl, `${base}/draft/package`, { method: "POST", headers: { ...s.headers, "Content-Type": "application/zip" }, body: zip }, "Upload");
    const done = await follow(fetchImpl, `${base}/draft/package/operations/${up}`, s.headers, "Upload", poll);
    log(`Uploaded: ${done.message || "OK"}.`);
    if (cmd === "upload") {
      log("It's in the draft: check the listing in Partner Center and press Publish there.");
      return 0;
    }
    const pub = await start(fetchImpl, base, { method: "POST", headers: { ...s.headers, "Content-Type": "application/json" }, body: JSON.stringify({ notes: notes || "Update from GitHub (ProdLi release)." }) }, "Submitting");
    const published = await follow(fetchImpl, `${base}/operations/${pub}`, s.headers, "Submitting", poll);
    log(`Submitted for certification: ${published.message || "OK"}. Microsoft publishes it once it passes.`);
    return 0;
  } catch (e) {
    log(`Edge Add-ons: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
