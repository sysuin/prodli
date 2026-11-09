// Sign in with Google + backup to the user's own Google Drive.
//
// Zero cost: there is no ProdLi server. Chrome's identity API signs the user
// in, and backups go to Drive's hidden "app data" folder — a private space in
// the user's Drive that only ProdLi can read (scope `drive.appdata`, which
// Google classifies as non-sensitive). The Claude API key is never backed up.

import { buildBackup, restoreBackup, type ImportResult } from "./backupRestore";
import { storageGet, storageRemove, storageSet } from "./storage";
import { mergeSnapshots, type SyncSnapshot } from "./syncMerge";
import { getTombstones, TOMBSTONES_KEY } from "./tombstones";
import { deleteMeeting, listMeetings, putMeeting } from "../recorder/db";
import type { Meeting } from "../recorder/types";

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
  // e.g. "OAuth2 not granted or revoked." — the user hasn't (or no longer) allowed ProdLi's permissions.
  if (/not granted|revoked|consent/i.test(message)) return "ProdLi needs your permission to use its Google Drive folder. Click Sync now (or sign out and sign in again) and allow every permission.";
  if (/bad client id|invalid.*client|redirect_uri|oauth2 client/i.test(message)) return `Google sign-in isn't set up correctly for this copy of ProdLi (${message}).`;
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

// `interactive`: true when the user clicked something, so Chrome may show its
// permission prompt (it shows nothing if access is already granted). Background
// syncs stay non-interactive.
export async function findBackupFile(interactive = false): Promise<DriveFile | null> {
  const q = encodeURIComponent(`name='${BACKUP_FILE_NAME}' and trashed=false`);
  const res = await authedFetch(`${DRIVE_FILES}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=1`, {}, interactive);
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

async function uploadSnapshot(json: string, interactive: boolean): Promise<void> {
  const existing = await findBackupFile(interactive);
  const { body, contentType } = existing
    ? multipartBody({ mimeType: "application/json" }, json)
    : multipartBody({ name: BACKUP_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }, json);
  const url = existing ? `${DRIVE_UPLOAD}/${existing.id}?uploadType=multipart&fields=id,modifiedTime,size` : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime,size`;
  await authedFetch(url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body }, interactive);
}

async function downloadSnapshot(interactive: boolean): Promise<SyncSnapshot | null> {
  const file = await findBackupFile(interactive);
  if (!file) return null;
  const res = await authedFetch(`${DRIVE_FILES}/${file.id}?alt=media`, {}, interactive);
  try {
    const parsed = (await res.json()) as SyncSnapshot;
    if (!parsed || typeof parsed !== "object" || !parsed.data || !["1.0", "1.1"].includes(parsed.version)) {
      throw new GoogleError("The copy in Google Drive is from a newer version of ProdLi. Update ProdLi on this computer.");
    }
    return parsed;
  } catch (err) {
    if (err instanceof GoogleError) throw err;
    throw new GoogleError("The copy in Google Drive couldn't be read.");
  }
}

const SYNCED_KEYS = ["notes", "todos", "habits", "pomodoroSessions", "completedPomodoros"] as const;

/** Writes merged data back to this device (only what changed). */
async function applyLocally(local: SyncSnapshot, merged: SyncSnapshot): Promise<number> {
  let changes = 0;
  for (const key of SYNCED_KEYS) {
    if (JSON.stringify(local.data[key]) !== JSON.stringify(merged.data[key])) {
      await storageSet(key, merged.data[key]);
      changes++;
    }
  }
  await storageSet(TOMBSTONES_KEY, merged.tombstones ?? {});
  const localMeetings = new Map((await listMeetings()).map((m) => [m.id, m]));
  const mergedIds = new Set<string>();
  for (const m of (merged.meetings ?? []) as Meeting[]) {
    mergedIds.add(m.id);
    const mine = localMeetings.get(m.id);
    if (mine?.status === "recording" || mine?.status === "processing") continue; // never touch a live recording
    if (!mine || mine.updatedAt !== m.updatedAt) {
      await putMeeting({ ...m, status: m.status === "recording" || m.status === "processing" ? "ready" : m.status, hasAudio: mine?.hasAudio ?? false, audioMimeType: mine?.audioMimeType ?? null });
      changes++;
    }
  }
  for (const [id, mine] of localMeetings) {
    if (!mergedIds.has(id) && mine.status !== "recording" && mine.status !== "processing") {
      await deleteMeeting(id, { tombstone: false });
      changes++;
    }
  }
  return changes;
}

export interface SyncResult extends BackupInfo {
  /** Number of local collections/meetings updated from the other device(s) */
  changes: number;
}

/**
 * Two-way sync with the user's Google Drive: download the Drive copy, merge it
 * item by item with this device, save the result here, and upload it.
 * Safe to run from several devices; the newest edit of each item wins.
 */
export async function syncWithDrive(auto = false, interactive = !auto): Promise<SyncResult> {
  const remote = await downloadSnapshot(interactive);
  const local: SyncSnapshot = { ...(await buildBackup()), tombstones: await getTombstones() };
  const merged = mergeSnapshots(local, remote);
  const changes = remote ? await applyLocally(local, merged) : 0;
  const json = JSON.stringify(merged);
  await uploadSnapshot(json, interactive);
  const info: SyncResult = { at: new Date().toISOString(), bytes: new Blob([json]).size, auto, changes };
  await storageSet(LAST_BACKUP_KEY, info);
  return info;
}

/** Kept for compatibility: a backup is now a sync. */
export const backupToDrive = syncWithDrive;

export async function latestDriveBackup(): Promise<{ modifiedTime: string | null; bytes: number } | null> {
  const file = await findBackupFile();
  return file ? { modifiedTime: file.modifiedTime ?? null, bytes: Number(file.size ?? 0) } : null;
}

/** Replaces local data with the backup stored in Drive. */
export async function restoreFromDrive(): Promise<ImportResult> {
  const file = await findBackupFile(true);
  if (!file) return { ok: false, error: "No ProdLi backup found in your Google Drive yet." };
  const res = await authedFetch(`${DRIVE_FILES}/${file.id}?alt=media`, {}, true);
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "The backup in Google Drive couldn't be read." };
  }
  return restoreBackup(parsed);
}

/** Background: sync about once an hour while signed in with auto-sync on. */
export async function autoSyncIfDue(now = Date.now()): Promise<boolean> {
  if (!googleConfigured()) return false;
  const [account, enabled, last] = await Promise.all([getAccount(), storageGet<boolean>(AUTO_BACKUP_KEY, true), storageGet<BackupInfo | null>(LAST_BACKUP_KEY, null)]);
  if (!account || !enabled) return false;
  // Signed in to a ProdLi account: ProdLi sync has replaced Drive sync.
  if (await storageGet<unknown>("prodliAccount", null)) return false;
  if (last && now - new Date(last.at).getTime() < 55 * 60 * 1000) return false;
  await syncWithDrive(true);
  return true;
}

/** @deprecated use autoSyncIfDue */
export const autoBackupIfDue = autoSyncIfDue;
