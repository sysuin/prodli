// The app's data store (core/fileStore.ts) wired to Electron: the file lives in
// the user's app-data folder, secrets are encrypted with the OS keychain
// (Keychain on Mac, DPAPI on Windows), and every change reaches every window.

import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "node:path";
import { FileStore, type StoreCrypto } from "../core/fileStore";
import { IPC, SECRET_KEYS } from "../core/ipc";
import { isAppUrl } from "../core/links";

let store: FileStore | null = null;

const keychain: StoreCrypto = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString("base64"),
  decrypt: async (b64) => (await safeStorage.decryptStringAsync(Buffer.from(b64, "base64"))).result,
};

export function getStore(): FileStore {
  if (!store) throw new Error("store not open");
  return store;
}

/** The store if it's open already (windows can open before it is). */
export const storeIfReady = (): FileStore | null => store;

const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Only the app's own pages may use the store (not a page that somehow got navigated elsewhere). */
const fromApp = (e: Electron.IpcMainInvokeEvent) => isAppUrl(e.senderFrame?.url ?? "");

/**
 * Opens the store. The IPC handlers are registered first and wait for it, so
 * the window can show straight away even if macOS asks for Keychain access.
 */
export function openStore(): Promise<FileStore> {
  const ready = FileStore.open(path.join(app.getPath("userData"), "ProdLi Data", "store.json"), { secretKeys: SECRET_KEYS, crypto: keychain }).then((s) => {
    store = s;
    s.onChange((changes) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.storageChanged, changes);
    });
    return s;
  });

  ipcMain.handle(IPC.storageGet, async (e, key: unknown) => (fromApp(e) && typeof key === "string" ? (await ready).get(key) : undefined));
  ipcMain.handle(IPC.storageGetAll, async (e) => (fromApp(e) ? (await ready).getAll() : {}));
  ipcMain.handle(IPC.storageSet, async (e, key: unknown, value: unknown) => {
    if (!fromApp(e) || typeof key !== "string" || !KEY.test(key)) throw new Error("Couldn't save");
    (await ready).set(key, value);
  });
  ipcMain.handle(IPC.storageRemove, async (e, key: unknown) => {
    if (fromApp(e) && typeof key === "string") (await ready).remove(key);
  });
  return ready;
}

/** Called on quit: write anything pending, synchronously. */
export function closeStore(): void {
  try {
    store?.flushSync();
  } catch (err) {
    console.error("ProdLi: couldn't save on quit", err);
  }
}
