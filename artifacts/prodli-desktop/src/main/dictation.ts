// Dictation into any app (Settings › Desktop app › Dictate into any app; core/dictation.ts).
//
// The shortcut is registered only while the setting is on. Pressing it in
// another app shows the pill window (#dictate-pill, never focused, so the app
// keeps its cursor); the pill records, transcribes and cleans up the text, then
// asks for it to be pasted: the text goes on the clipboard, ⌘V / Ctrl+V is
// pressed in the app in front, and the clipboard is put back. In ProdLi's own
// windows the shortcut starts the in-app dictation instead (WebDictation),
// which knows the text box and what's before the cursor.

import { BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, screen, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { APP_ORIGIN } from "../core/assets";
import { cleanAppName, encodePowerShell, MAC_FRONT_APP_SCRIPT } from "../core/appUsage";
import { pasteCommand, pillBounds, WINDOWS_FRONT_APP_ONCE, type PasteResult, type PillControl } from "../core/dictation";
import { IPC } from "../core/ipc";
import { isAppUrl } from "../core/links";
import { IS_DEV } from "./config";
import { getPrefs, onPrefsChange } from "./prefs";
import { lockDown, webPreferences } from "./windows";

let pill: BrowserWindow | null = null;
let ready = false;
let queued: PillControl[] = [];
let listening = false;
let registered: string | null = null;
let shortcutTaken = false;
let escape = false;

/** Development builds only (tests/e2e.mjs): pastes are written here instead of pressing ⌘V. */
const fakePasteFile = () => (IS_DEV ? process.env.PRODLI_E2E_PASTE_FILE || "" : "");
const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent) => isAppUrl(e.senderFrame?.url ?? "");

function send(c: PillControl): void {
  const w = pill && !pill.isDestroyed() ? pill : null;
  if (w && ready) w.webContents.send(IPC.dictationControl, c);
  else queued.push(c);
}

function ensurePill(): BrowserWindow {
  if (pill && !pill.isDestroyed()) return pill;
  ready = false;
  const w = new BrowserWindow({
    ...pillBounds(screen.getPrimaryDisplay().workArea),
    title: "ProdLi Dictation",
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Never takes the focus: the app you're typing in keeps its cursor.
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: { ...webPreferences(), backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDown(w);
  // A crashed pill is made again on the next press.
  w.webContents.on("render-process-gone", () => !w.isDestroyed() && w.destroy());
  w.on("closed", () => {
    if (pill === w) {
      pill = null;
      ready = false;
      listening = false;
      setEscape(false);
    }
  });
  pill = w;
  void w.loadURL(`${APP_ORIGIN}/#dictate-pill`);
  return w;
}

/** Esc cancels, but only while listening (it's every app's key otherwise). */
function setEscape(on: boolean): void {
  if (on === escape) return;
  escape = on;
  if (on) {
    if (!globalShortcut.register("Escape", cancel)) escape = false;
  } else globalShortcut.unregister("Escape");
}

/** The app in front (its name, for the style), or "" if it can't be told. */
function frontApp(): Promise<string> {
  return new Promise((resolve) => {
    const done = (err: Error | null, out: string) => resolve(err ? "" : (cleanAppName(String(out)) ?? ""));
    if (process.platform === "darwin") execFile("osascript", ["-l", "JavaScript", "-e", MAC_FRONT_APP_SCRIPT], { timeout: 3000 }, done);
    else if (process.platform === "win32") execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(WINDOWS_FRONT_APP_ONCE)], { timeout: 5000, windowsHide: true }, done);
    else resolve("");
  });
}

export function toggleDictation(): void {
  if (listening) return finish();
  // In ProdLi itself, the in-app dictation types into the text box you're in.
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused !== pill && isAppUrl(focused.webContents.getURL())) {
    focused.webContents.send(IPC.command, "dictate");
    return;
  }
  listening = true;
  const w = ensurePill();
  w.setBounds(pillBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
  w.showInactive();
  setEscape(true);
  // Start listening at once; the app's name follows (it can take a moment on Windows).
  send({ type: "start", app: "" });
  void frontApp().then((app) => app && send({ type: "app", app }));
}

function finish(): void {
  if (!listening) return;
  listening = false;
  setEscape(false);
  send({ type: "finish" });
}

function cancel(): void {
  if (!listening) return;
  listening = false;
  setEscape(false);
  send({ type: "cancel" });
}

/** Everything on the clipboard (text, rich text, images…), read before the text replaces it. */
type ClipboardSnapshot = Record<string, Blob | string | Electron.ClipboardBookmark>[];
async function snapshot(): Promise<ClipboardSnapshot> {
  try {
    const items = await clipboard.read();
    return await Promise.all(items.map(async (it) => Object.fromEntries(await Promise.all(it.types.map(async (t) => [t, await it.getType(t)] as const)))));
  } catch {
    return [];
  }
}
async function restore(s: ClipboardSnapshot): Promise<void> {
  try {
    if (!s.length) clipboard.clear();
    else await clipboard.write(s.map((item) => new ClipboardItem(item)));
  } catch {
    // the dictated text stays on the clipboard
  }
}

/** macOS needs Accessibility to press ⌘V in another app. */
const canPaste = () => process.platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false);

async function paste(text: string): Promise<PasteResult> {
  const saved = await snapshot();
  await clipboard.writeText(text);
  const putBack = (ms: number) =>
    setTimeout(async () => {
      // Only if nothing else was copied meanwhile.
      if ((await clipboard.readText().catch(() => "")) === text) await restore(saved);
    }, ms);
  const fake = fakePasteFile();
  if (fake) {
    appendFileSync(fake, `${JSON.stringify({ text, clipboard: await clipboard.readText() })}\n`);
    putBack(300);
    return { method: "typed" };
  }
  if (!canPaste()) return { method: "copied", reason: "permission" };
  const cmd = pasteCommand(process.platform);
  if (!cmd) return { method: "copied", reason: "unsupported" };
  // The key up of the shortcut may still be on its way; let it land first.
  await new Promise((r) => setTimeout(r, 120));
  const ok = await new Promise<boolean>((resolve) => execFile(cmd.file, cmd.args, { timeout: 5000, windowsHide: true }, (err) => resolve(!err)));
  if (!ok) return { method: "copied", reason: process.platform === "linux" ? "unsupported" : "failed" };
  putBack(900);
  return { method: "typed" };
}

function applyPrefs(): void {
  const p = getPrefs();
  const want = p.dictateAnywhere ? p.dictateShortcut : null;
  if (want === registered) return;
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  shortcutTaken = false;
  if (want) {
    if (globalShortcut.register(want, toggleDictation)) registered = want;
    else shortcutTaken = true;
    ensurePill(); // loaded ahead, so the microphone starts at once
  } else if (pill && !pill.isDestroyed() && !listening) pill.destroy();
}

export function startDictation(): void {
  ipcMain.on(IPC.dictationReady, (e) => {
    if (!fromApp(e) || !pill || e.sender !== pill.webContents) return;
    ready = true;
    const q = queued;
    queued = [];
    q.forEach(send);
  });
  ipcMain.handle(IPC.dictationPaste, (e, text: unknown) => (fromApp(e) && pill && e.sender === pill.webContents && typeof text === "string" && text ? paste(text.slice(0, 20_000)) : { method: "copied", reason: "failed" }));
  ipcMain.on(IPC.dictationDone, (e) => {
    if (pill && e.sender === pill.webContents && !listening) pill.hide();
  });
  ipcMain.on(IPC.dictationFinish, (e) => pill && e.sender === pill.webContents && finish());
  ipcMain.on(IPC.dictationCancel, (e) => pill && e.sender === pill.webContents && cancel());
  ipcMain.handle(IPC.dictationStatus, (e) => (fromApp(e) ? { canPaste: canPaste(), shortcutTaken } : null));
  ipcMain.handle(IPC.dictationAskToPaste, (e) => (fromApp(e) && process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(true) : true));
  applyPrefs();
  onPrefsChange(applyPrefs);
  // tests/e2e.mjs presses the shortcut with a signal (no real keyboard there).
  if (fakePasteFile() && process.platform !== "win32") {
    process.on("SIGUSR2", toggleDictation);
    writeFileSync(`${fakePasteFile()}.pid`, String(process.pid));
  }
}
