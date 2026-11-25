// The menu bar (Mac) / tray (Windows) timer: what it shows comes from
// prodli/src/lib/menuBar.ts (shared with the page's own Pomodoro and Now
// card); this adds keep-awake. Pure helpers; main/menuBar.ts runs them.

export { inMinutes, menuBarStatus, pauseTimer, resumeTimer, startFocus, stopTimer, type MenuBarStatus } from "../../../prodli/src/lib/menuBar";
export { DEFAULT_POMODORO_SETTINGS, TIMER_KEY, type PomodoroSettings, type TimerState } from "../../../prodli/src/lib/pomodoroTimer";

/** Storage keys the menu bar reads. */
export const MENU_BAR_KEYS = ["pomodoroTimer", "pomodoroSettings", "todos"] as const;

/**
 * Keep the computer awake: "display" (screen stays on) when you turned it on
 * from the menu; "system" (the computer doesn't sleep, the screen may) while
 * recording or in a focus session, if that's on in Settings › Desktop app.
 */
export type AwakeMode = { kind: "display" | "system"; reason: string } | null;

export function keepAwakeMode(s: { manual: boolean; auto: boolean; recording: boolean; focusing: boolean }): AwakeMode {
  if (s.manual) return { kind: "display", reason: "Keeping your computer awake" };
  if (s.auto && s.recording) return { kind: "system", reason: "Staying awake while recording" };
  if (s.auto && s.focusing) return { kind: "system", reason: "Staying awake during your focus session" };
  return null;
}
