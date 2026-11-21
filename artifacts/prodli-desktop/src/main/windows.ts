// The main window and the Quick add window.
//
// Closing the main window hides it (ProdLi keeps running in the menu bar /
// tray) so Pomodoro, reminders, sync and recordings carry on; Quit really quits.

import { app, BrowserWindow, nativeTheme, Notification, screen, shell, type BrowserWindowConstructorOptions } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_ORIGIN } from "../core/assets";
import { IPC } from "../core/ipc";
import { isAppUrl, isExternalLink } from "../core/links";
import { MIN_SIZE, restoreBounds, type WindowState } from "../core/windowState";
import { IS_DEV, preloadPath, resourcePath } from "./config";
import { getStore, storeIfReady } from "./store";
import { getPrefs, startedHidden } from "./prefs";

let main: BrowserWindow | null = null;
let quick: BrowserWindow | null = null;
let quitting = false;

export const setQuitting = () => void (quitting = true);
export const isQuitting = () => quitting;
export const mainWindow = () => (main && !main.isDestroyed() ? main : null);

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
function readState(): WindowState | null {
  try {
    return existsSync(stateFile()) ? (JSON.parse(readFileSync(stateFile(), "utf8")) as WindowState) : null;
  } catch {
    return null;
  }
}
function saveState(w: BrowserWindow): void {
  try {
    const maximized = w.isMaximized() || w.isFullScreen();
    const b = maximized ? w.getNormalBounds() : w.getBounds();
    writeFileSync(stateFile(), JSON.stringify({ ...b, maximized } satisfies WindowState));
  } catch {
    // not important
  }
}

function savedTheme(): "light" | "dark" | null {
  const t = storeIfReady()?.get("theme");
  return t === "dark" || t === "light" ? t : null;
}

function webPreferences(): BrowserWindowConstructorOptions["webPreferences"] {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: true,
    devTools: IS_DEV,
    additionalArguments: [`--prodli-theme=${savedTheme() ?? ""}`, `--prodli-version=${app.getVersion()}`],
  };
}

/** Links open in the default browser; the window itself never leaves the app. */
function lockDown(w: BrowserWindow): void {
  const wc = w.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (isExternalLink(url)) void shell.openExternal(url);
  });
  wc.on("will-redirect", (e, url) => !isAppUrl(url) && e.preventDefault());
  wc.on("will-attach-webview", (e) => e.preventDefault());
  // A page's "leave this page?" (e.g. during a recording) would silently block
  // quitting; the app asks about recordings itself before quitting (index.ts).
  wc.on("will-prevent-unload", (e) => e.preventDefault());
}

const background = () => (savedTheme() === "dark" || (savedTheme() === null && nativeTheme.shouldUseDarkColors) ? "#121212" : "#F0E6D2");

export function createMainWindow(): BrowserWindow {
  const saved = readState();
  const primary = screen.getPrimaryDisplay();
  const bounds = restoreBounds(saved, [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)]);
  const w = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: "ProdLi",
    show: false,
    backgroundColor: background(),
    icon: process.platform === "darwin" ? undefined : resourcePath("icon.png"),
    autoHideMenuBar: false,
    webPreferences: { ...webPreferences(), backgroundThrottling: false },
  });
  main = w;
  lockDown(w);
  if (saved?.maximized) w.maximize();
  w.once("ready-to-show", () => {
    if (!startedHidden()) w.show();
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(w), 500);
  };
  w.on("resize", queueSave);
  w.on("move", queueSave);
  w.on("close", (e) => {
    saveState(w);
    if (quitting) return;
    if (!getPrefs().keepRunning) {
      // Settings › Desktop app: closing the window quits (index.ts asks first during a recording).
      e.preventDefault();
      app.quit();
      return;
    }
    // Keep running in the background (menu bar / tray): timers, reminders, sync, recordings.
    e.preventDefault();
    if (w.isFullScreen()) {
      w.once("leave-full-screen", () => w.hide());
      w.setFullScreen(false);
    } else w.hide();
    // Windows has no dock: say once where ProdLi went.
    if (process.platform === "win32" && storeIfReady() && !getStore().get("desktopTrayHintShown") && Notification.isSupported()) {
      getStore().set("desktopTrayHintShown", true);
      new Notification({ title: "ProdLi is still running", body: "Timers, reminders and recordings keep going. Open ProdLi from the icon in the taskbar's notification area, or quit it there." }).show();
    }
  });
  w.on("closed", () => {
    if (main === w) main = null;
  });
  void w.loadURL(`${APP_ORIGIN}/`);
  return w;
}

export function showMainWindow(): BrowserWindow {
  const w = mainWindow() ?? createMainWindow();
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
  return w;
}

/** Sends a menu / tray command to the page (prodli/src/lib/desktopCommands.ts). */
export function sendCommand(cmd: string): void {
  const w = showMainWindow();
  const send = () => w.webContents.send(IPC.command, cmd);
  if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => setTimeout(send, 300));
  else send();
}

/** A small window for adding a to-do or note from anywhere (Alt+Shift+A). */
export function showQuickAdd(): void {
  if (quick && !quick.isDestroyed()) {
    void quick.loadURL(`${APP_ORIGIN}/#quick-add`); // fresh form each time
    quick.show();
    quick.focus();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = 560;
  const height = 520;
  const w = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + display.height * 0.18),
    title: "Quick Add — ProdLi",
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: background(),
    icon: process.platform === "darwin" ? undefined : resourcePath("icon.png"),
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  quick = w;
  lockDown(w);
  w.setMenuBarVisibility(false);
  w.once("ready-to-show", () => {
    w.show();
    w.focus();
  });
  w.on("blur", () => !IS_DEV && w.hide());
  w.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
  });
  w.on("closed", () => {
    if (quick === w) quick = null;
  });
  void w.loadURL(`${APP_ORIGIN}/#quick-add`);
}

export function closeSenderWindow(sender: Electron.WebContents): void {
  BrowserWindow.fromWebContents(sender)?.close();
}
