// Sign in through the system browser (core/signIn.ts has the steps). The session
// token goes straight into the store (encrypted); the page only learns that the
// account changed.

import { app, ipcMain, net, shell } from "electron";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { IPC } from "../core/ipc";
import { isAppUrl } from "../core/links";
import { callbackPage, makePkce, platformName, readCallback, signInUrl } from "../core/signIn";
import { writeFileSync } from "node:fs";
import { API_BASE, IS_DEV } from "./config";
import { getStore } from "./store";
import { showMainWindow } from "./windows";

type Result = { ok: true } | { ok: false; error: string; cancelled?: boolean };

const TIMEOUT_MS = 10 * 60 * 1000;
let pending: { server: Server; finish: (r: Result) => void } | null = null;

async function redeem(code: string, verifier: string): Promise<void> {
  const res = await net.fetch(`${API_BASE}/api/auth/desktop/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": `ProdLi/${app.getVersion()} (${platformName(process.platform)})` },
    body: JSON.stringify({ code, verifier, platform: platformName(process.platform) }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; token?: string; user?: unknown; session?: { expiresAt?: number } };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error === "code_expired" ? "The sign-in took too long. Try again." : body.error === "rate_limited" ? "Too many attempts. Wait a minute and try again." : "ProdLi couldn't finish signing you in. Try again.");
  }
  const store = getStore();
  store.set("prodliSession", { token: body.token, expiresAt: body.session?.expiresAt ?? Date.now() + 180 * 864e5 });
  store.set("prodliAccount", body.user);
}

export function signIn(): Promise<Result> {
  pending?.finish({ ok: false, error: "Started again.", cancelled: true });
  const pkce = makePkce();
  return new Promise<Result>((resolve) => {
    let done = false;
    const server = createServer((req, res) => {
      const r = readCallback(req.method, req.url, pkce.state);
      if (r.kind === "ignore") {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const reply = (ok: boolean, msg: string) => {
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }).end(callbackPage(ok, msg));
      };
      if (r.kind === "error") {
        reply(false, r.message);
        return; // keep waiting: a stray request mustn't cancel a real sign-in
      }
      redeem(r.code, pkce.verifier).then(
        () => {
          reply(true, "You can close this tab and go back to ProdLi.");
          finish({ ok: true });
          showMainWindow();
        },
        (err: Error) => {
          reply(false, err.message);
          finish({ ok: false, error: err.message });
        },
      );
    });
    const timer = setTimeout(() => finish({ ok: false, error: "Sign-in timed out. Try again.", cancelled: true }), TIMEOUT_MS);
    const finish = (r: Result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (pending?.server === server) pending = null;
      resolve(r);
    };
    server.on("error", () => finish({ ok: false, error: "ProdLi couldn't start signing in. Try again." }));
    // Loopback only, random free port (RFC 8252).
    server.listen(0, "127.0.0.1", () => {
      pending = { server, finish };
      const { port } = server.address() as AddressInfo;
      const url = signInUrl(API_BASE, port, pkce);
      // Development builds only: tests/e2e.mjs plays the browser's part.
      if (IS_DEV && process.env.PRODLI_E2E_URL_FILE) return void writeFileSync(process.env.PRODLI_E2E_URL_FILE, url);
      void shell.openExternal(url).catch(() => finish({ ok: false, error: "Couldn't open your browser." }));
    });
  });
}

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.signIn, (e) => (isAppUrl(e.senderFrame?.url ?? "") ? signIn() : { ok: false, error: "Not allowed." }));
  ipcMain.handle(IPC.cancelSignIn, () => pending?.finish({ ok: false, error: "Sign-in was cancelled.", cancelled: true }));
}
