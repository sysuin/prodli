#!/usr/bin/env node
/**
 * Chrome Web Store API (v2): upload ProdLi's store zip and, if asked, submit it
 * for review. Used by .github/workflows/store.yml; runs anywhere with Node 22.
 *
 *   node scripts/chrome-store.mjs status              → the item's upload and review state
 *   node scripts/chrome-store.mjs upload <zip>        → uploads a new draft (submit it in the dashboard)
 *   node scripts/chrome-store.mjs submit <zip>        → uploads, then submits for review;
 *                                                       Google publishes it once approved
 *
 * Settings (environment):
 *   CWS_SERVICE_ACCOUNT  the service account's JSON key (the whole file's text), or
 *   CWS_ACCESS_TOKEN     an access token you already have (e.g. from gcloud)
 *   CWS_PUBLISHER_ID     Developer Dashboard → Publisher → Settings
 *   CWS_EXTENSION_ID     optional; default ProdLi's
 * Setup: STORE_SUBMISSION.md → "Releasing from GitHub".
 */

import { readFileSync } from "fs";
import { createSign } from "crypto";
import { pathToFileURL } from "url";

export const PRODLI_EXTENSION_ID = "gjgknflakhglanjaeenkmciohimnbkdp";
const API = "https://chromewebstore.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

/** Turns a failed response's body into one readable line. */
export function errorText(status, body) {
  if (body && typeof body.error === "string") {
    if (body.error === "invalid_grant") return `Google refused the service account (invalid_grant${body.error_description ? `: ${body.error_description}` : ""}): check the CWS_SERVICE_ACCOUNT key`;
    return `${body.error}${body.error_description ? `: ${body.error_description}` : ""}`;
  }
  if (body?.error?.message) return `HTTP ${status}: ${body.error.message}`;
  return `HTTP ${status}: ${JSON.stringify(body).slice(0, 500)}`;
}

async function call(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(errorText(res.status, body));
  return body;
}

export function settings(env) {
  const missing = [];
  if (!env.CWS_PUBLISHER_ID?.trim()) missing.push("CWS_PUBLISHER_ID");
  const token = env.CWS_ACCESS_TOKEN?.trim();
  let account = null;
  if (!token) {
    if (!env.CWS_SERVICE_ACCOUNT?.trim()) missing.push("CWS_SERVICE_ACCOUNT");
    else {
      try { account = JSON.parse(env.CWS_SERVICE_ACCOUNT); } catch { throw new Error("CWS_SERVICE_ACCOUNT isn't JSON: paste the whole key file"); }
      if (!account.client_email || !account.private_key) throw new Error("CWS_SERVICE_ACCOUNT has no client_email or private_key: use the service account's JSON key");
    }
  }
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")} (STORE_SUBMISSION.md → "Releasing from GitHub")`);
  const item = `publishers/${env.CWS_PUBLISHER_ID.trim()}/items/${env.CWS_EXTENSION_ID?.trim() || PRODLI_EXTENSION_ID}`;
  return { item, token, account };
}

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A signed JWT for the service account (Google's "JWT bearer" grant). */
export function serviceAccountAssertion(account, now = Math.floor(Date.now() / 1000)) {
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ iss: account.client_email, scope: SCOPE, aud: account.token_uri || TOKEN_URL, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(account.private_key).toString("base64url")}`;
}

export async function accessToken(s, fetchImpl) {
  if (s.token) return s.token;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(s.account) });
  const res = await call(fetchImpl, s.account.token_uri || TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.access_token) throw new Error("Google sent no access token");
  return res.access_token;
}

export function fetchStatus(s, token, fetchImpl) {
  return call(fetchImpl, `${API}/v2/${s.item}:fetchStatus`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Uploads the zip; waits (up to waitMs) while Google is still processing it. Returns the final upload state. */
export async function upload(s, token, zip, fetchImpl, { waitMs = 120_000, pollMs = 3_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const res = await call(fetchImpl, `${API}/upload/v2/${s.item}:upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    body: zip,
  });
  let state = res.uploadState;
  for (let waited = 0; state === "IN_PROGRESS" && waited < waitMs; waited += pollMs) {
    log("Google is still processing the upload…");
    await sleep(pollMs);
    state = (await fetchStatus(s, token, fetchImpl)).lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`Upload ${state === "IN_PROGRESS" ? "still processing after the wait; check the dashboard" : `failed (${state ?? "no state"}): ${JSON.stringify(res).slice(0, 800)}`}`);
  return { version: res.crxVersion, state };
}

export function publish(s, token, fetchImpl) {
  return call(fetchImpl, `${API}/v2/${s.item}:publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
  });
}

/** The command line, with fetch and output passed in so tests can drive it. Returns the exit code. */
export async function main(args, { env = process.env, fetchImpl = fetch, log = console.log, readZip = (p) => readFileSync(p), uploadOptions = {} } = {}) {
  const [cmd, zipPath] = args;
  if (!["status", "upload", "submit"].includes(cmd) || (cmd !== "status" && !zipPath)) {
    log("Usage: chrome-store.mjs status | upload <zip> | submit <zip>");
    return 2;
  }
  try {
    const s = settings(env);
    const token = await accessToken(s, fetchImpl);
    if (cmd === "status") {
      log(JSON.stringify(await fetchStatus(s, token, fetchImpl), null, 2));
      return 0;
    }
    const zip = readZip(zipPath);
    log(`Uploading ${zipPath} (${Math.round(zip.length / 1024)} KB) to ${s.item}…`);
    const up = await upload(s, token, zip, fetchImpl, { log, ...uploadOptions });
    log(`Uploaded version ${up.version ?? "?"}: ${up.state}.`);
    if (cmd === "upload") {
      log("It's a draft: review the listing in the Developer Dashboard and press Submit for review.");
      return 0;
    }
    const pub = await publish(s, token, fetchImpl);
    log(`Submitted for review: ${pub.state ?? JSON.stringify(pub)}. Google publishes it once approved.`);
    return 0;
  } catch (e) {
    log(`Chrome Web Store: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
