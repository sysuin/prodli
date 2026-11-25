// ProdLi account (phase 1 of docs/PLAN-WEB-APP.md): Google sign-in → a session
// with ProdLi's server (artifacts/prodli-api).
//
// Which server, set at build time with VITE_PRODLI_API:
//   "same-origin"  the web app at app.prodli.com (served by the API Worker)
//   https://…      an extension build talking to that server
//   (unset)        no ProdLi account in this build; everything works as before
//
// The extension keeps a bearer token in chrome.storage.local; the desktop app
// keeps it in its own store, encrypted with the OS keychain (desktop.ts). The
// web app never sees its token: the server sets an HttpOnly cookie.

import { desktop } from "./desktop";
import { getToken, PROFILE_SCOPES } from "./google";
import { onStorageChange, storageGet, storageRemove, storageSet } from "./storage";

export const PRODLI_ACCOUNT_KEY = "prodliAccount";
export const PRODLI_SESSION_KEY = "prodliSession";
/** What this device knows about the server's copy (see prodliSync.ts); forgotten on sign-out. */
export const SYNC_STATE_KEY = "prodliSyncState";
export const SYNC_STATUS_KEY = "prodliSyncStatus";

export interface ProdliUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  /** "free" | "pro" (Pro Plus subscribers are "pro" here too; see `tier`). */
  plan: string;
  /** The exact plan: "free" | "pro" | "plus" (older servers don't send it). */
  tier?: string;
  createdAt: number;
  /** When the free Pro trial ends, while it runs (older servers don't send it). */
  trialEndsAt?: number | null;
}

export interface Device {
  id: string;
  client: "extension" | "web" | "mobile" | "desktop";
  device: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

interface StoredSession {
  token: string;
  expiresAt: number;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const configured = (): string => (import.meta.env.VITE_PRODLI_API as string | undefined)?.trim() ?? "";

/** True when this build talks to ProdLi's server. */
export function accountsEnabled(): boolean {
  return configured() !== "";
}

export function apiBase(): string {
  const v = configured();
  return v === "same-origin" ? "" : v.replace(/\/+$/, "");
}

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage?.local;
/** The extension and the desktop app send `Authorization: Bearer`; the web app uses its cookie. */
const usesBearer = () => isExtension() || desktop() !== null;

const friendly: Record<string, string> = {
  unauthorized: "You've been signed out. Sign in again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  google_auth_failed: "Google couldn't confirm your sign-in. Try again.",
  confirmation_mismatch: "The email you typed doesn't match this account.",
  bad_origin: "This page isn't allowed to change your account.",
  quota_exceeded: "Your ProdLi storage is full. Delete some notes or meetings, or get more space with ProdLi Pro (👤 Account), to keep syncing.",
  subscription_active: "Cancel your Pro subscription first (Account → Manage subscription), then delete your account.",
  no_subscription: "There's no subscription on this account.",
  billing_unavailable: "Subscriptions can't be managed right now. Try again later.",
  billing_failed: "Couldn't open the subscription page. Try again.",
  already_subscribed: "You already have a plan. Pick another plan to switch.",
  same_plan: "You're already on this plan.",
  item_too_large: "One item is too large to sync.",
  too_large: "That's too much to send at once.",
  ai_quota_exceeded: "You've used this month's AI summaries. They reset on the 1st — or get more with ProdLi Pro (👤 Account).",
  ai_unavailable: "ProdLi summaries aren't available right now. Try again in a little while.",
  ai_busy: "Summaries are busy right now. Try again in a minute.",
  ai_failed: "Summarizing failed. Try again.",
  ask_quota_exceeded: "You've used this month's Ask ProdLi questions. They reset on the 1st — or get more with ProdLi Pro (👤 Account).",
  brief_quota_exceeded: "You've used this month's AI briefs — here's a basic one instead. They reset on the 1st, or get more with ProdLi Pro (👤 Account).",
  ai_refused: "Claude declined to summarize this meeting.",
  ai_truncated: "The summary was cut off. Try again.",
};

/**
 * A request to ProdLi's server with this device's session.
 * `messages` overrides the friendly text for specific error codes (e.g. writing help's own wording for "ai_busy").
 */
export async function accountRequest<T>(path: string, init: RequestInit = {}, messages: Record<string, string> = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (usesBearer()) {
    const session = await storageGet<StoredSession | null>(PRODLI_SESSION_KEY, null);
    if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: usesBearer() ? "omit" : "include" });
  } catch {
    throw new AccountError("Can't reach ProdLi. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/auth/google") await forgetLocally();
    const code = body.error ?? "";
    throw new AccountError(messages[code] ?? friendly[code] ?? `Something went wrong (${res.status}).`, res.status);
  }
  return body;
}

async function forgetLocally(): Promise<void> {
  await Promise.all([PRODLI_ACCOUNT_KEY, PRODLI_SESSION_KEY, SYNC_STATE_KEY, SYNC_STATUS_KEY].map((k) => storageRemove(k)));
}

export function getProdliAccount(): Promise<ProdliUser | null> {
  return storageGet<ProdliUser | null>(PRODLI_ACCOUNT_KEY, null);
}

export function onProdliAccountChange(cb: (user: ProdliUser | null) => void): () => void {
  return onStorageChange<ProdliUser>(PRODLI_ACCOUNT_KEY, (v) => cb(v ?? null));
}

/** Extension: Google (chrome.identity) → ProdLi session. */
export async function signInFromExtension(interactive = true): Promise<ProdliUser> {
  // Profile only: ProdLi accounts don't need Google Drive (a device that used the
  // old Drive sync already granted it, and its Drive copy is imported once).
  const accessToken = await getToken(interactive, PROFILE_SCOPES);
  const r = await accountRequest<{ user: ProdliUser; token: string; session: { expiresAt: number } }>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ kind: "extension", accessToken }),
  });
  await saveExtensionSession(r);
  return r.user;
}

/** Keeps an extension (bearer) session and the profile: after Chrome's sign-in, or the web sign-in (lib/webSignIn.ts). */
export async function saveExtensionSession(r: { user: ProdliUser; token: string; session: { expiresAt: number } }): Promise<void> {
  await storageSet<StoredSession>(PRODLI_SESSION_KEY, { token: r.token, expiresAt: r.session.expiresAt });
  await storageSet(PRODLI_ACCOUNT_KEY, r.user);
}

/**
 * Desktop app: sign in through the system browser (app.prodli.com), which hands
 * the app a one-time code. The app's main process stores the session and the
 * profile under the usual keys, so this page hears about it like any change.
 */
export async function signInFromDesktop(): Promise<ProdliUser> {
  const d = desktop();
  if (!d) throw new AccountError("This only works in the ProdLi desktop app.");
  const r = await d.account.signIn();
  if (!r.ok) throw new AccountError(r.cancelled ? "Sign-in was cancelled." : r.error);
  const user = await getProdliAccount();
  if (!user) throw new AccountError("Signed in, but your profile didn't arrive. Try again.");
  return user;
}

/** Web: a Google Identity Services ID token → ProdLi session (HttpOnly cookie). */
export async function signInFromWeb(idToken: string): Promise<ProdliUser> {
  const r = await accountRequest<{ user: ProdliUser }>("/api/auth/google", { method: "POST", body: JSON.stringify({ kind: "web", idToken }) });
  await storageSet(PRODLI_ACCOUNT_KEY, r.user);
  return r.user;
}

/** Asks the server who's signed in (and refreshes the cached profile). */
export async function refreshAccount(): Promise<ProdliUser | null> {
  try {
    const { user } = await accountRequest<{ user: ProdliUser }>("/api/me");
    await storageSet(PRODLI_ACCOUNT_KEY, user);
    return user;
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) return null;
    return getProdliAccount(); // offline: keep showing the cached account
  }
}

export interface AiUsage {
  used: number;
  limit: number;
  available: boolean;
  briefs?: { used: number; limit: number };
  asks?: { used: number; limit: number };
  writes?: { used: number; limit: number };
  /** Seconds of audio transcribed this month ("Transcribe audio with AI"). */
  transcribeSeconds?: { used: number; limit: number; available: boolean };
}

/** This month's AI summaries through ProdLi. */
export async function getAiUsage(): Promise<AiUsage> {
  return accountRequest<AiUsage>("/api/ai/usage");
}

export async function listDevices(): Promise<Device[]> {
  return (await accountRequest<{ sessions: Device[] }>("/api/sessions")).sessions;
}

export async function signOutDevice(id: string): Promise<void> {
  await accountRequest(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function signOutHere(): Promise<void> {
  try {
    await accountRequest("/api/auth/logout", { method: "POST" });
  } catch {
    // Already signed out on the server, or offline — forget locally anyway.
  }
  await forgetLocally();
}

export async function signOutEverywhere(): Promise<void> {
  await accountRequest("/api/auth/logout-all", { method: "POST" });
  await forgetLocally();
}

/** Downloads everything ProdLi's server holds about the account. */
/** A personal access token for the read-only API and MCP (Settings → Connections). */
export interface ApiToken {
  id: string;
  name: string;
  /** The token's first characters ("plt_AbCd"), to tell keys apart. */
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const tokenMessages = {
  too_many_tokens: "You can have up to 10 keys. Revoke one you don't use, then try again.",
  bad_request: 'Give the key a name, like "Claude Desktop".',
  not_found: "That key was already revoked.",
};

export async function listApiTokens(): Promise<{ tokens: ApiToken[]; max: number }> {
  return accountRequest<{ tokens: ApiToken[]; max: number }>("/api/tokens", {}, tokenMessages);
}

/** Creates a key. The token itself comes back only this once. */
export async function createApiToken(name: string): Promise<{ token: string; apiToken: ApiToken }> {
  return accountRequest<{ token: string; apiToken: ApiToken }>("/api/tokens", { method: "POST", body: JSON.stringify({ name }) }, tokenMessages);
}

export async function revokeApiToken(id: string): Promise<void> {
  await accountRequest(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }, tokenMessages);
}

/** Where this build's server lives (for the web app: this page's own origin). */
export function serverOrigin(): string {
  return apiBase() || (typeof location !== "undefined" ? location.origin : "https://app.prodli.com");
}

export async function downloadAccountExport(): Promise<void> {
  const data = await accountRequest<Record<string, unknown>>("/api/account/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prodli-account-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteAccount(confirmEmail: string): Promise<void> {
  await accountRequest("/api/account", { method: "DELETE", body: JSON.stringify({ confirmEmail }) });
  await forgetLocally();
}

// ── Google Identity Services (web only) ──────────────────────────────────────

interface GoogleId {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; auto_select?: boolean; use_fedcm_for_prompt?: boolean }): void;
      renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
      disableAutoSelect(): void;
    };
  };
}

let gisLoading: Promise<GoogleId> | null = null;

function loadGis(): Promise<GoogleId> {
  const w = window as unknown as { google?: GoogleId };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new AccountError("Google sign-in didn't load.")));
    s.onerror = () => {
      gisLoading = null;
      reject(new AccountError("Google sign-in didn't load. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Renders Google's "Sign in with Google" button into `el` (web app only). */
export async function renderGoogleButton(el: HTMLElement, onSignedIn: (u: ProdliUser) => void, onError: (e: Error) => void): Promise<void> {
  const { googleWebClientId } = await accountRequest<{ googleWebClientId: string | null }>("/api/config");
  if (!googleWebClientId) throw new AccountError("Google sign-in isn't set up on this server.");
  const google = await loadGis();
  google.accounts.id.initialize({
    client_id: googleWebClientId,
    ux_mode: "popup",
    auto_select: false,
    callback: ({ credential }) => {
      signInFromWeb(credential).then(onSignedIn, onError);
    },
  });
  google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 280 });
}

export const isExtensionBuild = isExtension;
