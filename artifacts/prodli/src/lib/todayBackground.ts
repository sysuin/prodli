// Background (extension): the daily "plan your day" reminder. Clicking it opens
// ProdLi on Today, where the brief is written (so it's only generated for
// people who look at it).
import { dayKey, getTodaySettings, TODAY_SETTINGS_KEY } from "./today";
import { storageGet, storageSet } from "./storage";

const ALARM = "today_reminder";
const NOTIFICATION = "today_reminder";

function nextAt(time: string, now = new Date()): number {
  const [h, m] = time.split(":").map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

async function schedule(): Promise<void> {
  const s = await getTodaySettings();
  await chrome.alarms.clear(ALARM);
  if (s.reminder) await chrome.alarms.create(ALARM, { when: nextAt(s.reminder), periodInMinutes: 24 * 60 });
}

export function registerTodayReminder(): void {
  void schedule();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[TODAY_SETTINGS_KEY]) void schedule();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void (async () => {
      const today = dayKey();
      // Already looked at Today today? Don't nag.
      if ((await storageGet<string | null>("todayReminderShown", null)) === today) return;
      if ((await storageGet<string | null>("lastTodayVisit", null)) === today) return;
      await storageSet("todayReminderShown", today);
      chrome.notifications.create(NOTIFICATION, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "Good morning — plan your day",
        message: "Your daily brief is ready to write: priorities, schedule and habits for today.",
        priority: 1,
      });
    })();
  });
  chrome.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFICATION) return;
    void storageSet("lastSection", "today").then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
    chrome.notifications.clear(id);
  });
}
