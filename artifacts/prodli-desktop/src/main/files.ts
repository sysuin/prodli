// Delivering local files to the Files viewer (core/files.ts says which).
// Files wait in a queue until the page takes them, so a file that opens the app
// (double-click before ProdLi is running) isn't lost while the page loads.

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { filesFromArgv, isOpenablePath, MAX_FILE_BYTES, mimeFor, OPENABLE_EXTENSIONS } from "../core/files";
import { IPC } from "../core/ipc";
import { isAppUrl } from "../core/links";
import { mainWindow, showMainWindow } from "./windows";

export interface OpenedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

const queue: OpenedFile[] = [];
let problem: ((msg: string) => void) | null = null;

async function deliver(file: string): Promise<void> {
  if (!isOpenablePath(file)) return;
  try {
    const info = await stat(file);
    if (!info.isFile()) return;
    if (info.size > MAX_FILE_BYTES) {
      problem?.(`${path.basename(file)} is too large to preview (over ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`);
      return;
    }
    queue.push({ name: path.basename(file), type: mimeFor(file), bytes: new Uint8Array(await readFile(file)) });
  } catch {
    problem?.(`Couldn't open ${path.basename(file)}.`);
    return;
  }
  if (!app.isReady()) return; // the page takes it once it's up
  const w = showMainWindow();
  w.webContents.send(IPC.filesAvailable);
}

export function openFiles(paths: string[]): void {
  for (const p of paths) void deliver(p);
}

export async function openFileDialog(): Promise<void> {
  const parent = mainWindow() ?? BrowserWindow.getFocusedWindow() ?? undefined;
  const opts: Electron.OpenDialogOptions = {
    title: "Open a file in ProdLi",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Markdown, CSV, JSON, text and code", extensions: OPENABLE_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (!r.canceled) openFiles(r.filePaths.filter(isOpenablePath).slice(0, 5));
}

/** Must run before the app is ready: macOS sends "open-file" during launch. */
export function listenForOpenedFiles(): void {
  app.on("open-file", (e, file) => {
    e.preventDefault();
    void deliver(file);
  });
  openFiles(filesFromArgv(process.argv));
}

export function registerFilesIpc(onProblem: (msg: string) => void): void {
  problem = onProblem;
  ipcMain.handle(IPC.filesTake, (e) => (isAppUrl(e.senderFrame?.url ?? "") ? queue.splice(0) : []));
  ipcMain.handle(IPC.filesOpenDialog, (e) => (isAppUrl(e.senderFrame?.url ?? "") ? openFileDialog() : undefined));
}

export { filesFromArgv };
