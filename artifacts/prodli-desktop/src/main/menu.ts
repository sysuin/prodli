// Menu bar / window menu, tray icon, dock menu and the global Quick add shortcut.

import { app, globalShortcut, Menu, nativeImage, shell, Tray } from "electron";
import { appMenuTemplate, dockMenuTemplate, QUICK_ADD_SHORTCUT, trayMenuTemplate, type MenuActions } from "../core/menu";
import { isExternalLink } from "../core/links";
import { IS_DEV, resourcePath } from "./config";
import { sendCommand, showMainWindow, showQuickAdd } from "./windows";
import { openFileDialog } from "./files";
import { checkForUpdatesNow, restartToUpdate, updatesEnabled, updateState } from "./updates";

let tray: Tray | null = null;
let recording = false;

export const actions: MenuActions = {
  command: sendCommand,
  quickAdd: showQuickAdd,
  recordCall: () => sendCommand("record-call"),
  openFile: () => void openFileDialog(),
  openWindow: () => void showMainWindow(),
  openExternal: (url) => void (isExternalLink(url) && shell.openExternal(url)),
  quit: () => app.quit(), // before-quit (index.ts) asks first if a recording is running
};

function trayIcon(): Electron.NativeImage {
  if (process.platform === "darwin") {
    // A template image: macOS tints it for light / dark menu bars.
    const img = nativeImage.createFromPath(resourcePath("trayTemplate.png"));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(resourcePath(process.platform === "win32" ? "tray.ico" : "tray.png"));
}

/** Menus show "Check for Updates…" / "Restart to Update" (main/updates.ts). */
function withUpdates(): MenuActions {
  const st = updateState();
  return {
    ...actions,
    checkForUpdates: updatesEnabled() ? checkForUpdatesNow : undefined,
    restartToUpdate: st.kind === "ready" ? { version: st.version, run: restartToUpdate } : undefined,
  };
}

export function refreshMenus(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform, withUpdates(), { dev: IS_DEV })));
  refreshTray();
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(withUpdates(), { recording })));
  tray.setToolTip(recording ? "ProdLi — recording" : "ProdLi");
}

export function setUpMenus(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform, withUpdates(), { dev: IS_DEV })));
  if (process.platform === "darwin") app.dock?.setMenu(Menu.buildFromTemplate(dockMenuTemplate(actions)));

  tray = new Tray(trayIcon());
  refreshTray();
  // Windows: a click on the tray icon opens ProdLi (the menu is on right-click).
  if (process.platform === "win32") tray.on("click", () => void showMainWindow());

  if (!globalShortcut.register(QUICK_ADD_SHORTCUT, showQuickAdd)) console.warn(`ProdLi: ${QUICK_ADD_SHORTCUT} is taken by another app`);
}

export function setRecording(on: boolean): void {
  recording = on;
  refreshTray();
  if (process.platform === "darwin") app.dock?.setBadge(on ? "●" : "");
}

export const isRecording = () => recording;

export function tearDownMenus(): void {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
}
