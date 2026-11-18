import { storageGet, storageSet } from "./storage";
import { DEFAULT_POMODORO_SETTINGS } from "./pomodoroCore";
import { deleteMeeting, listMeetings, putMeeting } from "../recorder/db";
import type { Meeting } from "../recorder/types";

// 1.0 — notes, to-dos, habits, Pomodoro, theme
// 1.1 — adds Time Tracker history + settings, meeting notes (no audio) and
//       recorder preferences. The Claude API key is never included.
const BACKUP_VERSION = "1.1";
const SUPPORTED_VERSIONS = ["1.0", "1.1"];

const DATA_KEYS = [
  "notes",
  "activeNoteId",
  "editorFont",
  "todos",
  "lists",
  "tabSessions",
  "quickLinks",
  "readLater",
  "habits",
  "pomodoroSettings",
  "pomodoroSessions",
  "completedPomodoros",
  "theme",
] as const;

/** Settings added in 1.1 — only restored from 1.1+ backups. */
const SETTINGS_KEYS_V11 = ["tt_settings", "recorderMicEnabled", "recorderAutoSummarize", "recorderDefaultTemplate", "recorderVocabulary", "recorderDisclosure", "focusBlock"] as const;

type DataKey = typeof DATA_KEYS[number];

const KEY_DEFAULTS: Record<DataKey, unknown> = {
  notes: [],
  activeNoteId: null,
  editorFont: "system",
  todos: [],
  lists: [],
  tabSessions: [],
  quickLinks: [],
  readLater: [],
  habits: [],
  pomodoroSettings: DEFAULT_POMODORO_SETTINGS,
  pomodoroSessions: [],
  completedPomodoros: 0,
  theme: "light",
};

const TRACKING_DAY_KEY = /^tt_\d{4}-\d{2}-\d{2}$/;

export interface ProdLiBackup {
  version: string;
  exportedAt: string;
  data: Record<string, unknown>;
  /** 1.1+: per-day seconds per domain, keyed by YYYY-MM-DD */
  timeTracking?: Record<string, Record<string, number>>;
  /** 1.1+: meetings with transcripts and summaries (audio is not included) */
  meetings?: Meeting[];
}

declare const chrome: {
  storage?: {
    local: {
      get: (keys: null, cb: (r: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb?: () => void) => void;
      remove: (keys: string[], cb?: () => void) => void;
    };
  };
};

const hasChromeStorage = () => typeof chrome !== "undefined" && !!chrome.storage;

// ── Time tracking days (stored as one key per day) ────────────────────────────

async function readTrackingDays(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  if (hasChromeStorage()) {
    const all = await new Promise<Record<string, unknown>>((resolve) => chrome.storage!.local.get(null, resolve));
    for (const [k, v] of Object.entries(all)) if (TRACKING_DAY_KEY.test(k)) out[k.slice(3)] = v as Record<string, number>;
    return out;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("prodli_") && TRACKING_DAY_KEY.test(k.slice(7))) {
      try {
        out[k.slice(10)] = JSON.parse(localStorage.getItem(k)!);
      } catch {
        // skip unreadable day
      }
    }
  }
  return out;
}

async function replaceTrackingDays(days: Record<string, Record<string, number>>): Promise<void> {
  const existing = Object.keys(await readTrackingDays()).map((d) => `tt_${d}`);
  const next: Record<string, unknown> = {};
  for (const [day, data] of Object.entries(days)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && data && typeof data === "object") next[`tt_${day}`] = data;
  }
  if (hasChromeStorage()) {
    if (existing.length) await new Promise<void>((resolve) => chrome.storage!.local.remove(existing, resolve));
    await new Promise<void>((resolve) => chrome.storage!.local.set(next, resolve));
    return;
  }
  existing.forEach((k) => localStorage.removeItem(`prodli_${k}`));
  for (const [k, v] of Object.entries(next)) localStorage.setItem(`prodli_${k}`, JSON.stringify(v));
}

// ── Build / restore ───────────────────────────────────────────────────────────

export async function buildBackup(): Promise<ProdLiBackup> {
  const data: Record<string, unknown> = {};
  for (const key of DATA_KEYS) data[key] = await storageGet(key, KEY_DEFAULTS[key]);
  for (const key of SETTINGS_KEYS_V11) {
    const value = await storageGet<unknown>(key, undefined);
    if (value !== undefined) data[key] = value;
  }
  let meetings: Meeting[] = [];
  try {
    meetings = await listMeetings();
  } catch {
    // IndexedDB unavailable (e.g. private window) — back up everything else.
  }
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    timeTracking: await readTrackingDays(),
    meetings: meetings.map((m) => ({ ...m, hasAudio: false, audioMimeType: null })),
  };
}

export async function exportData(): Promise<void> {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prodli-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  ok: boolean;
  error?: string;
}

function isMeeting(v: unknown): v is Meeting {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<Meeting>;
  return typeof m.id === "string" && typeof m.title === "string" && typeof m.startedAt === "string" && Array.isArray(m.transcript);
}

/** Validates and applies a parsed backup object. */
export async function restoreBackup(parsed: unknown): Promise<ImportResult> {
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || !("data" in parsed)) {
    return { ok: false, error: "File does not look like a ProdLi backup (missing version or data fields)." };
  }
  const backup = parsed as ProdLiBackup;
  if (typeof backup.version !== "string" || !SUPPORTED_VERSIONS.includes(backup.version)) {
    return {
      ok: false,
      error: `Unsupported backup version "${backup.version ?? "unknown"}". This file may be from a newer version of ProdLi.`,
    };
  }
  if (!backup.data || typeof backup.data !== "object") {
    return { ok: false, error: "Backup data is malformed." };
  }

  // Always write every core key — use the backup value if present, otherwise
  // the default — so no stale data is left over, even for partial backups.
  await Promise.all(
    DATA_KEYS.map(async (key) => {
      const value = key in backup.data ? backup.data[key] : KEY_DEFAULTS[key];
      await storageSet(key, value);
    }),
  );

  // 1.0 backups never contained these, so leave current data alone for them.
  if (backup.version !== "1.0") {
    for (const key of SETTINGS_KEYS_V11) {
      if (key in backup.data) await storageSet(key, backup.data[key]);
    }
    if (backup.timeTracking && typeof backup.timeTracking === "object") {
      await replaceTrackingDays(backup.timeTracking);
    }
    if (Array.isArray(backup.meetings)) {
      const incoming = backup.meetings.filter(isMeeting);
      try {
        const current = await listMeetings();
        const keep = new Set(incoming.map((m) => m.id));
        await Promise.all(current.filter((m) => !keep.has(m.id)).map((m) => deleteMeeting(m.id, { tombstone: false })));
        for (const m of incoming) {
          // A restored meeting can't still be recording or summarizing.
          const status = m.status === "recording" || m.status === "processing" ? "ready" : m.status;
          await putMeeting({ ...m, status, hasAudio: false, audioMimeType: null });
        }
      } catch {
        return { ok: false, error: "Notes and settings were restored, but meetings couldn't be (browser storage unavailable)." };
      }
    }
  }
  return { ok: true };
}

export async function importData(file: File): Promise<ImportResult> {
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "File is not valid JSON." };
    }
    return await restoreBackup(parsed);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error during import.",
    };
  }
}
