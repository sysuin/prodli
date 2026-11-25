// Pomodoro timer state shared by every ProdLi tab and the background worker.
//
// The timer is stored as an end time (not a ticking counter), so it keeps
// running when tabs are closed or switched. In the extension, the background
// worker is the only place that finishes a phase (on a chrome.alarms alarm),
// which records the session and shows the notification even with no tab open.

import { storageGet, storageSet } from "./storage";

export * from "./pomodoroTimer";
import { DEFAULT_POMODORO_SETTINGS, MAX_SESSIONS, TIMER_KEY, defaultTimer, nextPhaseAfter, withPhase, type Phase, type PomodoroSession, type PomodoroSettings, type TimerState } from "./pomodoroTimer";

export async function loadPomodoro(): Promise<{ settings: PomodoroSettings; sessions: PomodoroSession[]; completed: number; timer: TimerState }> {
  const [settings, sessions, completed] = await Promise.all([
    storageGet<PomodoroSettings>("pomodoroSettings", DEFAULT_POMODORO_SETTINGS),
    storageGet<PomodoroSession[]>("pomodoroSessions", []),
    storageGet<number>("completedPomodoros", 0),
  ]);
  const timer = await storageGet<TimerState>(TIMER_KEY, defaultTimer(settings));
  return { settings, sessions, completed, timer: { ...defaultTimer(settings), ...timer } };
}

export function saveTimer(t: TimerState): Promise<void> {
  return storageSet(TIMER_KEY, t);
}

/**
 * Finishes the current phase if its end time has passed. Safe to call more
 * than once: it does nothing unless the timer is running and due.
 * Returns the phase that just finished, or null.
 */
export async function completeIfDue(now: number = Date.now()): Promise<Phase | null> {
  const { settings, sessions, completed, timer } = await loadPomodoro();
  if (!timer.running || timer.endsAt === null || timer.endsAt > now) return null;

  const finished = timer.phase;
  const { next, completedAfter } = nextPhaseAfter(finished, completed, settings);
  if (finished === "work") {
    const session: PomodoroSession = {
      id: String(now),
      label: timer.label || "Focus session",
      completedAt: new Date(now).toISOString(),
      duration: settings.workDuration,
    };
    await storageSet("pomodoroSessions", [session, ...sessions].slice(0, MAX_SESSIONS));
    await storageSet("completedPomodoros", completedAfter);
  }
  await saveTimer({
    ...withPhase(timer, next, settings),
    lastCompletedAt: now,
    lastCompletedPhase: finished,
  });
  return finished;
}

export function completionMessage(finished: Phase): string {
  return finished === "work" ? "Time for a break!" : "Back to work!";
}
