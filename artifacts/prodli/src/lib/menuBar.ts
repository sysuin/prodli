// The desktop app's menu bar (Mac) / tray (Windows) timer: the Pomodoro
// countdown, the time block that's on, the next one and the top task, plus the
// Start / Pause / Stop actions. Pure (no storage, no browser APIs): the desktop
// main process (prodli-desktop/src/main/menuBar.ts) reads the stored timer and
// to-dos, calls menuBarStatus every second while something counts down, and
// writes the timer back for the actions; the open page picks the change up and
// finishes the phase as usual (usePomodoroTimer).

import type { Todo } from "../types";
import { countdown, currentBlock, nextBlock } from "./nowBlock";
import { toHM } from "./timeBlocks";
import { DEFAULT_POMODORO_SETTINGS, defaultTimer, getPomodoroTotal, pause, secondsLeftOf, start, withPhase, type Phase, type PomodoroSettings, type TimerState } from "./pomodoroTimer";

export interface MenuBarInput {
  timer?: TimerState | null;
  settings?: PomodoroSettings | null;
  todos?: Todo[] | null;
  now?: number;
}

export interface MenuBarStatus {
  /** Text next to the menu bar icon (Mac): the timer, or "" for just the icon. */
  title: string;
  /** Tray tooltip (Windows) and the icon's accessibility text. */
  tooltip: string;
  /** The Pomodoro, while running or paused part-way through a phase. */
  timer: { phase: Phase; running: boolean; label: string; left: string; until: string | null } | null;
  /** The time block that's on now ("until" is its end, HH:MM). */
  now: { title: string; left: string; until: string } | null;
  /** The next time block today. */
  next: { title: string; at: string; inMin: number } | null;
  /** The first open task planned for today (else overdue or due today), not counting the block that's on. */
  top: string | null;
  /** Something counts down: update every second. */
  ticking: boolean;
}

const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const phaseLabel = (p: Phase) => (p === "work" ? "Focus" : p === "short-break" ? "Short break" : "Long break");

/** The timer only shows once it's been started (running, or paused with time used). */
function activeTimer(t: TimerState | null | undefined, s: PomodoroSettings): TimerState | null {
  if (!t) return null;
  if (t.running && t.endsAt !== null) return t;
  return t.remaining > 0 && t.remaining < getPomodoroTotal(t.phase, s) ? t : null;
}

export function menuBarStatus({ timer, settings, todos, now = Date.now() }: MenuBarInput): MenuBarStatus {
  const s = settings ?? DEFAULT_POMODORO_SETTINGS;
  const date = new Date(now);
  const day = dayKeyOf(date);
  const nowMin = date.getHours() * 60 + date.getMinutes();
  const open = (todos ?? []).filter((t) => !t.completed);

  const t = activeTimer(timer, s);
  const clock = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const timerInfo = t ? { phase: t.phase, running: t.running, label: phaseLabel(t.phase), left: countdown(secondsLeftOf(t, now) * 1000), until: t.running && t.endsAt !== null ? clock(t.endsAt) : null } : null;

  const cur = currentBlock(open, day, nowMin);
  const nowInfo = cur ? { title: short(cur.todo.title), left: countdown((cur.slot.end - nowMin) * 60_000 - date.getSeconds() * 1000), until: toHM(cur.slot.end) } : null;
  const nxt = nextBlock(open, day, nowMin);
  const nextInfo = nxt ? { title: short(nxt.todo.title), at: toHM(nxt.slot.start), inMin: nxt.slot.start - nowMin } : null;

  const notNow = open.filter((x) => x.id !== cur?.todo.id);
  const topTask = notNow.find((x) => x.plannedFor === day) ?? notNow.find((x) => !!x.dueDate && x.dueDate <= day);

  const icon = t ? (t.phase === "work" ? (t.running ? "🍅" : "⏸") : t.running ? "☕" : "⏸") : "";
  const title = timerInfo ? `${icon} ${timerInfo.left}` : "";
  const tooltip = timerInfo
    ? `ProdLi — ${timerInfo.label} ${timerInfo.running ? `${timerInfo.left} left` : `paused (${timerInfo.left} left)`}`
    : nowInfo
      ? `ProdLi — Now: ${nowInfo.title} (${nowInfo.left} left)`
      : nextInfo
        ? `ProdLi — Next: ${nextInfo.title} at ${nextInfo.at}`
        : "ProdLi";

  return { title, tooltip, timer: timerInfo, now: nowInfo, next: nextInfo, top: topTask ? short(topTask.title) : null, ticking: !!t?.running || !!cur };
}

/** "in 5 min", "in 1 h 20 min". */
export function inMinutes(min: number): string {
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

// ── Actions (the menu writes the result back to storage) ─────────────────────

/** Start a focus session: resumes a paused one, otherwise a fresh one of the usual length. */
export function startFocus(t: TimerState | null | undefined, settings: PomodoroSettings | null | undefined, now = Date.now()): TimerState {
  const s = settings ?? DEFAULT_POMODORO_SETTINGS;
  const base = t ?? defaultTimer(s);
  if (base.running) return base;
  const resumable = base.phase === "work" && base.remaining > 0 && base.remaining <= getPomodoroTotal("work", s);
  return start(resumable ? base : withPhase(base, "work", s), now);
}

export const pauseTimer = (t: TimerState, now = Date.now()): TimerState => pause(t, now);
export const resumeTimer = (t: TimerState, now = Date.now()): TimerState => start(t, now);

/** Stop: back to a full focus session, not running. */
export function stopTimer(t: TimerState, settings: PomodoroSettings | null | undefined): TimerState {
  return withPhase(t, "work", settings ?? DEFAULT_POMODORO_SETTINGS);
}
