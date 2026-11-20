// Which reminders the phone should have scheduled (pure, unit-tested).
import { reminderAt, timeLabel, type Todo } from "../shared";

export const REMINDERS_KEY = "mobileReminders";
/** iOS keeps at most 64 pending notifications per app; leave room for Pomodoro. */
export const MAX_TODO_REMINDERS = 60;

export interface PlannedReminder {
  id: string;
  at: number;
  title: string;
  body: string;
  todoId: string;
}

export function plannedReminders(todos: Todo[], now = Date.now(), max = MAX_TODO_REMINDERS): PlannedReminder[] {
  return todos
    .map((t) => ({ t, at: reminderAt(t) }))
    .filter((x): x is { t: Todo; at: number } => x.at !== null && x.at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map(({ t, at }) => ({ id: `todo:${t.id}:${at}`, at, todoId: t.id, title: t.title, body: `Due at ${timeLabel(t.dueTime!)}${t.priority === "high" ? " · high priority" : ""}` }));
}
