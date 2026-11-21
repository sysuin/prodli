// Time in apps (core/appUsage.ts). Runs only while "Track time in apps" is on
// (store key desktopAppTracking, switched in Time Tracker). Idle time (no
// keyboard / mouse for the Time Tracker's idle threshold) isn't counted, and
// neither is time with the screen locked.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { powerMonitor } from "electron";
import { addSample, APP_TRACKING_KEY, appsDayKey, cleanAppName, encodePowerShell, MAC_FRONT_APP_SCRIPT, windowsForegroundScript } from "../core/appUsage";
import type { FileStore } from "../core/fileStore";

const MAC_EVERY_S = 10;
const WIN_EVERY_S = 5;

let store: FileStore | null = null;
let macTimer: ReturnType<typeof setInterval> | null = null;
let win: ChildProcess | null = null;
let locked = false;
let last = 0;

function idleThreshold(): number {
  const s = store?.get("tt_settings") as { idleThreshold?: unknown } | undefined;
  return typeof s?.idleThreshold === "number" && s.idleThreshold >= 15 ? s.idleThreshold : 60;
}

function record(raw: string): void {
  const now = Date.now();
  const elapsed = last ? (now - last) / 1000 : 0;
  last = now;
  if (!store || locked || powerMonitor.getSystemIdleTime() >= idleThreshold()) return;
  const app = cleanAppName(raw);
  if (!app || elapsed <= 0) return;
  const key = appsDayKey();
  store.set(key, addSample(store.get(key) as Record<string, number> | undefined, app, elapsed, 60));
}

function start(): void {
  if (macTimer || win) return;
  last = Date.now();
  if (process.platform === "darwin") {
    const sample = () =>
      execFile("osascript", ["-l", "JavaScript", "-e", MAC_FRONT_APP_SCRIPT], { timeout: 4000 }, (err, out) => {
        if (!err) record(String(out));
      });
    macTimer = setInterval(sample, MAC_EVERY_S * 1000);
  } else if (process.platform === "win32") {
    win = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(windowsForegroundScript(WIN_EVERY_S))], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    win.stdout?.setEncoding("utf8");
    win.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        record(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    const child = win;
    child.on("exit", () => {
      if (win === child) win = null;
    });
  }
}

function stop(): void {
  if (macTimer) clearInterval(macTimer);
  macTimer = null;
  win?.kill();
  win = null;
}

export function startAppTracking(s: FileStore): void {
  store = s;
  const apply = () => (s.get(APP_TRACKING_KEY) === true ? start() : stop());
  apply();
  s.onChange((changes) => changes.some((c) => c.key === APP_TRACKING_KEY) && apply());
  powerMonitor.on("lock-screen", () => void (locked = true));
  powerMonitor.on("unlock-screen", () => {
    locked = false;
    last = Date.now();
  });
  powerMonitor.on("suspend", () => void (locked = true));
  powerMonitor.on("resume", () => {
    locked = false;
    last = Date.now();
  });
}

export const stopAppTracking = stop;
