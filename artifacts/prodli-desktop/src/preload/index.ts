// The bridge between ProdLi's pages and the app (window.prodliDesktop). The page
// gets exactly these functions — no Node, no Electron, no raw IPC. The shape is
// DesktopBridge in artifacts/prodli/src/lib/desktop.ts.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC } from "../core/ipc";
import type { DesktopBridge, StorageChange } from "../../../prodli/src/lib/desktop";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const theme = arg("prodli-theme");

const listen = <T>(channel: string, cb: (value: T) => void) => {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
};

const bridge: DesktopBridge = {
  platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux",
  version: arg("prodli-version"),
  initialTheme: theme === "dark" || theme === "light" ? theme : null,
  storage: {
    get: (key) => ipcRenderer.invoke(IPC.storageGet, key),
    getAll: () => ipcRenderer.invoke(IPC.storageGetAll),
    set: (key, value) => ipcRenderer.invoke(IPC.storageSet, key, value),
    remove: (key) => ipcRenderer.invoke(IPC.storageRemove, key),
    onChanged: (cb) => listen<StorageChange[]>(IPC.storageChanged, cb),
  },
  account: {
    signIn: () => ipcRenderer.invoke(IPC.signIn),
    cancelSignIn: () => ipcRenderer.invoke(IPC.cancelSignIn),
  },
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch) => ipcRenderer.invoke(IPC.prefsSet, patch),
  },
  files: {
    take: () => ipcRenderer.invoke(IPC.filesTake),
    onAvailable: (cb) => listen<void>(IPC.filesAvailable, () => cb()),
    openDialog: () => ipcRenderer.invoke(IPC.filesOpenDialog),
  },
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  systemAudio: () => ipcRenderer.invoke(IPC.systemAudio),
  openSystemAudioSettings: () => ipcRenderer.invoke(IPC.openSystemAudioSettings),
  closeWindow: () => ipcRenderer.send(IPC.closeWindow),
  onCommand: (cb) => listen<string>(IPC.command, cb),
  setBadge: (text) => ipcRenderer.send(IPC.setBadge, String(text ?? "")),
  setRecording: (recording) => ipcRenderer.send(IPC.recordingState, !!recording),
};

contextBridge.exposeInMainWorld("prodliDesktop", bridge);
