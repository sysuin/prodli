import { describe, expect, it } from "vitest";
import { agenda, autoSchedule, blockOrder, busy, conflicts, freeSlots, googleCalendarLink, toMin } from "../../src/lib/timeBlocks";
import type { CalendarEvent } from "../../src/lib/calendar";
import type { Todo } from "../../src/types";

const DAY = "2026-11-10";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, completed: false, plannedFor: DAY, createdAt: "", ...extra });
const ev = (id: string, start: string, end: string): CalendarEvent => ({ id, title: id, start, end, allDay: false });

describe("time blocks", () => {
  it("finds free time between events, with a buffer after each", () => {
    const slots = freeSlots(busy([ev("standup", "10:00", "10:15"), ev("lunch", "12:30", "13:30")], [], DAY), toMin("09:00"), toMin("18:00"));
    expect(slots).toEqual([
      { start: 540, end: 600 }, // 09:00–10:00
      { start: 620, end: 750 }, // 10:20–12:30
      { start: 815, end: 1080 }, // 13:35–18:00
    ]);
  });

  it("starts from now (rounded up to 5 minutes) and skips gaps under 10 minutes", () => {
    expect(freeSlots([{ start: 600, end: 615 }], 593, 628)).toEqual([]); // 9:55 → 10:00 (5 min), then 10:20–10:28 (8 min)
    expect(freeSlots([], 593, 700)).toEqual([{ start: 595, end: 700 }]);
  });

  it("orders overdue, due today, then by priority", () => {
    const order = blockOrder([todo("low", { priority: "low" }), todo("due", { dueDate: DAY }), todo("high", { priority: "high" }), todo("late", { dueDate: "2026-11-01" })], DAY).map((t) => t.id);
    expect(order).toEqual(["late", "due", "high", "low"]);
  });

  it("places tasks in the first gap that fits and reports what doesn't", () => {
    const tasks = [todo("write", { estimateMin: 90, priority: "high" }), todo("email", { estimateMin: 30 }), todo("huge", { estimateMin: 480 })];
    const plan = autoSchedule({ tasks, todos: tasks, events: [ev("standup", "10:00", "10:15")], day: DAY, workStart: "09:00", workEnd: "18:00", nowMin: toMin("08:00") });
    expect(plan.placed).toEqual({ write: "10:20", email: "09:00" });
    expect(plan.unplaced).toEqual(["huge"]);
  });

  it("keeps tasks already blocked and plans around them; done tasks aren't blocked", () => {
    const tasks = [todo("kept", { estimateMin: 60, block: { day: DAY, start: "09:00" } }), todo("new", { estimateMin: 30 }), todo("finished", { completed: true })];
    const plan = autoSchedule({ tasks, todos: tasks, events: [], day: DAY, workStart: "09:00", workEnd: "18:00", nowMin: 0 });
    expect(plan).toEqual({ placed: { new: "10:05" }, unplaced: [] });
  });

  it("ignores blocks from other days and flags overlaps", () => {
    const todos = [todo("old", { block: { day: "2026-11-09", start: "10:00" } }), todo("a", { block: { day: DAY, start: "10:00" } }), todo("b", { estimateMin: 15, block: { day: DAY, start: "11:00" } })];
    expect([...conflicts(todos, [ev("standup", "10:15", "10:30")], DAY)]).toEqual(["a"]);
    const items = agenda([ev("standup", "10:15", "10:30")], todos, DAY);
    expect(items.map((i) => (i.kind === "event" ? i.event.id : i.todo.id))).toEqual(["a", "standup", "b"]);
  });

  it("links to Google Calendar's prefilled event page", () => {
    const url = new URL(googleCalendarLink("Write the report", DAY, "23:30", 60, "Asia/Kolkata"));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ action: "TEMPLATE", text: "Write the report", dates: "20261110T233000/20261111T003000", ctz: "Asia/Kolkata" });
  });
});
