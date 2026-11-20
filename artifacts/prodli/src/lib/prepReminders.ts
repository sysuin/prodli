// Prep reminders (Pro): 10 minutes before a meeting that has meeting prep
// (Today), a notification with its open items and when you last met; clicking
// it opens Today. Today schedules them when it shows meeting prep (it has the
// calendar); the background shows them (registerPrepReminders).

import { metLabel, type MeetingPrep } from "./meetingPrep";
import { storageGet, storageSet } from "./storage";

export const PREP_ALARM = "prepremind:";
const PREP_NOTIFICATION = "prepnote:";
export const PREP_REMINDERS_KEY = "prepReminders";
export const LEAD_MIN = 10;

export interface PrepReminder {
  title: string;
  start: string;
  line: string;
  when: number;
}

/** "2 open items · last met 12 Nov" */
export function reminderLine(p: MeetingPrep, now = new Date()): string {
  const n = p.openItems.length;
  return [n ? `${n} open item${n > 1 ? "s" : ""}` : "", p.last ? `last met ${metLabel(p.last.date, now)}` : "", !n && p.relatedTasks.length ? `${p.relatedTasks.length} related to-do${p.relatedTasks.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
}

/** Pure: the reminders for today's prep (start − 10 min, still ahead). */
export function plannedReminders(prep: MeetingPrep[], now = new Date()): Record<string, PrepReminder> {
  const out: Record<string, PrepReminder> = {};
  for (const p of prep) {
    if (!p.start) continue;
    const [h, m] = p.start.split(":").map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() - LEAD_MIN * 60_000;
    if (at > now.getTime() + 15_000) out[p.eventId] = { title: p.title, start: p.start, line: reminderLine(p, now) || "Open Today for your prep", when: at };
  }
  return out;
}

/** Schedules today's reminders (extension only) and clears ones that no longer apply. */
export async function schedulePrepReminders(prep: MeetingPrep[], enabled: boolean, now = new Date()): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const next = enabled ? plannedReminders(prep, now) : {};
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter((a) => a.name.startsWith(PREP_ALARM) && !next[a.name.slice(PREP_ALARM.length)]).map((a) => chrome.alarms.clear(a.name)));
  for (const [id, r] of Object.entries(next)) await chrome.alarms.create(`${PREP_ALARM}${id}`, { when: r.when });
  await storageSet(PREP_REMINDERS_KEY, next);
}

/** Background: show the reminder; clicking it opens Today. */
export function registerPrepReminders(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(PREP_ALARM)) return;
    const id = alarm.name.slice(PREP_ALARM.length);
    void storageGet<Record<string, PrepReminder>>(PREP_REMINDERS_KEY, {}).then((all) => {
      const r = all[id];
      if (!r) return;
      chrome.notifications.create(`${PREP_NOTIFICATION}${id}`, { type: "basic", iconUrl: "icons/icon-128.png", title: `Prep: ${r.title} at ${r.start}`, message: r.line });
    });
  });
  chrome.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(PREP_NOTIFICATION)) return;
    chrome.notifications.clear(nid);
    void storageSet("lastSection", "today").then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
  });
}
