// Automatic updates (electron-updater, "generic" feed: latest.yml / latest-mac.yml
// next to the installers, e.g. on Cloudflare R2). Off unless the build was made
// with PRODLI_UPDATE_URL, and only in packaged apps. macOS only installs updates
// for signed apps, so this goes live together with signing (docs/DESKTOP.md).
//
// Updates download in the background and install when ProdLi quits; the menu
// and a notification offer "Restart to Update" sooner.

import { app, dialog, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { UPDATE_URL } from "./config";

type State = { kind: "idle" } | { kind: "checking" } | { kind: "downloading"; version: string } | { kind: "ready"; version: string } | { kind: "error"; message: string };

let state: State = { kind: "idle" };
let onChange: () => void = () => {};
let manual = false;

export const updatesEnabled = () => app.isPackaged && !!UPDATE_URL;
export const updateState = () => state;

function set(next: State): void {
  state = next;
  onChange();
}

export function startUpdates(changed: () => void): void {
  onChange = changed;
  if (!updatesEnabled()) return;
  autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => set({ kind: "checking" }));
  autoUpdater.on("update-available", (info) => set({ kind: "downloading", version: info.version }));
  autoUpdater.on("update-not-available", () => {
    set({ kind: "idle" });
    if (manual) void dialog.showMessageBox({ type: "info", message: "ProdLi is up to date", detail: `You have the latest version (${app.getVersion()}).` });
    manual = false;
  });
  autoUpdater.on("update-downloaded", (info) => {
    set({ kind: "ready", version: info.version });
    manual = false;
    if (Notification.isSupported()) {
      const n = new Notification({ title: `ProdLi ${info.version} is ready`, body: "Restart ProdLi to update, or it updates the next time you quit." });
      n.on("click", () => restartToUpdate());
      n.show();
    }
  });
  autoUpdater.on("error", (err) => {
    set({ kind: "error", message: err?.message ?? "Update failed" });
    if (manual) void dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: "Check your connection and try again later." });
    manual = false;
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 30_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

/** Help / ProdLi menu → Check for Updates… */
export function checkForUpdatesNow(): void {
  if (!updatesEnabled()) return;
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => {});
}

export function restartToUpdate(): void {
  if (state.kind !== "ready") return;
  // quitAndInstall quits; index.ts's before-quit still asks during a recording.
  setImmediate(() => autoUpdater.quitAndInstall());
}
