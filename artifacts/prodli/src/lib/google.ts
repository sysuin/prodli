// Sign in with Google + backup to the user's own Google Drive.
//
// Zero cost: there is no ProdLi server. Chrome's identity API signs the user
// in, and backups go to Drive's hidden "app data" folder — a private space in
// the user's Drive that only ProdLi can read (scope `drive.appdata`, which
// Google classifies as non-sensitive). The Claude API key is never backed up.

import { buildBackup, restoreBackup, type ImportResult } from "./backupRestore";
import { storageGet, storageRemove, storageSet } from "./storage";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE];
export const ACCOUNT_KEY = "googleAccount";
export const AUTO_BACKUP_KEY = "driveAutoBackup";
export const LAST_BACKUP_KEY = "driveLastBackup";
export const BACKUP_FILE_NAME = "prodli-backup.json";
export const DRIVE_ALARM = "drive_backup";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export interface GoogleAccount {
  sub: string;
  name: string;
  email: string;
  picture: string | null;
  signedInAt: string;
}

export interface BackupInfo {
  at: string;
  bytes: number;
  auto: boolean;
}

export class GoogleError extends Error {}

/** True when this build has a Google OAuth client ID (see docs/GOOGLE-SIGN-IN.md). */
export function googleConfigured(): boolean {
  if (typeof chrome === "undefined" || !chrome.identity?.getAuthToken || !chrome.runtime?.getManifest) return false;
  const id = (chrome.runtime.getManifest() as chrome.runtime.Manifest & { oauth2?: { client_id?: string } }).oauth2?.client_id ?? "";
  return /\.apps\.googleusercontent\.com$/.test(id);
}

function friendlyAuthError(message: string): string {
  if (/did not approve|canceled|cancelled|user.*(closed|denied)/i.test(message)) return "Sign-in was cancelled.";
  if (/not signed in|no.*account/i.test(message)) return "Sign in to Chrome with your Google account first, then try again.";
  if (/bad client id|invalid.*client|oauth2/i.test(message)) return "Google sign-in isn't set up correctly for this copy of ProdLi.";
  return message || "Google sign-in failed.";
}

export async function getToken(interactive: boolean): Promise<string> {
  if (!googleConfigured()) throw new GoogleError("Google sign-in isn't set up in this build.");
  try {
    const result = (await chrome.identity.getAuthToken({ interactive, scopes: SCOPES })) as { token?: string } | string | undefined;
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw new Error("No token");
    return token;
  } catch (err) {
    throw new GoogleError(friendlyAuthError(err instanceof Error ? err.message : String(err)));
  }
}

/** fetch with the user's token; refreshes the token once if it has expired. */
async function authedFetch(url: string, init: RequestInit = {}, interactive = false): Promise<Response> {
  let token = await getToken(interactive);
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(interactive);
    res = await go(token);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 403 && /insufficient|scope/i.test(detail)) throw new GoogleError("ProdLi needs permission to use its Google Drive folder. Sign out and sign in again.");
    if (res.status === 403 && /storageQuota|quota/i.test(detail)) throw new GoogleError("Your Google Drive is full.");
    throw new GoogleError(`Google request failed (${res.status}).`);
  }
  return res;
}

// ── Account ───────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<GoogleAccount | null> {
  return storageGet<GoogleAccount | null>(ACCOUNT_KEY, null);
}

export async function signIn(): Promise<GoogleAccount> {
  const res = await authedFetch("https://www.googleapis.com/oauth2/v3/userinfo", {}, true);
  const info = (await res.json()) as { sub: string; name?: string; email?: string; picture?: string };
  const account: GoogleAccount = {
    sub: info.sub,
    name: info.name || info.email || "Google user",
    email: info.email ?? "",
    picture: info.picture ?? null,
    signedInAt: new Date().toISOString(),
  };
  await storageSet(ACCOUNT_KEY, account);
  if ((await storageGet<boolean | null>(AUTO_BACKUP_KEY, null)) === null) await storageSet(AUTO_BACKUP_KEY, true);
  return account;
}

export async function signOut(): Promise<void> {
  try {
    const token = await getToken(false);
    await chrome.identity.removeCachedAuthToken({ token });
    // Revoke so ProdLi no longer has access; the user can sign in again any time.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  } catch {
    // Not signed in to Google any more — just forget the account locally.
  }
  await chrome.identity.clearAllCachedAuthTokens?.().catch(() => {});
  await storageRemove(ACCOUNT_KEY);
}

// ── Drive backup ──────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  modifiedTime?: string;
  size?: string;
}

export async function findBackupFile(): Promise<DriveFile | null> {
  const q = encodeURIComponent(`name='${BACKUP_FILE_NAME}' and trashed=false`);
  const res = await authedFetch(`${DRIVE_FILES}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=1`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files?.[0] ?? null;
}

function multipartBody(metadata: object, content: string): { body: string; contentType: string } {
  const boundary = `prodli${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/** Uploads a full ProdLi backup to Drive (replacing the previous one; Drive keeps old revisions). */
export async function backupToDrive(auto = false): Promise<BackupInfo> {
  const json = JSON.stringify(await buildBackup());
  const existing = await findBackupFile();
  const { body, contentType } = existing
    ? multipartBody({ mimeType: "application/json" }, json)
    : multipartBody({ name: BACKUP_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }, json);
  const url = existing ? `${DRIVE_UPLOAD}/${existing.id}?uploadType=multipart&fields=id,modifiedTime,size` : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime,size`;
  await authedFetch(url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body });
  const info: BackupInfo = { at: new Date().toISOString(), bytes: new Blob([json]).size, auto };
  await storageSet(LAST_BACKUP_KEY, info);
  return info;
}

export async function latestDriveBackup(): Promise<{ modifiedTime: string | null; bytes: number } | null> {
  const file = await findBackupFile();
  return file ? { modifiedTime: file.modifiedTime ?? null, bytes: Number(file.size ?? 0) } : null;
}

/** Replaces local data with the backup stored in Drive. */
export async function restoreFromDrive(): Promise<ImportResult> {
  const file = await findBackupFile();
  if (!file) return { ok: false, error: "No ProdLi backup found in your Google Drive yet." };
  const res = await authedFetch(`${DRIVE_FILES}/${file.id}?alt=media`);
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "The backup in Google Drive couldn't be read." };
  }
  return restoreBackup(parsed);
}

/** Background: back up once a day while signed in with auto-backup on. */
export async function autoBackupIfDue(now = Date.now()): Promise<boolean> {
  if (!googleConfigured()) return false;
  const [account, enabled, last] = await Promise.all([getAccount(), storageGet<boolean>(AUTO_BACKUP_KEY, true), storageGet<BackupInfo | null>(LAST_BACKUP_KEY, null)]);
  if (!account || !enabled) return false;
  if (last && now - new Date(last.at).getTime() < 20 * 60 * 60 * 1000) return false;
  await backupToDrive(true);
  return true;
}
