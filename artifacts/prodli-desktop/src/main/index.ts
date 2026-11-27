// ProdLi for Mac and Windows — the app's main process.
//
// The pages are ProdLi's own React app (artifacts/prodli, built with
// vite.desktop.config.ts) served from app://prodli/. This process owns the
// computer-facing parts: data on disk, sign-in through the browser, windows,
// menus and tray, the Quick add shortcut, and call audio for recordings.

import { app, dialog, ipcMain, shell } from "electron";
import { IPC } from "../core/ipc";
import { isAppUrl, isExternalLink } from "../core/links";
import { registerAuthIpc } from "./auth";
import { registerPrefsIpc } from "./prefs";
import { filesFromArgv, listenForOpenedFiles, openFiles, registerFilesIpc } from "./files";
import { IS_DEV } from "./config";
import { enableSystemAudioSwitches, setUpMedia } from "./media";
import { isRecording, refreshMenus, refreshTray, setRecording, setTrayTitle, setUpMenus, tearDownMenus } from "./menu";
import { startMenuBar, stopMenuBar } from "./menuBar";
import { startUpdates } from "./updates";
import { startCallNudges } from "./callNudge";
import { startDictation } from "./dictation";
import { startAppTracking, stopAppTracking } from "./appTracker";
import { sendCommand } from "./windows";
import { registerAppScheme, serveApp } from "./protocol";
import { closeStore, openStore } from "./store";
import { closeSenderWindow, createMainWindow, isQuitting, setQuitting, showMainWindow } from "./windows";

app.setName("ProdLi");
// Development builds only: a throwaway data folder for tests (tests/e2e.mjs).
if (IS_DEV && process.env.PRODLI_USER_DATA) app.setPath("userData", process.env.PRODLI_USER_DATA);
if (process.platform === "win32") app.setAppUserModelId("com.prodli.desktop");

// One ProdLi at a time: a second launch just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch (e.g. "Open With → ProdLi" on Windows) brings this one forward with its files.
  app.on("second-instance", (_e, argv) => {
    showMainWindow();
    openFiles(filesFromArgv(argv));
  });
  listenForOpenedFiles();

  registerAppScheme();
  enableSystemAudioSwitches();

  app.whenReady().then(async () => {
    const opening = openStore();
    serveApp();
    setUpMedia();
    registerAuthIpc();
    registerPrefsIpc();
    registerFilesIpc((msg) => void dialog.showMessageBox({ type: "info", message: msg }));

    ipcMain.handle(IPC.openExternal, (_e, url: unknown) => (typeof url === "string" && isExternalLink(url) ? shell.openExternal(url) : undefined));
    ipcMain.on(IPC.closeWindow, (e) => isAppUrl(e.senderFrame?.url ?? "") && closeSenderWindow(e.sender));
    ipcMain.on(IPC.setBadge, (_e, text: unknown) => {
      if (process.platform === "darwin") app.dock?.setBadge(typeof text === "string" ? text.slice(0, 8) : "");
      else if (typeof text === "string") app.setBadgeCount(/^\d+$/.test(text) ? Number(text) : 0);
    });
    ipcMain.on(IPC.recordingState, (_e, on: unknown) => setRecording(on === true));

    createMainWindow();
    setUpMenus();
    startUpdates(refreshMenus);
    startCallNudges({ isRecording, record: () => sendCommand("record-call") });
    startDictation();

    const store = await opening;
    startAppTracking(store);
    startMenuBar(store, { setTitle: setTrayTitle, rebuildMenu: refreshTray });
    if (store.recovered) {
      void dialog.showMessageBox({
        type: "warning",
        message: "ProdLi's data file was damaged",
        detail: store.recovered === "backup" ? "ProdLi restored the last good copy. If you're signed in, sync brings back anything newer." : "ProdLi started fresh. If you're signed in, sync brings your data back. The damaged file was kept in ProdLi's data folder.",
      });
    }

    // macOS: clicking the dock icon with no window open shows it again.
    app.on("activate", () => void showMainWindow());
  });

  // Quitting during a recording would cut it short: ask first.
  app.on("before-quit", (e) => {
    if (isRecording() && !isQuitting()) {
      const choice = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["Keep Recording", "Quit Anyway"],
        defaultId: 0,
        cancelId: 0,
        message: "A recording is in progress",
        detail: "Quitting now keeps what was recorded so far, but stops the recording.",
      });
      if (choice === 0) {
        e.preventDefault();
        return;
      }
    }
    setQuitting();
  });

  // Keep running in the menu bar / tray when windows are closed (see windows.ts).
  app.on("window-all-closed", () => {
    if (isQuitting()) app.quit();
  });

  app.on("will-quit", () => {
    stopAppTracking();
    stopMenuBar();
    tearDownMenus();
    closeStore();
  });

  // Never let a page create unexpected windows or webviews, whatever happens.
  app.on("web-contents-created", (_e, wc) => {
    wc.on("will-attach-webview", (ev) => ev.preventDefault());
  });

  if (IS_DEV) process.on("unhandledRejection", (err) => console.error("ProdLi main:", err));
}
