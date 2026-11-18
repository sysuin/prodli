// Background (extension): the daily "plan your day" reminder. Clicking it opens
// ProdLi on Today, where the brief is written (so it's only generated for
// people who look at it).
import { dayKey, getTodaySettings, TODAY_SETTINGS_KEY } from "./today";
import { storageGet, storageSet } from "./storage";
import { blockMinutes, blockOf } from "./timeBlocks";
import { reminderAt, timeLabel, toggleTodo } from "./recurrence";
import type { Todo } from "../types";

const BLOCK_ALARM = "block:"; // + task id
const BLOCK_NOTIFICATION = "block:";

/** One alarm per time block still ahead today (reset whenever to-dos or settings change). */
async function scheduleBlocks(now = new Date()): Promise<void> {
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter((a) => a.name.startsWith(BLOCK_ALARM)).map((a) => chrome.alarms.clear(a.name)));
  const settings = await getTodaySettings();
  if (settings.blockReminders === false) return;
  const today = dayKey(now);
  const todos = await storageGet<Todo[]>("todos", []);
  for (const t of todos) {
    const slot = blockOf(t, today);
    if (!slot) continue;
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(slot.start / 60), slot.start % 60).getTime();
    if (when > now.getTime() + 15_000) await chrome.alarms.create(`${BLOCK_ALARM}${t.id}`, { when });
  }
}

// ── Task reminders: a notification at a task's time ("Call Sam at 3pm") ────────
const TASK_ALARM = "task:"; // + task id
const SNOOZE_ALARM = "tasksnooze:"; // + task id
const TASK_NOTIFICATION = "task:";
const REFRESH_ALARM = "task_reminders_refresh";
const WINDOW_MS = 8 * 86_400_000;
export const SNOOZE_MS = 10 * 60_000;

/** One alarm per open task whose time is in the next 8 days (reset whenever to-dos or settings change). */
export async function scheduleTaskReminders(now = Date.now()): Promise<void> {
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter((a) => a.name.startsWith(TASK_ALARM)).map((a) => chrome.alarms.clear(a.name)));
  const settings = await getTodaySettings();
  if (settings.taskReminders === false) return;
  const todos = await storageGet<Todo[]>("todos", []);
  for (const t of todos) {
    const when = reminderAt(t);
    if (when !== null && when > now + 15_000 && when < now + WINDOW_MS) await chrome.alarms.create(`${TASK_ALARM}${t.id}`, { when });
  }
  // Pick up tasks that come into the window later.
  if (!(await chrome.alarms.get(REFRESH_ALARM))) await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 12 * 60 });
}

async function notifyTask(id: string, snoozed: boolean): Promise<void> {
  const t = (await storageGet<Todo[]>("todos", [])).find((x) => x.id === id);
  if (!t || t.completed) return;
  // A normal reminder only fires if the task is still due around now (it may have been moved).
  // Up to 2 hours late is fine: the computer may have been asleep at that time.
  if (!snoozed) {
    const when = reminderAt(t);
    if (when === null || when > Date.now() + 60_000 || Date.now() - when > 2 * 3600_000) return;
  }
  chrome.notifications.create(`${TASK_NOTIFICATION}${id}`, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: `⏰ ${t.title}`.slice(0, 120),
    message: t.dueTime ? `Due ${snoozed ? "since" : "at"} ${timeLabel(t.dueTime)}` : "Reminder",
    buttons: [{ title: "✓ Mark done" }, { title: "Snooze 10 min" }],
    requireInteraction: true,
    priority: 2,
  });
}

/** Completes a task from its notification (repeating tasks move to their next date). */
export async function completeTaskFromReminder(id: string, now = new Date()): Promise<void> {
  const todos = await storageGet<Todo[]>("todos", []);
  const t = todos.find((x) => x.id === id);
  if (!t || t.completed) return;
  await storageSet("todos", toggleTodo(todos, id, now));
}

function registerTaskReminders(): void {
  void scheduleTaskReminders();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.todos || changes[TODAY_SETTINGS_KEY])) void scheduleTaskReminders();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void scheduleTaskReminders();
    else if (alarm.name.startsWith(SNOOZE_ALARM)) void notifyTask(alarm.name.slice(SNOOZE_ALARM.length), true);
    else if (alarm.name.startsWith(TASK_ALARM)) void notifyTask(alarm.name.slice(TASK_ALARM.length), false);
  });
  chrome.notifications.onButtonClicked.addListener((nid, button) => {
    if (!nid.startsWith(TASK_NOTIFICATION)) return;
    const id = nid.slice(TASK_NOTIFICATION.length);
    chrome.notifications.clear(nid);
    if (button === 0) void completeTaskFromReminder(id);
    else void chrome.alarms.create(`${SNOOZE_ALARM}${id}`, { when: Date.now() + SNOOZE_MS });
  });
  chrome.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(TASK_NOTIFICATION)) return;
    void storageSet("lastSection", "todos").then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
    chrome.notifications.clear(nid);
  });
}

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
  registerTaskReminders();
  void schedule();
  void scheduleBlocks();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[TODAY_SETTINGS_KEY]) void schedule();
    if (area === "local" && (changes.todos || changes[TODAY_SETTINGS_KEY])) void scheduleBlocks();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(BLOCK_ALARM)) return;
    void (async () => {
      const id = alarm.name.slice(BLOCK_ALARM.length);
      const t = (await storageGet<Todo[]>("todos", [])).find((x) => x.id === id);
      if (!t || !blockOf(t, dayKey())) return; // done, removed or moved since
      chrome.notifications.create(`${BLOCK_NOTIFICATION}${id}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: `Time for: ${t.title}`.slice(0, 120),
        message: `Your ${blockMinutes(t)}-minute block starts now.`,
        priority: 1,
      });
    })();
  });
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(BLOCK_NOTIFICATION)) return;
    void storageSet("lastSection", "today").then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }));
    chrome.notifications.clear(id);
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
