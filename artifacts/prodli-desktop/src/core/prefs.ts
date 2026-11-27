// The app's own preferences (Settings › Desktop app). Not synced: they're about
// this computer. "Open at login" itself lives in the OS (login items).

import { DEFAULT_DICTATE_SHORTCUT, DICTATE_SHORTCUTS, type DictateShortcut } from "./dictation";

export interface Prefs {
  openAtLogin: boolean;
  keepRunning: boolean;
  /** Remind me to record when a call starts in another app. */
  callNudge: boolean;
  /** Keep the computer from sleeping while recording or in a focus session (menu bar timer). */
  autoKeepAwake: boolean;
  /** Dictate into any app with a global shortcut (off until turned on: it takes a shortcut from every app). */
  dictateAnywhere: boolean;
  dictateShortcut: DictateShortcut;
}

export const DEFAULT_PREFS: Prefs = { openAtLogin: false, keepRunning: true, callNudge: true, autoKeepAwake: true, dictateAnywhere: false, dictateShortcut: DEFAULT_DICTATE_SHORTCUT };

/** Only known keys with the right kind of value get through (from disk or from the page). */
export function cleanPrefs(raw: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    openAtLogin: typeof r.openAtLogin === "boolean" ? r.openAtLogin : base.openAtLogin,
    keepRunning: typeof r.keepRunning === "boolean" ? r.keepRunning : base.keepRunning,
    callNudge: typeof r.callNudge === "boolean" ? r.callNudge : base.callNudge,
    autoKeepAwake: typeof r.autoKeepAwake === "boolean" ? r.autoKeepAwake : base.autoKeepAwake,
    dictateAnywhere: typeof r.dictateAnywhere === "boolean" ? r.dictateAnywhere : base.dictateAnywhere,
    dictateShortcut: (DICTATE_SHORTCUTS as readonly unknown[]).includes(r.dictateShortcut) ? (r.dictateShortcut as DictateShortcut) : base.dictateShortcut,
  };
}
