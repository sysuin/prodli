import { describe, expect, it } from "vitest";
import { plannedReminders } from "../../src/lib/reminderPlan";
import type { Todo } from "../../src/shared";

const T = (p: Partial<Todo>): Todo => ({ id: "x", title: "t", completed: false, createdAt: "2026-11-01T00:00:00.000Z", ...p });

describe("phone reminders", () => {
  it("schedules open to-dos with a future time, soonest first, capped", () => {
    const now = new Date(2026, 10, 20, 12, 0).getTime();
    const todos = [
      T({ id: "late", title: "Later", dueDate: "2026-11-21", dueTime: "09:00" }),
      T({ id: "soon", title: "Call Sam", dueDate: "2026-11-20", dueTime: "15:00", priority: "high" }),
      T({ id: "past", dueDate: "2026-11-20", dueTime: "08:00" }),
      T({ id: "done", dueDate: "2026-11-20", dueTime: "18:00", completed: true }),
      T({ id: "notime", dueDate: "2026-11-20" }),
    ];
    const plan = plannedReminders(todos, now);
    expect(plan.map((p) => p.todoId)).toEqual(["soon", "late"]);
    expect(plan[0].body).toMatch(/high priority/);
    expect(plan[0].id).toBe(`todo:soon:${new Date(2026, 10, 20, 15, 0).getTime()}`);
    expect(plannedReminders(todos, now, 1)).toHaveLength(1);
  });
});
