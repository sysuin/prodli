import { describe, expect, it } from "vitest";
import { afterLog, bestStreak, currentStreak, FREEZE_EVERY, freezesOf, MAX_FREEZES, momentText, settleAllFreezes, settleFreezes, toggleCheck } from "../../src/lib/habits";
import type { Habit } from "../../src/types";

const base: Habit = { id: "h", name: "Read", emoji: "📚", color: "#FFD700", completedDays: [], createdAt: "2026-11-01T08:00:00.000Z", archived: false };
const today = "2026-11-18";
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);

describe("streak freezes: earning", () => {
  it(`earns one every ${FREEZE_EVERY} days of streak, at most ${MAX_FREEZES}`, () => {
    const six = { ...base, completedDays: days(12, 17) };
    const { habit, moment } = afterLog(six, toggleCheck(six, today), today);
    expect(currentStreak(habit, today)).toBe(7);
    expect(freezesOf(habit)).toBe(1);
    expect(habit.freezeEarnedOn).toBe(today);
    expect(moment).toMatchObject({ streak: 7, earnedFreeze: true, milestone: true });
    const full = { ...six, freezes: MAX_FREEZES };
    expect(freezesOf(afterLog(full, toggleCheck(full, today), today).habit)).toBe(MAX_FREEZES);
  });
  it("unmarking the same day gives the freeze back; marking again earns it once", () => {
    const six = { ...base, completedDays: days(12, 17) };
    const marked = afterLog(six, toggleCheck(six, today), today).habit;
    const unmarked = afterLog(marked, toggleCheck(marked, today), today);
    expect(freezesOf(unmarked.habit)).toBe(0);
    expect(unmarked.habit.freezeEarnedOn).toBeUndefined();
    expect(unmarked.moment).toBeNull();
    const again = afterLog(unmarked.habit, toggleCheck(unmarked.habit, today), today).habit;
    expect(freezesOf(again)).toBe(1);
  });
  it("milestones without a freeze (3 days), and nothing on ordinary days", () => {
    const two = { ...base, completedDays: days(16, 17) };
    expect(afterLog(two, toggleCheck(two, today), today).moment).toMatchObject({ streak: 3, milestone: true, earnedFreeze: false });
    const three = { ...base, completedDays: days(15, 17) };
    expect(afterLog(three, toggleCheck(three, today), today).moment).toBeNull();
  });
  it("celebration text", () => {
    expect(momentText({ habitId: "h", name: "Read", emoji: "📚", streak: 7, earnedFreeze: true, milestone: true })).toEqual({
      title: "🔥 7-day streak!",
      detail: "A full week. Keep it rolling. You earned a 🧊 streak freeze: it covers a missed day automatically.",
    });
    expect(momentText({ habitId: "h", name: "No sugar", emoji: "🍬", streak: 30, earnedFreeze: false, milestone: true }, true).title).toBe("🛡 30 days kept!");
  });
});

describe("streak freezes: using them", () => {
  it("a missed day is covered and the streak keeps going", () => {
    const h = { ...base, freezes: 1, completedDays: [...days(10, 15), "2026-11-17"] }; // missed the 16th
    expect(currentStreak(h, today)).toBe(1);
    const s = settleFreezes(h, today);
    expect(s.frozen).toEqual(["2026-11-16"]);
    expect(freezesOf(s)).toBe(0);
    expect(currentStreak(s, today)).toBe(7);
    expect(bestStreak(s, today)).toBe(7);
  });
  it("two missed days need two freezes; with one, the streak just ends", () => {
    const h = { ...base, completedDays: days(10, 15) }; // missed 16th and 17th
    expect(settleFreezes({ ...h, freezes: 1 }, today)).toEqual({ ...h, freezes: 1 });
    const s = settleFreezes({ ...h, freezes: 2 }, today);
    expect(s.frozen).toEqual(["2026-11-16", "2026-11-17"]);
    expect(freezesOf(s)).toBe(0);
    expect(currentStreak(s, today)).toBe(6);
  });
  it("today isn't covered (it isn't over), and nothing happens without a streak to keep", () => {
    const doneYesterday = { ...base, freezes: 1, completedDays: ["2026-11-17"] };
    expect(settleFreezes(doneYesterday, today)).toBe(doneYesterday);
    const never = { ...base, freezes: 1 };
    expect(settleFreezes(never, today)).toBe(never);
  });
  it("covers a miss behind a check-in made on another device, but not with a freeze earned later", () => {
    const h = { ...base, freezes: 1, completedDays: [...days(10, 15), "2026-11-17"] }; // missed the 16th, then checked in
    expect(settleFreezes(h, today).frozen).toEqual(["2026-11-16"]);
    expect(settleFreezes({ ...h, freezeEarnedOn: "2026-11-17" }, today).frozen).toBeUndefined();
    const old = { ...base, freezes: 1, completedDays: [...days(5, 9), ...days(11, 17)] }; // the gap is behind 7 check-ins
    expect(settleFreezes(old, today)).toBe(old);
  });
  it("checking in on a covered day afterwards gives the freeze back", () => {
    const h = settleFreezes({ ...base, freezes: 1, completedDays: [...days(10, 15), "2026-11-17"] }, today);
    const back = toggleCheck(h, "2026-11-16");
    expect(back.frozen).toEqual([]);
    expect(freezesOf(back)).toBe(1);
    expect(currentStreak(back, today)).toBe(8);
  });
  it("settling is idempotent and only reports lists that changed", () => {
    const h = { ...base, freezes: 2, completedDays: [...days(10, 15), "2026-11-17"] };
    const once = settleAllFreezes([h, base], today)!;
    expect(once).not.toBeNull();
    expect(settleAllFreezes(once, today)).toBeNull();
    expect(freezesOf(once[0])).toBe(1);
  });
  it("days off the habit's weekdays aren't 'missed'", () => {
    const gym: Habit = { ...base, days: [1, 3, 5], freezes: 1, completedDays: ["2026-11-09", "2026-11-11", "2026-11-13"] }; // missed Mon 16th
    const s = settleFreezes(gym, today);
    expect(s.frozen).toEqual(["2026-11-16"]);
    expect(currentStreak(s, today)).toBe(3);
  });
});
