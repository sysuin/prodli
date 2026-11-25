// The menu bar (Mac) / tray (Windows) timer: the Pomodoro countdown next to the
// icon (Mac), today's blocks and top task in the menu, Start / Pause / Stop,
// and keep-awake. It reads the store directly (core/menuBar.ts does the maths),
// so it works with the window closed. Timer actions write the stored timer; the
// page (always loaded, hidden when closed) picks that up and finishes phases
// as usual.

import { powerSaveBlocker } from "electron";
import type { FileStore } from "../core/fileStore";
import { DEFAULT_POMODORO_SETTINGS, keepAwakeMode, MENU_BAR_KEYS, menuBarStatus, pauseTimer, resumeTimer, startFocus, stopTimer, TIMER_KEY, type AwakeMode, type MenuBarStatus, type PomodoroSettings, type TimerState } from "../core/menuBar";
import { getPrefs, onPrefsChange } from "./prefs";

export interface MenuBarHooks {
  /** Text next to the icon (Mac) and the tooltip. */
  setTitle(title: string, tooltip: string): void;
  /** Rebuild the tray menu (main/menu.ts). */
  rebuildMenu(): void;
}

let store: FileStore | null = null;
let hooks: MenuBarHooks | null = null;
let status: MenuBarStatus | null = null;
let focusMinutes = DEFAULT_POMODORO_SETTINGS.workDuration;
let manualAwake = false;
let recording = false;
let awake: AwakeMode = null;
let blocker: { id: number; kind: "display" | "system" } | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let minuteTicker: ReturnType<typeof setInterval> | null = null;
let menuSignature = "";

const read = () => {
  const settings = { ...DEFAULT_POMODORO_SETTINGS, ...((store?.get("pomodoroSettings") as Partial<PomodoroSettings> | undefined) ?? {}) };
  const timer = (store?.get(TIMER_KEY) as TimerState | undefined) ?? null;
  const todos = store?.get("todos");
  return { settings, timer, todos: Array.isArray(todos) ? todos : [] };
};

function applyAwake(): void {
  awake = keepAwakeMode({ manual: manualAwake, auto: getPrefs().autoKeepAwake, recording, focusing: !!(status?.timer?.running && status.timer.phase === "work") });
  const want = awake?.kind ?? null;
  if ((blocker?.kind ?? null) === want) return;
  if (blocker && powerSaveBlocker.isStarted(blocker.id)) powerSaveBlocker.stop(blocker.id);
  blocker = want ? { id: powerSaveBlocker.start(want === "display" ? "prevent-display-sleep" : "prevent-app-suspension"), kind: want } : null;
}

function update(): void {
  if (!store || !hooks) return;
  const { settings, timer, todos } = read();
  focusMinutes = settings.workDuration;
  status = menuBarStatus({ timer, settings, todos, now: Date.now() });
  hooks.setTitle(status.title, status.tooltip);
  applyAwake();
  // The menu shows fixed times ("until 10:55"), so it's rebuilt only when what it shows changes.
  const t = status.timer;
  const signature = JSON.stringify([t && [t.label, t.running, t.until, t.running ? "" : t.left], status.now && [status.now.title, status.now.until], status.next, status.top, focusMinutes, manualAwake, awake?.reason ?? null]);
  if (signature !== menuSignature) {
    menuSignature = signature;
    hooks.rebuildMenu();
  }
  if (status.ticking && !ticker) ticker = setInterval(update, 1000);
  else if (!status.ticking && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** For the tray menu (main/menu.ts). */
export function menuBarState() {
  return { status: status ?? undefined, focusMinutes, keepAwake: { manual: manualAwake, reason: awake?.reason ?? null } };
}

function writeTimer(next: (t: TimerState, s: PomodoroSettings) => TimerState): void {
  if (!store) return;
  const { settings, timer } = read();
  store.set(TIMER_KEY, next(timer ?? startFocus(null, settings), settings));
}

export const timerActions = {
  start: () => {
    if (!store) return;
    const { settings, timer } = read();
    store.set(TIMER_KEY, startFocus(timer, settings));
  },
  pause: () => writeTimer((t) => pauseTimer(t)),
  resume: () => writeTimer((t) => resumeTimer(t)),
  stop: () => writeTimer((t, s) => stopTimer(t, s)),
};

export function toggleKeepAwake(): void {
  manualAwake = !manualAwake;
  update();
}

/** A recording started / stopped (keep-awake while recording). */
export function setMenuBarRecording(on: boolean): void {
  recording = on;
  update();
}

export function startMenuBar(s: FileStore, h: MenuBarHooks): void {
  store = s;
  hooks = h;
  s.onChange((changes) => {
    if (changes.some((c) => (MENU_BAR_KEYS as readonly string[]).includes(c.key))) update();
  });
  onPrefsChange(update);
  // "Next … in 25 min" and a new day change without any write.
  minuteTicker = setInterval(update, 30_000);
  update();
}

export function stopMenuBar(): void {
  if (ticker) clearInterval(ticker);
  if (minuteTicker) clearInterval(minuteTicker);
  ticker = minuteTicker = null;
  if (blocker && powerSaveBlocker.isStarted(blocker.id)) powerSaveBlocker.stop(blocker.id);
  blocker = null;
}
