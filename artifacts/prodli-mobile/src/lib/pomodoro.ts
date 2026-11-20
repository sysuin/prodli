// The Pomodoro timer on the phone. The running timer stays on this device
// (it's stored with an end time, so it survives the app being closed);
// finished focus sessions and the counter sync like the extension's.
import { read, write } from "./store";

export type Phase = "work" | "short-break" | "long-break";
export interface PomodoroSettings {
  workDuration: number;
  shortBreak: number;
  longBreak: number;
  longBreakAfter: number;
}
export interface TimerState {
  phase: Phase;
  running: boolean;
  endsAt: number | null;
  remaining: number;
  label: string;
  /** Focus sessions finished in this cycle (for the long break). */
  cycle: number;
}

export const SETTINGS_KEY = "pomodoroSettings";
export const TIMER_KEY = "mobilePomodoroTimer";
export const DEFAULTS: PomodoroSettings = { workDuration: 25, shortBreak: 5, longBreak: 15, longBreakAfter: 4 };

export const totalOf = (phase: Phase, s: PomodoroSettings) => (phase === "work" ? s.workDuration : phase === "short-break" ? s.shortBreak : s.longBreak) * 60;
export const settings = (): PomodoroSettings => ({ ...DEFAULTS, ...read<Partial<PomodoroSettings>>(SETTINGS_KEY, {}) });
export const freshTimer = (s = settings()): TimerState => ({ phase: "work", running: false, endsAt: null, remaining: totalOf("work", s), label: "", cycle: 0 });
export const timer = (): TimerState => read<TimerState | null>(TIMER_KEY, null) ?? freshTimer();
export const saveTimer = (t: TimerState) => write(TIMER_KEY, t);

export function secondsLeft(t: TimerState, now = Date.now()): number {
  return t.running && t.endsAt ? Math.max(0, Math.round((t.endsAt - now) / 1000)) : t.remaining;
}
export const start = (t: TimerState, now = Date.now()): TimerState => ({ ...t, running: true, endsAt: now + t.remaining * 1000 });
export const pause = (t: TimerState, now = Date.now()): TimerState => ({ ...t, running: false, endsAt: null, remaining: secondsLeft(t, now) });
export const withPhase = (t: TimerState, phase: Phase, s = settings()): TimerState => ({ ...t, phase, running: false, endsAt: null, remaining: totalOf(phase, s) });

/** Pure: what comes after a finished phase. */
export function next(t: TimerState, s: PomodoroSettings): TimerState {
  if (t.phase !== "work") return { ...withPhase(t, "work", s) };
  const cycle = t.cycle + 1;
  const phase: Phase = cycle >= s.longBreakAfter ? "long-break" : "short-break";
  return { ...withPhase(t, phase, s), cycle: phase === "long-break" ? 0 : cycle };
}
