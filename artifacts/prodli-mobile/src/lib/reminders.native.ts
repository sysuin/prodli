// Phone notifications (local only — nothing goes through a server):
//  • to-dos with a time, when "Remind me on this phone" is on (Settings). Off by
//    default, because the extension already reminds on the computer.
//  • the end of a Pomodoro phase while the app is in the background.
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";
import type { Todo } from "../shared";
import { plannedReminders, REMINDERS_KEY } from "./reminderPlan";
import { read, subscribe, write } from "./store";

const POMODORO_ID = "pomodoro-end";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export const remindersSupported = (): boolean => true;

async function ensureChannel() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("reminders", { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
}

/** Asks for permission; true when notifications may be shown. */
export async function enableReminders(): Promise<boolean> {
  await ensureChannel();
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

const granted = async () => (await Notifications.getPermissionsAsync()).granted;

export async function syncTodoReminders(todos: Todo[]): Promise<void> {
  const on = read<boolean>(REMINDERS_KEY, false);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const mine = scheduled.filter((n) => n.identifier.startsWith("todo:"));
  const wanted = on && (await granted()) ? plannedReminders(todos) : [];
  const want = new Set(wanted.map((w) => w.id));
  for (const n of mine) if (!want.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  const have = new Set(mine.map((n) => n.identifier));
  for (const w of wanted) {
    if (have.has(w.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: w.id,
      content: { title: w.title, body: w.body, data: { url: `/todo/${w.todoId}` } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(w.at), channelId: "reminders" },
    });
  }
}

export async function schedulePomodoroEnd(at: number, title: string, body: string): Promise<void> {
  await cancelPomodoroEnd();
  if (!(await granted())) return;
  await Notifications.scheduleNotificationAsync({ identifier: POMODORO_ID, content: { title, body, data: { url: "/pomodoro" } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: "reminders" } });
}

export async function cancelPomodoroEnd(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(POMODORO_ID).catch(() => {});
}

let started = false;
/** Keeps scheduled reminders in step with the to-do list (including edits from other devices). */
export function startReminders(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncTodoReminders(read<Todo[]>("todos", [])).catch(() => {}), 1000);
  };
  // Tapping a reminder opens the to-do (or the Pomodoro timer).
  Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
  });
  subscribe("todos", run);
  subscribe(REMINDERS_KEY, run);
  run();
}

/** Turns the setting on (asking for permission) or off. */
export async function setPhoneReminders(on: boolean): Promise<boolean> {
  if (on && !(await enableReminders())) return false;
  write(REMINDERS_KEY, on);
  return true;
}
