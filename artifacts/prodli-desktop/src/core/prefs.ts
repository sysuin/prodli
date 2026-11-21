// The app's own preferences (Settings › Desktop app). Not synced: they're about
// this computer. "Open at login" itself lives in the OS (login items).

export interface Prefs {
  openAtLogin: boolean;
  keepRunning: boolean;
}

export const DEFAULT_PREFS: Prefs = { openAtLogin: false, keepRunning: true };

/** Only known keys with boolean values get through (from disk or from the page). */
export function cleanPrefs(raw: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    openAtLogin: typeof r.openAtLogin === "boolean" ? r.openAtLogin : base.openAtLogin,
    keepRunning: typeof r.keepRunning === "boolean" ? r.keepRunning : base.keepRunning,
  };
}
