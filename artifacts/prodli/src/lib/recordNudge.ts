// "Remind me to record": about 45 seconds after you join a call (a Meet,
// Zoom, Jitsi or Whereby meeting link) without recording, one notification
// says how to start ProdLi's notes. Once per meeting a day; "Don't remind me
// again" turns it off (Setup → Recorder). Only when the recorder is on.
//
// A notification can't start recording itself: Chrome only lets ProdLi
// capture a tab after a click on its icon or the keyboard shortcut.

import { callFromUrl, PLATFORM_LABEL, type CallPlatform } from "../recorder/calls";
import { RECORDER_PERMISSIONS, RECORDING_STATE_KEY } from "../recorder/types";
import { getDayKey } from "./utils";

export const RECORD_NUDGE_KEY = "recorderNudge";
const NUDGED_KEY = "recorderNudged";
const NUDGE_ALARM = "recnudge|";
const NUDGE_NOTIFICATION = "recnudge_";
const DELAY_MINUTES = 0.75;
/** Apps whose link means you're in that meeting (Teams, Slack and Discord tabs stay open all day). */
const NUDGE_PLATFORMS: CallPlatform[] = ["google-meet", "zoom", "jitsi", "whereby"];

/** "google-meet:abc-defg-hij" for a meeting link worth a reminder; null otherwise. */
export function nudgeKey(url: string | undefined): string | null {
  const call = callFromUrl(url);
  if (!call || !call.code || !NUDGE_PLATFORMS.includes(call.platform)) return null;
  return `${call.platform}:${call.code.toLowerCase()}`;
}

/** The record of reminders shown, with today's one added (keeps the last 50). */
export function markNudged(nudged: Record<string, string>, key: string, today: string): Record<string, string> {
  const entries = Object.entries({ ...nudged, [key]: today }).sort((a, b) => b[1].localeCompare(a[1]));
  return Object.fromEntries(entries.slice(0, 50));
}

export function nudgeMessage(key: string, shortcut = "Alt+Shift+R"): { title: string; message: string } {
  const platform = key.split(":")[0] as CallPlatform;
  return {
    title: "Taking notes in this call?",
    message: `You're in a ${PLATFORM_LABEL[platform] ?? "video"} call. Click the ProdLi icon or press ${shortcut} to record it and get AI notes.`,
  };
}

async function local<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}

/** The alarm's check: still in that call, not recording, reminders on, not reminded today. */
export async function maybeNudge(tabId: number, key: string): Promise<boolean> {
  if (!(await local<boolean>(RECORD_NUDGE_KEY, true))) return false;
  if (!(await chrome.permissions.contains({ permissions: RECORDER_PERMISSIONS.permissions }).catch(() => false))) return false;
  if ((await chrome.storage.session.get(RECORDING_STATE_KEY))[RECORDING_STATE_KEY]) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || nudgeKey(tab.url) !== key) return false;
  const today = getDayKey();
  const nudged = await local<Record<string, string>>(NUDGED_KEY, {});
  if (nudged[key] === today) return false;
  await chrome.storage.local.set({ [NUDGED_KEY]: markNudged(nudged, key, today) });
  const commands = await chrome.commands?.getAll().catch((): chrome.commands.Command[] => []);
  const shortcut = commands?.find((c) => c.name === "toggle-recording")?.shortcut || undefined;
  const { title, message } = nudgeMessage(key, shortcut);
  chrome.notifications.create(`${NUDGE_NOTIFICATION}${tabId}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message, buttons: [{ title: "Don't remind me again" }], priority: 1 });
  return true;
}

export function registerRecordNudge(): void {
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliMaybeNudge: maybeNudge, __prodliNudgeKey: nudgeKey });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    const key = nudgeKey(changeInfo.url ?? tab.url);
    if (!key) return;
    const name = `${NUDGE_ALARM}${tabId}|${key}`;
    void chrome.alarms.get(name).then((existing) => {
      if (!existing) void chrome.alarms.create(name, { delayInMinutes: DELAY_MINUTES });
    });
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(NUDGE_ALARM)) return;
    const [, tabId, key] = alarm.name.split("|");
    void maybeNudge(Number(tabId), key).catch(() => false);
  });

  chrome.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(NUDGE_NOTIFICATION)) return;
    chrome.notifications.clear(nid);
    const tabId = Number(nid.slice(NUDGE_NOTIFICATION.length));
    void chrome.tabs.update(tabId, { active: true }).then((t) => (t?.windowId !== undefined ? chrome.windows.update(t.windowId, { focused: true }) : undefined)).catch(() => {});
  });

  chrome.notifications.onButtonClicked.addListener((nid) => {
    if (!nid.startsWith(NUDGE_NOTIFICATION)) return;
    chrome.notifications.clear(nid);
    void chrome.storage.local.set({ [RECORD_NUDGE_KEY]: false });
  });
}
