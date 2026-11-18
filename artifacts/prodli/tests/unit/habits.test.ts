import { describe, expect, it } from "vitest";
import { addAmount, bestStreak, currentStreak, dayLevel, isDone, isScheduled, progressLabel, setAmount, toggleCheck, toggleSkip } from "../../src/lib/habits";
import type { Habit } from "../../src/types";

const base: Habit = { id: "h", name: "Habit", emoji: "💪", color: "#FFD700", completedDays: [], createdAt: "2026-11-01T08:00:00.000Z", archived: false };
const today = "2026-11-18"; // Wednesday

describe("habits: check-off (as before)", () => {
  it("streaks count consecutive days and today doesn't break them until it's over", () => {
    const h = { ...base, completedDays: ["2026-11-15", "2026-11-16", "2026-11-17"] };
    expect(currentStreak(h, today)).toBe(3);
    expect(currentStreak(toggleCheck(h, today), today)).toBe(4);
    expect(currentStreak({ ...h, completedDays: ["2026-11-15"] }, today)).toBe(0);
    expect(bestStreak({ ...h, completedDays: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-10"] }, today)).toBe(3);
  });
});

describe("habits: chosen weekdays and skipped days", () => {
  const gym: Habit = { ...base, days: [1, 3, 5], completedDays: ["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16"] }; // Mon Wed Fri Mon
  it("other days never break the streak", () => {
    expect(isScheduled(gym, "2026-11-17")).toBe(false); // Tuesday
    expect(currentStreak(gym, today)).toBe(4); // Wed not done yet today
    expect(currentStreak(toggleCheck(gym, today), today)).toBe(5);
  });
  it("a skipped day doesn't break it either", () => {
    const missedFri = { ...gym, completedDays: ["2026-11-09", "2026-11-11", "2026-11-16"] };
    expect(currentStreak(missedFri, today)).toBe(1);
    expect(currentStreak(toggleSkip(missedFri, "2026-11-13"), today)).toBe(3);
  });
  it("days before the habit existed don't count", () => {
    expect(isScheduled(base, "2026-10-31")).toBe(false);
  });
});

describe("habits: count and timed", () => {
  const water: Habit = { ...base, kind: "count", target: 8, unit: "glasses" };
  it("counts as done at the target, and keeps completedDays in step", () => {
    let h = addAmount(water, today, 3);
    expect(isDone(h, today)).toBe(false);
    expect(progressLabel(h, today)).toBe("3/8 glasses");
    expect(dayLevel(h, today)).toBeCloseTo(0.375);
    h = addAmount(h, today, 5);
    expect(isDone(h, today)).toBe(true);
    expect(h.completedDays).toEqual([today]);
    h = addAmount(h, today, -1);
    expect(h.completedDays).toEqual([]);
    expect(setAmount(h, today, 0).log).toEqual({});
  });
  it("timed habits use minutes", () => {
    const read: Habit = { ...base, kind: "timed", target: 20 };
    expect(progressLabel(addAmount(read, today, 15), today)).toBe("15/20 min");
    expect(isDone(addAmount(read, today, 25), today)).toBe(true);
  });
});

describe("habits: quit", () => {
  const smoke: Habit = { ...base, kind: "quit", target: 0, createdAt: "2026-11-10T08:00:00.000Z" };
  it("days are kept until a slip, and the streak is days clean", () => {
    expect(isDone(smoke, today)).toBe(true);
    expect(currentStreak(smoke, today)).toBe(9); // 10th–18th
    const slipped = addAmount(smoke, "2026-11-15", 1);
    expect(isDone(slipped, "2026-11-15")).toBe(false);
    expect(currentStreak(slipped, today)).toBe(3);
    expect(bestStreak(slipped, today)).toBe(5);
    expect(progressLabel(slipped, "2026-11-15")).toBe("1 slip");
    expect(progressLabel(slipped, today)).toBe("clean");
    expect(slipped.completedDays).toEqual([]); // quit habits don't use completedDays
  });
  it("a limit above zero allows that many", () => {
    const coffee: Habit = { ...smoke, target: 2 };
    expect(isDone(addAmount(coffee, today, 2), today)).toBe(true);
    expect(isDone(addAmount(coffee, today, 3), today)).toBe(false);
    expect(progressLabel(addAmount(coffee, today, 1), today)).toBe("1 of max 2");
  });
});
