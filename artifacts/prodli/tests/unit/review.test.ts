import { describe, expect, it } from "vitest";
import { addDays, basicReview, defaultReviewWeek, reviewContext, reviewDue, weekStart, weekStats, writeReview } from "../../src/lib/review";
import type { DayRecord, Habit, Note, Todo } from "../../src/types";
import type { Meeting } from "../../src/recorder/types";

const todo = (title: string, extra: Partial<Todo> = {}): Todo => ({ id: title, title, completed: false, createdAt: "2026-10-20T10:00:00.000Z", ...extra });
const done = (title: string, day: string, extra: Partial<Todo> = {}) => todo(title, { completed: true, completedAt: new Date(`${day}T15:00:00`).toISOString(), ...extra });
const habit = (name: string, days: string[], createdAt = ""): Habit => ({ id: name, name, emoji: "💧", color: "#000", completedDays: days, createdAt, archived: false });

describe("weekly review: weeks", () => {
  it("weeks start on Monday", () => {
    expect(weekStart(new Date(2026, 10, 10))).toBe("2026-11-09"); // Tue
    expect(weekStart(new Date(2026, 10, 15))).toBe("2026-11-09"); // Sun
    expect(weekStart(new Date(2026, 10, 16))).toBe("2026-11-16"); // Mon
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("reviews this week from Friday, last week before that", () => {
    expect(defaultReviewWeek(new Date(2026, 10, 13, 18))).toBe("2026-11-09"); // Fri
    expect(defaultReviewWeek(new Date(2026, 10, 15, 10))).toBe("2026-11-09"); // Sun
    expect(defaultReviewWeek(new Date(2026, 10, 16, 9))).toBe("2026-11-09"); // Mon → last week
    expect(defaultReviewWeek(new Date(2026, 10, 11, 9))).toBe("2026-11-02"); // Wed → last week
  });

  it("nudges Friday afternoon to Monday until the week is reviewed", () => {
    expect(reviewDue([], new Date(2026, 10, 13, 10))).toBeNull(); // Fri morning
    expect(reviewDue([], new Date(2026, 10, 13, 16))).toBe("2026-11-09");
    expect(reviewDue([], new Date(2026, 10, 16, 9))).toBe("2026-11-09");
    expect(reviewDue([], new Date(2026, 10, 17, 9))).toBeNull(); // Tue
    const reviewed: DayRecord[] = [{ id: "2026-11-09", createdAt: "", review: basicReview(weekStats({ start: "2026-11-09", today: "2026-11-15", todos: [], habits: [], days: [], sessions: [], tracking: {}, meetings: [], notes: [] })) }];
    expect(reviewDue(reviewed, new Date(2026, 10, 15, 10))).toBeNull();
  });
});

describe("weekly review: the numbers", () => {
  const base = {
    start: "2026-11-02",
    today: "2026-11-08",
    todos: [
      done("Write release notes", "2026-11-03", { priority: "high" }),
      done("Fix login bug", "2026-11-03"),
      done("Old thing", "2026-10-28"),
      todo("Reply to Priya", { dueDate: "2026-11-05", priority: "high" }),
      todo("Plan offsite", { plannedFor: "2026-11-06" }),
      todo("Someday", { dueDate: "2026-12-01" }),
      todo("New this week", { createdAt: "2026-11-04T09:00:00.000Z" }),
    ],
    habits: [habit("Water", ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]), habit("Run", ["2026-11-07"], "2026-11-06T08:00:00.000Z")],
    days: [{ id: "2026-11-03", createdAt: "", focus: "Ship the release", reflection: "Good day" }] as DayRecord[],
    sessions: [{ completedAt: new Date(2026, 10, 3, 11).toISOString(), duration: 25 }, { completedAt: new Date(2026, 10, 3, 14).toISOString(), duration: 50 }, { completedAt: new Date(2026, 9, 30, 14).toISOString(), duration: 25 }],
    tracking: { "2026-11-02": { "github.com": 3600, "x.com": 1200 }, "2026-11-03": { "github.com": 1800 } },
    meetings: [{ id: "m", title: "Standup", startedAt: new Date(2026, 10, 4, 10).toISOString(), durationSec: 900, summary: { title: "Standup", overview: "", keyPoints: [], decisions: [], actionItems: [{ task: "Send the deck", owner: null, dueDate: null }, { task: "Fix login bug", owner: null, dueDate: null }], openQuestions: [] } } as unknown as Meeting],
    notes: [{ id: "n", title: "x", content: "", createdAt: "2026-11-04T09:00:00.000Z", updatedAt: "2026-11-05T09:00:00.000Z" }] as Note[],
  };

  it("counts what was done, what slipped, focus, habits, browsing and meetings", () => {
    const s = weekStats(base);
    expect(s.done.map((t) => t.title)).toEqual(["Write release notes", "Fix login bug"]);
    expect(s.slipped.map((t) => t.title)).toEqual(["Reply to Priya", "Plan offsite"]);
    expect(s.added).toBe(1);
    expect(s.perDay[1]).toEqual({ day: "2026-11-03", done: 2, focusMin: 75 });
    expect(s.focus).toEqual({ sessions: 2, minutes: 75 });
    expect(s.habits).toEqual([
      { id: "Water", name: "Water", emoji: "💧", done: 5, of: 7 },
      { id: "Run", name: "Run", emoji: "💧", done: 1, of: 3 }, // created Friday: counts Fri–Sun only
    ]);
    expect(s.browsing).toEqual({ minutes: 110, topSites: [{ site: "github.com", minutes: 90 }, { site: "x.com", minutes: 20 }] });
    expect(s.meetings).toMatchObject({ count: 1, minutes: 15, openActions: ["Send the deck"] }); // "Fix login bug" is already a to-do
    expect(s.notes).toEqual({ created: 1, edited: 0 });
    expect(s.focuses).toEqual([{ day: "2026-11-03", text: "Ship the release" }]);
  });

  it("mid-week only counts the days so far", () => {
    const s = weekStats({ ...base, today: "2026-11-04" });
    expect(s.daysSoFar).toBe(3);
    expect(s.slipped.map((t) => t.title)).toEqual([]); // nothing was due by Wednesday
    expect(s.habits[0]).toMatchObject({ done: 3, of: 3 });
  });

  it("a basic review without AI picks next week's priorities from what slipped", () => {
    const r = basicReview(weekStats(base));
    expect(r.headline).toBe("2 tasks done this week");
    expect(r.nextWeek.map((p) => p.title)).toEqual(["Reply to Priya", "Plan offsite", "Send the deck"]);
    expect(r.wins[0]).toMatch(/Finished 2 tasks, including 1 high priority/);
    expect(r.patterns.join(" ")).toMatch(/Tuesday/);
    expect(r.source).toBe("basic");
  });

  it("sends the server a trimmed context with the user's note", () => {
    const ctx = reviewContext(weekStats(base), "  Too many meetings  ");
    expect(ctx).toMatchObject({ weekStart: "2026-11-02", weekEnd: "2026-11-08", userNote: "Too many meetings" });
    expect(ctx.done[0]).toEqual({ title: "Write release notes", day: "2026-11-03", priority: "high" });
    expect(JSON.stringify(ctx)).not.toContain('"id"');
  });

  it("falls back to the basic review when not signed in", async () => {
    const r = await writeReview(weekStats(base));
    expect(r.fallbackReason).toBe("signed_out");
    expect(r.review.source).toBe("basic");
  });
});
