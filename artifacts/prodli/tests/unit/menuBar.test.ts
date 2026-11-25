import { describe, expect, it } from "vitest";
import { inMinutes, menuBarStatus, pauseTimer, resumeTimer, startFocus, stopTimer } from "../../src/lib/menuBar";
import { DEFAULT_POMODORO_SETTINGS, defaultTimer, type TimerState } from "../../src/lib/pomodoroTimer";
import type { Todo } from "../../src/types";

// 25 Nov 2026, 10:00:00 local time.
const NOW = new Date(2026, 10, 25, 10, 0, 0).getTime();
const DAY = "2026-11-25";
const todo = (id: string, title: string, extra: Partial<Todo> = {}): Todo => ({ id, title, completed: false, createdAt: "", ...extra });
const S = DEFAULT_POMODORO_SETTINGS;

describe("desktop menu bar status", () => {
  it("shows nothing but the icon when nothing is going on", () => {
    const st = menuBarStatus({ timer: defaultTimer(S), settings: S, todos: [], now: NOW });
    expect(st).toMatchObject({ title: "", tooltip: "ProdLi", timer: null, now: null, next: null, top: null, ticking: false });
  });

  it("counts a running focus session down in the title, with its end time for the menu", () => {
    const t: TimerState = { ...defaultTimer(S), running: true, endsAt: NOW + (12 * 60 + 34) * 1000, label: "Proposal" };
    const st = menuBarStatus({ timer: t, settings: S, now: NOW });
    expect(st.title).toBe("🍅 12:34");
    expect(st.timer).toEqual({ phase: "work", running: true, label: "Focus", left: "12:34", until: "10:12" });
    expect(st.tooltip).toBe("ProdLi — Focus 12:34 left");
    expect(st.ticking).toBe(true);
  });

  it("shows a break with a cup, and a paused timer with a pause sign", () => {
    expect(menuBarStatus({ timer: { ...defaultTimer(S), phase: "short-break", running: true, endsAt: NOW + 4 * 60_000 }, settings: S, now: NOW }).title).toBe("☕ 4:00");
    const paused = menuBarStatus({ timer: { ...defaultTimer(S), running: false, endsAt: null, remaining: 600 }, settings: S, now: NOW });
    expect(paused.title).toBe("⏸ 10:00");
    expect(paused.timer).toMatchObject({ running: false, until: null });
    expect(paused.tooltip).toBe("ProdLi — Focus paused (10:00 left)");
    expect(paused.ticking).toBe(false);
  });

  it("a timer that was never started doesn't show", () => {
    expect(menuBarStatus({ timer: defaultTimer(S), settings: S, now: NOW }).timer).toBeNull();
  });

  it("shows the block that's on, the next one, and the top task (not the one on now)", () => {
    const todos = [
      todo("a", "Write the proposal", { plannedFor: DAY, block: { day: DAY, start: "09:45" }, estimateMin: 30 }),
      todo("b", "Team standup prep", { block: { day: DAY, start: "11:30" } }),
      todo("c", "Old done one", { completed: true, plannedFor: DAY }),
      todo("d", "Call the bank", { plannedFor: DAY }),
    ];
    const st = menuBarStatus({ todos, now: NOW });
    expect(st.now).toEqual({ title: "Write the proposal", left: "15:00", until: "10:15" });
    expect(st.next).toEqual({ title: "Team standup prep", at: "11:30", inMin: 90 });
    expect(st.top).toBe("Call the bank");
    expect(st.title).toBe("");
    expect(st.tooltip).toBe("ProdLi — Now: Write the proposal (15:00 left)");
    expect(st.ticking).toBe(true);
  });

  it("falls back to an overdue or due-today task when nothing is planned, and says what's next", () => {
    const st = menuBarStatus({ todos: [todo("x", "Later", { dueDate: "2026-12-01" }), todo("y", "Pay rent", { dueDate: "2026-11-20" }), todo("z", "Lunch", { block: { day: DAY, start: "12:30" } })], now: NOW });
    expect(st.top).toBe("Pay rent");
    expect(st.tooltip).toBe("ProdLi — Next: Lunch at 12:30");
    expect(st.ticking).toBe(false);
  });

  it("keeps long titles short", () => {
    expect(menuBarStatus({ todos: [todo("l", "x".repeat(80), { plannedFor: DAY })], now: NOW }).top).toHaveLength(40);
  });

  it("says how long until the next block", () => {
    expect(inMinutes(5)).toBe("in 5 min");
    expect(inMinutes(0)).toBe("in 1 min");
    expect(inMinutes(60)).toBe("in 1 h");
    expect(inMinutes(80)).toBe("in 1 h 20 min");
  });
});

describe("menu bar timer actions", () => {
  it("starts a fresh focus session of the usual length", () => {
    const t = startFocus(null, { ...S, workDuration: 50 }, NOW);
    expect(t).toMatchObject({ phase: "work", running: true, endsAt: NOW + 50 * 60_000 });
  });

  it("resumes a paused focus session, and switches from a break to focus", () => {
    expect(startFocus({ ...defaultTimer(S), remaining: 300 }, S, NOW)).toMatchObject({ running: true, endsAt: NOW + 300_000 });
    expect(startFocus({ ...defaultTimer(S), phase: "long-break", remaining: 200 }, S, NOW)).toMatchObject({ phase: "work", running: true, endsAt: NOW + 25 * 60_000 });
  });

  it("leaves a running timer alone, pauses, resumes and stops", () => {
    const running = startFocus(null, S, NOW);
    expect(startFocus(running, S, NOW + 1000)).toBe(running);
    const paused = pauseTimer(running, NOW + 60_000);
    expect(paused).toMatchObject({ running: false, endsAt: null, remaining: 24 * 60 });
    expect(resumeTimer(paused, NOW + 120_000)).toMatchObject({ running: true, endsAt: NOW + 120_000 + 24 * 60_000 });
    expect(stopTimer(paused, S)).toMatchObject({ phase: "work", running: false, remaining: 25 * 60 });
  });
});
