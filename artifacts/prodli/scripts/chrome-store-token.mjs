#!/usr/bin/env node
/**
 * One-time, on your own computer: gets the Chrome Web Store refresh token that
 * .github/workflows/store.yml uses (GitHub secret CWS_REFRESH_TOKEN).
 *
 *   CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… node artifacts/prodli/scripts/chrome-store-token.mjs
 *
 * It opens Google's sign-in in your browser (sign in with the account that owns
 * the ProdLi store item), catches the answer on 127.0.0.1 and prints the
 * refresh token. Nothing is saved. The client must be a "Desktop app" OAuth
 * client; setup steps: STORE_SUBMISSION.md → "Releasing from GitHub".
 */

import { createServer } from "http";
import { randomBytes } from "crypto";
import { execFile } from "child_process";

const clientId = process.env.CWS_CLIENT_ID?.trim();
const clientSecret = process.env.CWS_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error("Set CWS_CLIENT_ID and CWS_CLIENT_SECRET first (the Desktop app OAuth client).");
  process.exit(2);
}

const state = randomBytes(16).toString("hex");
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/chromewebstore",
    access_type: "offline",
    prompt: "consent",
    state,
  })}`;
  console.log(`Opening Google sign-in. If no browser opens, visit:\n\n${url}\n`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [url], () => undefined);

  server.on("request", async (req, res) => {
    const q = new URL(req.url ?? "/", redirectUri).searchParams;
    if (!q.get("code") && !q.get("error")) { res.writeHead(404).end(); return; }
    const finish = (msg, code) => { res.writeHead(200, { "Content-Type": "text/plain" }).end(msg); server.close(); process.exitCode = code; };
    if (q.get("state") !== state) return finish("State mismatch; run the script again.", 1);
    if (q.get("error")) { console.error(`Google said: ${q.get("error")}`); return finish("Sign-in was cancelled. You can close this tab.", 1); }
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: q.get("code"), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.refresh_token) {
      console.error(`No refresh token: ${JSON.stringify(body)}`);
      return finish("Something went wrong; see the terminal.", 1);
    }
    console.log("Refresh token (save it as the GitHub secret CWS_REFRESH_TOKEN, then clear this terminal):\n");
    console.log(body.refresh_token);
    finish("Done. You can close this tab and go back to the terminal.", 0);
  });
});
