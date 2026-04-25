import { storageGet, storageSet } from "./storage";
import { DEFAULT_POMODORO_SETTINGS } from "./usePomodoroTimer";

const BACKUP_VERSION = "1.0";
const SUPPORTED_VERSIONS = ["1.0"];

const DATA_KEYS = [
  "notes",
  "activeNoteId",
  "editorFont",
  "todos",
  "habits",
  "pomodoroSettings",
  "pomodoroSessions",
  "completedPomodoros",
  "theme",
] as const;

type DataKey = typeof DATA_KEYS[number];

const KEY_DEFAULTS: Record<DataKey, unknown> = {
  notes: [],
  activeNoteId: null,
  editorFont: "system",
  todos: [],
  habits: [],
  pomodoroSettings: DEFAULT_POMODORO_SETTINGS,
  pomodoroSessions: [],
  completedPomodoros: 0,
  theme: "light",
};

export interface ProdLiBackup {
  version: string;
  exportedAt: string;
  data: Record<string, unknown>;
}

export async function exportData(): Promise<void> {
  const values = await Promise.all(
    DATA_KEYS.map(async (key) => {
      return [key, await storageGet(key, KEY_DEFAULTS[key])] as const;
    })
  );

  const data: Record<string, unknown> = {};
  for (const [key, value] of values) {
    data[key] = value;
  }

  const backup: ProdLiBackup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };

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

export async function importData(file: File): Promise<ImportResult> {
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "File is not valid JSON." };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("data" in parsed)
    ) {
      return {
        ok: false,
        error: "File does not look like a ProdLi backup (missing version or data fields).",
      };
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

    // Always write every key — use the backup value if present, otherwise the
    // known default. This guarantees a full, clean restore with no stale data
    // left over from the previous state, even for partial or older backups.
    await Promise.all(
      DATA_KEYS.map(async (key) => {
        const value = key in backup.data ? backup.data[key] : KEY_DEFAULTS[key];
        await storageSet(key, value);
      })
    );

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error during import.",
    };
  }
}
