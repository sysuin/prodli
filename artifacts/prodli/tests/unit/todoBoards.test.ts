import { describe, expect, it } from "vitest";
import { boardColumn, describeMove, isUrgent, moveToColumn, moveToQuadrant, quadrant } from "../../src/lib/todoBoards";
import type { Todo } from "../../src/types";

const TODAY = "2026-11-20";
const t = (extra: Partial<Todo> = {}): Todo => ({ id: "x", title: "Task", completed: false, createdAt: "", ...extra });

describe("board columns", () => {
  it("places tasks by date, plan and done", () => {
    expect(boardColumn(t(), TODAY)).toBe("nodate");
    expect(boardColumn(t({ dueDate: "2026-11-25" }), TODAY)).toBe("upcoming");
    expect(boardColumn(t({ dueDate: "2026-11-20" }), TODAY)).toBe("today");
    expect(boardColumn(t({ dueDate: "2026-11-10" }), TODAY)).toBe("today"); // overdue
    expect(boardColumn(t({ dueDate: "2026-11-25", plannedFor: TODAY }), TODAY)).toBe("today");
    expect(boardColumn(t({ completed: true, dueDate: "2026-11-20" }), TODAY)).toBe("done");
  });

  it("moves tasks between columns", () => {
    expect(moveToColumn(t(), "today", TODAY)).toEqual({ plannedFor: TODAY });
    expect(moveToColumn(t(), "upcoming", TODAY)).toMatchObject({ dueDate: "2026-11-21", plannedFor: undefined });
    expect(moveToColumn(t({ dueDate: "2026-11-30", plannedFor: TODAY }), "upcoming", TODAY)).toMatchObject({ dueDate: "2026-11-30", plannedFor: undefined });
    expect(moveToColumn(t({ dueDate: "2026-11-25", dueTime: "09:00" }), "nodate", TODAY)).toMatchObject({ dueDate: undefined, dueTime: undefined });
    expect(moveToColumn(t({ dueDate: "2026-11-25" }), "upcoming", TODAY)).toBeNull(); // already there
    expect(moveToColumn(t(), "done", TODAY)).toBeNull(); // completing is the caller's normal toggle
  });
});

describe("Eisenhower matrix", () => {
  it("sorts by importance (high priority) and urgency", () => {
    expect(quadrant(t({ priority: "high", dueDate: TODAY }), TODAY)).toBe("do");
    expect(quadrant(t({ priority: "high", dueDate: "2026-11-30" }), TODAY)).toBe("schedule");
    expect(quadrant(t({ priority: "low", plannedFor: TODAY }), TODAY)).toBe("quick");
    expect(quadrant(t({ priority: "medium" }), TODAY)).toBe("later");
    expect(isUrgent(t({ dueDate: "2026-11-21" }), TODAY)).toBe(true); // tomorrow counts
    expect(isUrgent(t({ dueDate: "2026-11-22" }), TODAY)).toBe(false);
  });

  it("moves tasks between quadrants by changing priority or timing", () => {
    expect(moveToQuadrant(t(), "do", TODAY)).toEqual({ priority: "high", plannedFor: TODAY });
    expect(moveToQuadrant(t({ priority: "high", plannedFor: TODAY, dueDate: TODAY }), "schedule", TODAY)).toMatchObject({ plannedFor: undefined, dueDate: "2026-11-27" });
    expect(moveToQuadrant(t({ priority: "high", dueDate: "2026-11-30" }), "later", TODAY)).toEqual({ priority: "medium" });
    expect(moveToQuadrant(t({ priority: "high", dueDate: TODAY }), "do", TODAY)).toBeNull();
  });

  it("describes a move in plain words", () => {
    expect(describeMove(t({ title: "Call Sam" }), { priority: "high", plannedFor: TODAY }, TODAY)).toBe("Call Sam: high priority, planned for today.");
    expect(describeMove(t({ title: "Call Sam" }), { dueDate: "2026-11-21" }, TODAY)).toBe("Call Sam: due tomorrow.");
  });
});
