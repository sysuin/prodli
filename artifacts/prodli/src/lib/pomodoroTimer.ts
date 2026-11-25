// The Pomodoro timer's pure part: types, defaults and the timer maths. No
// storage or browser APIs, so the desktop app's menu bar can use it too
// (prodli-desktop/src/core/menuBar.ts). Storage and finishing a phase are in
// pomodoroCore.ts, which re-exports all of this.

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
