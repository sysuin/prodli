// Requests to ProdLi's server (artifacts/prodli-api) with this phone's session.
// The phone holds a bearer token (like the extension), kept in the Keychain /
// Keystore — never in the regular app storage.
import { secret } from "./secret";
import { read, remove, write } from "./store";

export const ACCOUNT_KEY = "prodliAccount";
export const SESSION_SECRET = "prodliSessionToken";
export const SYNC_STATE_KEY = "prodliSyncState";
export const SYNC_STATUS_KEY = "prodliSyncStatus";

export interface ProdliUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  plan: string;
  createdAt: number;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = "",
  ) {
    super(message);
  }
}

let base = "https://app.prodli.com";
let fetcher: typeof fetch = (...args) => fetch(...args);

export function configureApi(opts: { base?: string; fetch?: typeof fetch }): void {
  if (opts.base) base = opts.base.replace(/\/+$/, "");
  if (opts.fetch) fetcher = opts.fetch;
}
export const apiBase = () => base;

const friendly: Record<string, string> = {
  unauthorized: "You've been signed out. Sign in again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  google_auth_failed: "Google couldn't confirm your sign-in. Try again.",
  confirmation_mismatch: "The email you typed doesn't match this account.",
  quota_exceeded: "Your ProdLi storage is full. Delete some notes or meetings to keep syncing.",
  subscription_active: "Cancel your Pro subscription first (on prodli.com → Account), then delete your account.",
  item_too_large: "One item is too large to sync.",
  too_large: "That's too much to send at once.",
  ai_quota_exceeded: "You've used this month's AI summaries. They reset on the 1st.",
  ai_unavailable: "ProdLi AI isn't available right now. Try again in a little while.",
  ai_busy: "ProdLi AI is busy right now. Try again in a minute.",
  ai_failed: "Something went wrong. Try again.",
  ask_quota_exceeded: "You've used this month's Ask ProdLi questions. They reset on the 1st.",
  brief_quota_exceeded: "You've used this month's AI briefs — here's a basic one instead. They reset on the 1st.",
  write_quota_exceeded: "You've used this month's AI writing help. It resets on the 1st.",
  ai_refused: "Claude declined to do that.",
  ai_truncated: "The answer was cut off. Try again.",
  mobile_signin_unavailable: "Phone sign-in isn't set up on this server yet.",
};

export const getAccount = (): ProdliUser | null => read<ProdliUser | null>(ACCOUNT_KEY, null);
export const hasSession = (): boolean => !!secret.get(SESSION_SECRET);

export function saveSession(user: ProdliUser, token: string): void {
  secret.set(SESSION_SECRET, token);
  write(ACCOUNT_KEY, user);
}

/** Signed out (here or on the server): forget the session; local data stays. */
export function forgetSession(): void {
  secret.remove(SESSION_SECRET);
  for (const k of [ACCOUNT_KEY, SYNC_STATE_KEY, SYNC_STATUS_KEY]) remove(k);
}

export async function request<T>(path: string, init: RequestInit = {}, messages: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const token = secret.get(SESSION_SECRET);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetcher(`${base}${path}`, { ...init, headers });
  } catch {
    throw new AccountError("Can't reach ProdLi. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/auth/google") forgetSession();
    const code = body.error ?? "";
    throw new AccountError(messages[code] ?? friendly[code] ?? body.message ?? `Something went wrong (${res.status}).`, res.status, code);
  }
  return body;
}

/** Turns any error into a sentence for the screen. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
