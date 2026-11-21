// The menu bar (Mac) / window menu (Windows), and the tray / dock menu.
// Built as plain data so it can be tested; main/menu.ts turns it into a Menu.
//
// Section shortcuts (⌘/Ctrl+0…8) and ⌘/Ctrl+K are handled by the page itself
// (it knows when you're typing in a note), so the menu shows them without
// registering them (`registerAccelerator: false`).

import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  /** Sends a command to the main window (prodli/src/lib/desktopCommands.ts). */
  command(cmd: string): void;
  quickAdd(): void;
  recordCall(): void;
  openWindow(): void;
  openExternal(url: string): void;
  checkForUpdates?(): void;
  quit(): void;
}

export const QUICK_ADD_SHORTCUT = "Alt+Shift+A";

const SECTIONS: [key: string, label: string, shortcut: string][] = [
  ["today", "Today", "0"],
  ["editor", "Notes", "1"],
  ["todos", "To-Dos", "2"],
  ["pomodoro", "Pomodoro", "3"],
  ["habits", "Habits", "4"],
  ["tracker", "Time Tracker", "5"],
  ["meetings", "Meetings", "6"],
  ["files", "Files", "7"],
  ["review", "Review", "8"],
];

const shown = (accelerator: string): Partial<MenuItemConstructorOptions> => ({ accelerator, registerAccelerator: false });

export function appMenuTemplate(platform: NodeJS.Platform, a: MenuActions, opts: { dev?: boolean } = {}): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  const go = (cmd: string) => () => a.command(cmd);

  const settings: MenuItemConstructorOptions = { label: mac ? "Settings…" : "Settings", accelerator: "CmdOrCtrl+,", click: go("settings") };
  const updates: MenuItemConstructorOptions[] = a.checkForUpdates ? [{ label: "Check for Updates…", click: () => a.checkForUpdates!() }] : [];

  const appMenu: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: "ProdLi",
          submenu: [
            { role: "about", label: "About ProdLi" },
            ...updates,
            { type: "separator" },
            settings,
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide", label: "Hide ProdLi" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { label: "Quit ProdLi", accelerator: "Cmd+Q", click: () => a.quit() },
          ],
        },
      ]
    : [];

  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { label: "Quick Add…", accelerator: QUICK_ADD_SHORTCUT, click: () => a.quickAdd() },
      { label: "Today's Daily Note", click: go("daily-note") },
      { label: "Record a Call or Meeting", click: () => a.recordCall() },
      { type: "separator" },
      { label: "Search and Commands…", ...shown("CmdOrCtrl+K"), click: go("search") },
      { label: "Ask ProdLi…", click: go("ask") },
      { type: "separator" },
      ...(mac ? [{ role: "close" } as MenuItemConstructorOptions] : [settings, { type: "separator" } as MenuItemConstructorOptions, { label: "Exit", accelerator: "Alt+F4", click: () => a.quit() }]),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
      ...(mac ? ([{ type: "separator" }, { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] }] as MenuItemConstructorOptions[]) : []),
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      ...(opts.dev ? ([{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[]) : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const goMenu: MenuItemConstructorOptions = {
    label: "Go",
    submenu: SECTIONS.map(([key, label, shortcut]) => ({ label, ...shown(`CmdOrCtrl+${shortcut}`), click: go(`go:${key}`) })),
  };

  const windowMenu: MenuItemConstructorOptions = mac
    ? { role: "windowMenu" }
    : { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] };

  const help: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      { label: "Help and Shortcuts", ...shown("?"), click: go("settings:help") },
      { type: "separator" },
      { label: "ProdLi Website", click: () => a.openExternal("https://prodli.com") },
      { label: "Privacy Policy", click: () => a.openExternal("https://prodli.com/privacy") },
      { label: "Contact Support", click: () => a.openExternal("mailto:support@prodli.com") },
      ...(!mac ? ([{ type: "separator" }, ...updates, { label: "About ProdLi", click: go("settings:about") }] as MenuItemConstructorOptions[]) : []),
    ],
  };

  return [...appMenu, file, edit, view, goMenu, windowMenu, help];
}

/** The tray (Windows) / menu bar icon (Mac) menu, and the Mac dock menu. */
export function trayMenuTemplate(a: MenuActions, state: { recording: boolean }): MenuItemConstructorOptions[] {
  return [
    { label: "Open ProdLi", click: () => a.openWindow() },
    { label: "Quick Add…", accelerator: QUICK_ADD_SHORTCUT, click: () => a.quickAdd() },
    { label: state.recording ? "Recording… (open Meetings)" : "Record a Call or Meeting", click: () => (state.recording ? a.command("go:meetings") : a.recordCall()) },
    { type: "separator" },
    { label: "Today", click: () => a.command("go:today") },
    { label: "To-Dos", click: () => a.command("go:todos") },
    { label: "Notes", click: () => a.command("go:editor") },
    { label: "Pomodoro", click: () => a.command("go:pomodoro") },
    { type: "separator" },
    { label: "Quit ProdLi", click: () => a.quit() },
  ];
}

export function dockMenuTemplate(a: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: "Quick Add…", click: () => a.quickAdd() },
    { label: "Record a Call or Meeting", click: () => a.recordCall() },
    { label: "Today", click: () => a.command("go:today") },
  ];
}
