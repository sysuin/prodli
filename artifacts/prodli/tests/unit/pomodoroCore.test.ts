import { describe, expect, it } from "vitest";
import {
  completeIfDue,
  DEFAULT_POMODORO_SETTINGS,
  defaultTimer,
  loadPomodoro,
  nextPhaseAfter,
  pause,
  saveTimer,
  secondsLeftOf,
  start,
  withPhase,
} from "../../src/lib/pomodoroCore";
import { storageSet } from "../../src/lib/storage";

const S = DEFAULT_POMODORO_SETTINGS;

describe("timer math", () => {
  it("counts down from an end time and pauses with the time left", () => {
    const t0 = 1_000_000;
    const running = start(defaultTimer(S), t0);
    expect(running.running).toBe(true);
    expect(secondsLeftOf(running, t0)).toBe(25 * 60);
    expect(secondsLeftOf(running, t0 + 61_000)).toBe(25 * 60 - 61);
    const paused = pause(running, t0 + 61_000);
    expect(paused).toMatchObject({ running: false, endsAt: null, remaining: 25 * 60 - 61 });
    // Paused time doesn't move.
    expect(secondsLeftOf(paused, t0 + 999_999)).toBe(25 * 60 - 61);
    // Resuming continues from where it paused.
    expect(secondsLeftOf(start(paused, t0 + 100_000), t0 + 100_000)).toBe(25 * 60 - 61);
  });

  it("never goes below zero", () => {
    const running = start(defaultTimer(S), 0);
    expect(secondsLeftOf(running, 99 * 60_000)).toBe(0);
  });

  it("picks a long break after every 4th focus session", () => {
    expect(nextPhaseAfter("work", 0, S)).toEqual({ next: "short-break", completedAfter: 1 });
    expect(nextPhaseAfter("work", 3, S)).toEqual({ next: "long-break", completedAfter: 4 });
    expect(nextPhaseAfter("short-break", 1, S)).toEqual({ next: "work", completedAfter: 1 });
  });

  it("resets the time when the phase changes", () => {
    expect(withPhase(start(defaultTimer(S), 0), "long-break", S)).toMatchObject({ phase: "long-break", running: false, remaining: 15 * 60 });
  });
});

describe("completeIfDue", () => {
  it("does nothing while time is left", async () => {
    await saveTimer(start(defaultTimer(S), Date.now()));
    expect(await completeIfDue()).toBeNull();
    expect((await loadPomodoro()).timer.phase).toBe("work");
  });

  it("records the focus session, counts it and moves to the break", async () => {
    const now = Date.now();
    await saveTimer({ ...start(defaultTimer(S), now - 26 * 60_000), label: "Write spec" });
    expect(await completeIfDue(now)).toBe("work");
    const after = await loadPomodoro();
    expect(after.completed).toBe(1);
    expect(after.sessions[0]).toMatchObject({ label: "Write spec", duration: 25 });
    expect(after.timer).toMatchObject({ phase: "short-break", running: false, remaining: 5 * 60, lastCompletedPhase: "work", lastCompletedAt: now });
    // Calling again (e.g. alarm + tab nudge) doesn't double-count.
    expect(await completeIfDue(now + 10)).toBeNull();
    expect((await loadPomodoro()).completed).toBe(1);
  });

  it("starts a long break after the 4th session and keeps at most 20 sessions", async () => {
    await storageSet("completedPomodoros", 3);
    await storageSet(
      "pomodoroSessions",
      Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: "old", completedAt: "", duration: 25 })),
    );
    const now = Date.now();
    await saveTimer(start(defaultTimer(S), now - 30 * 60_000));
    await completeIfDue(now);
    const after = await loadPomodoro();
    expect(after.timer.phase).toBe("long-break");
    expect(after.sessions).toHaveLength(20);
    expect(after.sessions[0].label).toBe("Focus session");
  });

  it("a finished break goes back to focus without recording a session", async () => {
    const now = Date.now();
    await saveTimer(start(withPhase(defaultTimer(S), "short-break", S), now - 6 * 60_000));
    expect(await completeIfDue(now)).toBe("short-break");
    const after = await loadPomodoro();
    expect(after.timer.phase).toBe("work");
    expect(after.sessions).toHaveLength(0);
    expect(after.completed).toBe(0);
  });
});
