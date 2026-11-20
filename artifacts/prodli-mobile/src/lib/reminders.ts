// Phone notifications. This default (web preview, tests) does nothing; the
// apps use reminders.native.ts.
import type { Todo } from "../shared";

export const remindersSupported = (): boolean => false;
export async function enableReminders(): Promise<boolean> {
  return false;
}
export async function syncTodoReminders(_todos: Todo[]): Promise<void> {}
export async function schedulePomodoroEnd(_at: number, _title: string, _body: string): Promise<void> {}
export async function cancelPomodoroEnd(): Promise<void> {}
export function startReminders(): void {}
export async function setPhoneReminders(_on: boolean): Promise<boolean> {
  return false;
}
