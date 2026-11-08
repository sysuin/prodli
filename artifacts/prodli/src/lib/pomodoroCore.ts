// Pomodoro timer state shared by every ProdLi tab and the background worker.
//
// The timer is stored as an end time (not a ticking counter), so it keeps
// running when tabs are closed or switched. In the extension, the background
// worker is the only place that finishes a phase (on a chrome.alarms alarm),
// which records the session and shows the notification even with no tab open.

import { storageGet, storageSet } from "./storage";

export type Phase = "work" | "short-break" | "long-break";

export interface PomodoroSettings {
  workDuration: number;
  shortBreak: number;
  longBreak: number;
  longBreakAfter: number;
}

export interface PomodoroSession {
  id: string;
  label: string;
  completedAt: string;
  duration: number;
}

export interface TimerState {
  phase: Phase;
  running: boolean;
  /** When the current phase ends (ms since epoch) while running */
  endsAt: number | null;
  /** Seconds left while paused */
  remaining: number;
  label: string;
  /** Set each time a phase finishes, so open tabs can play the chime */
  lastCompletedAt: number | null;
  lastCompletedPhase: Phase | null;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workDuration: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakAfter: 4,
};

export const TIMER_KEY = "pomodoroTimer";
export const POMODORO_ALARM = "pomodoro_end";
export const MAX_SESSIONS = 20;

export function getPomodoroTotal(phase: Phase, s: PomodoroSettings): number {
  if (phase === "work") return s.workDuration * 60;
  if (phase === "short-break") return s.shortBreak * 60;
  return s.longBreak * 60;
}

export function defaultTimer(settings: PomodoroSettings): TimerState {
  return { phase: "work", running: false, endsAt: null, remaining: getPomodoroTotal("work", settings), label: "", lastCompletedAt: null, lastCompletedPhase: null };
}

export function secondsLeftOf(t: TimerState, now: number = Date.now()): number {
  if (t.running && t.endsAt !== null) return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
  return t.remaining;
}

/** Which phase follows `current`. Work counts toward the long break. */
export function nextPhaseAfter(current: Phase, completedBefore: number, s: PomodoroSettings): { next: Phase; completedAfter: number } {
  if (current !== "work") return { next: "work", completedAfter: completedBefore };
  const completedAfter = completedBefore + 1;
  return { next: completedAfter % s.longBreakAfter === 0 ? "long-break" : "short-break", completedAfter };
}

export function start(t: TimerState, now: number = Date.now()): TimerState {
  if (t.running) return t;
  return { ...t, running: true, endsAt: now + t.remaining * 1000 };
}

export function pause(t: TimerState, now: number = Date.now()): TimerState {
  if (!t.running) return t;
  return { ...t, running: false, endsAt: null, remaining: secondsLeftOf(t, now) };
}

export function withPhase(t: TimerState, phase: Phase, s: PomodoroSettings): TimerState {
  return { ...t, phase, running: false, endsAt: null, remaining: getPomodoroTotal(phase, s) };
}

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
