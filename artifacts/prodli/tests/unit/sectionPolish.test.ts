import { describe, expect, it } from "vitest";
import { groupByDate } from "../../src/sections/TodoSection";
import { calculateBestStreak } from "../../src/sections/HabitSection";
import { notePreview } from "../../src/sections/editor/NoteList";
import { compareToUsual } from "../../src/sections/tracker/data";
import { briefBasis } from "../../src/lib/today";
import type { Todo } from "../../src/types";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, completed: false, createdAt: "", ...extra });

describe("To-Dos: by date", () => {
  it("groups open tasks into overdue, today, tomorrow, next 7 days, later and no date", () => {
    const groups = groupByDate(
      [
        todo("someday"),
        todo("late", { dueDate: "2026-11-08" }),
        todo("planned", { plannedFor: "2026-11-10" }),
        todo("due-today", { dueDate: "2026-11-10", priority: "high" }),
        todo("tmr", { dueDate: "2026-11-11" }),
        todo("fri", { dueDate: "2026-11-13" }),
        todo("dec", { dueDate: "2026-12-20" }),
        todo("rolled-over", { plannedFor: "2026-11-09" }),
      ],
      "2026-11-10",
    );
    expect(groups.map((g) => [g.id, g.items.map((t) => t.id)])).toEqual([
      ["overdue", ["late"]],
      ["today", ["planned", "rolled-over", "due-today"]],
      ["tomorrow", ["tmr"]],
      ["week", ["fri"]],
      ["later", ["dec"]],
      ["none", ["someday"]],
    ]);
  });
});

describe("Habits: best streak", () => {
  it("finds the longest run of consecutive days", () => {
    expect(calculateBestStreak([])).toBe(0);
    expect(calculateBestStreak(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"])).toBe(3);
    expect(calculateBestStreak(["2026-10-31", "2026-11-01", "2026-11-01"])).toBe(2); // across months, duplicates ignored
  });
});

describe("Notes: list preview", () => {
  it("shows the text after the title line", () => {
    expect(notePreview({ id: "n", title: "Q4 planning", content: "<h1>Q4 planning</h1><p>Goals for the quarter:</p><ul><li><p>Ship 1.4</p></li></ul>", createdAt: "", updatedAt: "" })).toBe("Goals for the quarter: · Ship 1.4");
    expect(notePreview({ id: "n", title: "x", content: `<p>${"word ".repeat(40)}</p>`, createdAt: "", updatedAt: "" }).endsWith("…")).toBe(true);
  });
});

describe("Time Tracker: vs your usual day", () => {
  it("compares today with the average of earlier days that have data", () => {
    expect(compareToUsual(3600, [1800, 0, 3600, 2700])).toEqual({ average: 2700, percent: 33 });
    expect(compareToUsual(1000, [0, 0])).toBeNull();
  });
});

describe("Today: out-of-date brief", () => {
  it("changes when today's tasks or events change, not when unrelated tasks do", () => {
    const base = [todo("a", { plannedFor: "2026-11-10" }), todo("b")];
    const before = briefBasis(base, [], "2026-11-10");
    expect(briefBasis([...base, todo("c")], [], "2026-11-10")).toBe(before); // unrelated, undated task
    expect(briefBasis([todo("a", { plannedFor: "2026-11-10", completed: true }), todo("b")], [], "2026-11-10")).not.toBe(before);
    expect(briefBasis(base, [{ id: "e", title: "Standup", start: "10:00", end: "10:15", allDay: false }], "2026-11-10")).not.toBe(before);
  });
});
