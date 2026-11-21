// Reminds you to record when a call starts in another app (core/callDetect.ts),
// once per call, while "Remind me to record calls" is on and nothing is recording.

import { execFile } from "node:child_process";
import { Notification } from "electron";
import { newCalls, parseMacInCall, parseWindowsMicInUse, reminderText, WINDOWS_MIC_KEY } from "../core/callDetect";
import { getPrefs } from "./prefs";

const EVERY_MS = 15_000;
let current: string[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out))));
}

async function callsNow(): Promise<string[]> {
  if (process.platform === "win32") return parseWindowsMicInUse(await run("reg", ["query", WINDOWS_MIC_KEY, "/s", "/v", "LastUsedTimeStop"]));
  if (process.platform === "darwin") return parseMacInCall(await run("ps", ["-axco", "comm"]));
  return [];
}

export function startCallNudges(opts: { isRecording: () => boolean; record: () => void }): void {
  if (timer || (process.platform !== "win32" && process.platform !== "darwin")) return;
  timer = setInterval(async () => {
    if (!getPrefs().callNudge) return void (current = []);
    const now = await callsNow();
    const started = newCalls(current, now);
    current = now;
    if (!started.length || opts.isRecording() || !Notification.isSupported()) return;
    const n = new Notification({ ...reminderText(started), silent: false });
    n.on("click", () => opts.record());
    n.show();
  }, EVERY_MS);
}
