import { describe, expect, it } from "vitest";
import { clampStart, columns, dayRange, nextFreeStart, snap } from "../../src/lib/timeBlocks";
import type { CalendarEvent } from "../../src/lib/calendar";
import type { Todo } from "../../src/types";

const DAY = "2026-11-19";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, completed: false, createdAt: "", ...extra });
const ev = (id: string, start: string, end: string): CalendarEvent => ({ id, title: id, start, end, allDay: false });

describe("day view: time maths", () => {
  it("snaps to 15 minutes", () => {
    expect([snap(7), snap(8), snap(52), snap(600)]).toEqual([0, 15, 45, 600]);
  });

  it("shows the working day, stretched to whole hours around events and blocks", () => {
    expect(dayRange([], "09:00", "18:00")).toEqual({ start: 540, end: 1080 });
    expect(dayRange([{ start: 7 * 60 + 30, end: 8 * 60 }, { start: 18 * 60 + 15, end: 19 * 60 + 10 }], "09:00", "18:00")).toEqual({ start: 420, end: 1200 });
    expect(dayRange([], "09:00", "09:00")).toEqual({ start: 540, end: 600 }); // at least an hour
  });

  it("keeps a dragged block inside the day", () => {
    const range = { start: 540, end: 1080 };
    expect(clampStart(500, 30, range)).toBe(540);
    expect(clampStart(1070, 30, range)).toBe(1050);
    expect(clampStart(608, 30, range)).toBe(615);
  });

  it("puts overlapping items side by side", () => {
    const laid = columns([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 630 },
      { id: "c", start: 600, end: 660 },
      { id: "d", start: 700, end: 730 },
    ]);
    const by = Object.fromEntries(laid.map((l) => [l.item.id, [l.col, l.cols]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });

  it("finds the next free time for one task (keyboard placing)", () => {
    const events = [ev("standup", "09:00", "09:30")];
    const todos = [todo("x", { block: { day: DAY, start: "09:35" }, estimateMin: 60 }), todo("new", { estimateMin: 30 })];
    expect(nextFreeStart(todos[1], todos, events, DAY, "09:00", "18:00", 0)).toBe("10:40");
    // Re-placing a task ignores its own block.
    expect(nextFreeStart(todos[0], todos, events, DAY, "09:00", "18:00", 0)).toBe("09:35");
    expect(nextFreeStart(todo("huge", { estimateMin: 600 }), [], [], DAY, "09:00", "18:00", 0)).toBeNull();
  });
});
