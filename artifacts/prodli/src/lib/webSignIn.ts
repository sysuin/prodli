// Extension sign-in where Chrome's own Google sign-in (chrome.identity.getAuthToken)
// isn't there: Edge, Brave, Opera, Vivaldi, Arc… (they install from the Chrome Web
// Store too), or a build without a Google client ID. The same steps as the
// desktop app (prodli-api/src/desktopAuth.ts, PKCE):
//
//   1. The extension keeps a random verifier and opens
//      app.prodli.com/?extension=signin&id=<extension id>&state=…&challenge=SHA256(verifier)
//      in a normal tab, where the user signs in as on the web.
//   2. The page (components/DesktopHandoff.tsx) gets a one-time code for this
//      extension and hands it over with chrome.runtime.sendMessage
//      (externally_connectable: only app.prodli.com can message the extension).
//   3. The background (registerWebSignIn) checks the sender and the state and
//      trades code + verifier for an ordinary extension session.
//
// The server only issues these codes for ProdLi's own extension IDs, and a code
// is useless without the verifier, which never leaves the extension.

import { accountRequest, apiBase, saveExtensionSession, signInFromExtension, type ProdliUser } from "./prodliAccount";

export const WEB_SIGNIN_MESSAGE = "prodli-signin";
const PENDING_KEY = "pendingWebSignIn"; // this device only (chrome.storage.session where there is one)
const PENDING_TTL = 15 * 60_000;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE = /^plec_[A-Za-z0-9_-]{43}$/;

interface Pending {
  state: string;
  verifier: string;
  createdAt: number;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function challengeFor(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** The server's web origin (app.prodli.com in the store build). */
export function serverWebOrigin(): string {
  const base = apiBase();
  return base ? new URL(base).origin : location.origin;
}

/** The page the extension opens. */
export function webSignInUrl(origin: string, extensionId: string, state: string, challenge: string): string {
  return `${origin.replace(/\/+$/, "")}/?${new URLSearchParams({ extension: "signin", id: extensionId, state, challenge }).toString()}`;
}

/** Browsers known not to have Chrome's Google sign-in: go straight to the web sign-in. */
export function knownWithoutChromeSignIn(nav: { userAgentData?: { brands?: { brand: string }[] }; brave?: unknown; userAgent?: string } = navigator as never): boolean {
  if (nav.brave) return true;
  const brands = (nav.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.some((b) => /Microsoft Edge|Opera|Brave|Vivaldi|Yandex/i.test(b))) return true;
  return /\b(Edg|OPR|YaBrowser)\//.test(nav.userAgent ?? "");
}

const area = (): chrome.storage.StorageArea => chrome.storage.session ?? chrome.storage.local;

/** Step 1: remember a fresh verifier and open the sign-in page in a tab. */
export async function startWebSignIn(): Promise<void> {
  const pending: Pending = { state: random(24), verifier: random(48), createdAt: Date.now() };
  await area().set({ [PENDING_KEY]: pending });
  await chrome.tabs.create({ url: webSignInUrl(serverWebOrigin(), chrome.runtime.id, pending.state, await challengeFor(pending.verifier)) });
}

export type FinishResult = { ok: true; user: ProdliUser } | { ok: false; error: string };

/** Why a message from the sign-in page can't be used, or null if it can (pure, for tests). */
export function checkSignInMessage(msg: unknown, senderOrigin: string | undefined, expectedOrigin: string, pending: Pending | null, now = Date.now()): string | null {
  const m = msg as { type?: unknown; code?: unknown; state?: unknown } | null;
  if (!m || m.type !== WEB_SIGNIN_MESSAGE) return "not_signin";
  if (senderOrigin !== expectedOrigin) return "wrong_sender";
  if (typeof m.code !== "string" || !CODE.test(m.code) || typeof m.state !== "string" || !STATE.test(m.state)) return "bad_message";
  if (!pending || pending.state !== m.state) return "not_started";
  if (now - pending.createdAt > PENDING_TTL) return "expired";
  return null;
}

/** Step 3 (background): the page sent a code — check it and trade it for a session. */
export async function finishWebSignIn(msg: unknown, senderOrigin: string | undefined): Promise<FinishResult> {
  const pending = ((await area().get(PENDING_KEY))[PENDING_KEY] as Pending | undefined) ?? null;
  const problem = checkSignInMessage(msg, senderOrigin, serverWebOrigin(), pending);
  if (problem === "not_signin") return { ok: false, error: "Unknown message." };
  if (problem) return { ok: false, error: problem === "expired" || problem === "not_started" ? "This sign-in has expired. Start again from ProdLi in your browser." : "This sign-in can't be used." };
  await area().remove(PENDING_KEY);
  try {
    const r = await accountRequest<{ user: ProdliUser; token: string; session: { expiresAt: number } }>("/api/auth/desktop/token", {
      method: "POST",
      body: JSON.stringify({ code: (msg as { code: string }).code, verifier: pending!.verifier }),
    });
    await saveExtensionSession(r);
    return { ok: true, user: r.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in failed. Try again." };
  }
}

/** Background: answer the sign-in page. */
export function registerWebSignIn(): void {
  chrome.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
    if ((msg as { type?: unknown } | null)?.type !== WEB_SIGNIN_MESSAGE) return false;
    void finishWebSignIn(msg, sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined)).then((r) => sendResponse(r.ok ? { ok: true, email: r.user.email } : r));
    return true; // answers asynchronously
  });
}

/**
 * The extension's "Sign in with Google": Chrome's own sign-in where it works,
 * otherwise (or if it fails for any reason but a cancel) the web sign-in in a tab.
 */
export async function signInAnyBrowser(): Promise<{ user: ProdliUser } | { openedTab: true }> {
  if (!knownWithoutChromeSignIn()) {
    try {
      return { user: await signInFromExtension(true) };
    } catch (err) {
      if (err instanceof Error && /cancelled/i.test(err.message)) throw err;
    }
  }
  await startWebSignIn();
  return { openedTab: true };
}
