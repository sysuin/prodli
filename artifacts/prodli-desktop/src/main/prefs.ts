// Settings › Desktop app: open at login (an OS login item) and whether closing
// the window keeps ProdLi running. Kept in desktop-prefs.json in the app-data folder.

import { app, ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IPC } from "../core/ipc";
import { isAppUrl } from "../core/links";
import { cleanPrefs, type Prefs } from "../core/prefs";

const file = () => path.join(app.getPath("userData"), "desktop-prefs.json");
let cached: Prefs | null = null;

function load(): Prefs {
  let saved: unknown = null;
  try {
    if (existsSync(file())) saved = JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    saved = null;
  }
  const p = cleanPrefs(saved);
  // The OS is the truth for login items (the user may change them in System Settings).
  if (app.isPackaged) p.openAtLogin = app.getLoginItemSettings().openAtLogin;
  return p;
}

export function getPrefs(): Prefs {
  return (cached ??= load());
}

function setPrefs(patch: unknown): Prefs {
  const next = cleanPrefs(patch, getPrefs());
  if (next.openAtLogin !== getPrefs().openAtLogin && app.isPackaged) {
    // Windows passes --hidden so a login start stays in the tray; macOS reports wasOpenedAtLogin.
    app.setLoginItemSettings({ openAtLogin: next.openAtLogin, args: ["--hidden"] });
  }
  cached = next;
  try {
    writeFileSync(file(), JSON.stringify(next));
  } catch {
    // not important
  }
  return next;
}

/** Started by a login item: stay in the menu bar / tray instead of showing the window. */
export function startedHidden(): boolean {
  if (process.argv.includes("--hidden")) return true;
  return process.platform === "darwin" && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

export function registerPrefsIpc(): void {
  ipcMain.handle(IPC.prefsGet, (e) => (isAppUrl(e.senderFrame?.url ?? "") ? getPrefs() : null));
  ipcMain.handle(IPC.prefsSet, (e, patch: unknown) => (isAppUrl(e.senderFrame?.url ?? "") ? setPrefs(patch) : getPrefs()));
}
