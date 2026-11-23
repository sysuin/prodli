import { describe, expect, it } from "vitest";
import { countdown, currentBlock, nextBlock } from "../../src/lib/nowBlock";
import { nagAgain, NAG_FOR_MS } from "../../src/lib/todayBackground";
import type { Todo } from "../../src/types";

const day = "2026-11-23";
const task = (id: string, start: string, estimateMin?: number, extra: Partial<Todo> = {}): Todo => ({ id, title: id, completed: false, createdAt: "", block: { day, start }, estimateMin, ...extra });

describe("Now card", () => {
  const todos = [task("write", "09:00", 60), task("email", "10:30"), task("other-day", "09:30", 60, { block: { day: "2026-11-22", start: "09:30" } }), task("done", "09:15", 30, { completed: true })];

  it("finds the block that's on and the next one", () => {
    expect(currentBlock(todos, day, 9 * 60 + 20)?.todo.id).toBe("write");
    expect(currentBlock(todos, day, 10 * 60)?.todo.id).toBeUndefined();
    expect(nextBlock(todos, day, 10 * 60)?.todo.id).toBe("email");
    expect(nextBlock(todos, day, 9 * 60 + 20)?.todo.id).toBe("email");
    expect(currentBlock(todos, day, 10 * 60 + 45)?.slot).toEqual({ start: 630, end: 660 });
  });

  it("formats the countdown", () => {
    expect(countdown(12 * 60_000 + 5000)).toBe("12:05");
    expect(countdown(3_725_000)).toBe("1:02:05");
    expect(countdown(-5)).toBe("0:00");
  });

  it("keeps reminding for up to 2 hours after the task's time", () => {
    const at = Date.parse("2026-11-23T09:00:00Z");
    expect(nagAgain(at, at)).toBe(true);
    expect(nagAgain(at, at + NAG_FOR_MS - 11 * 60_000)).toBe(true);
    expect(nagAgain(at, at + NAG_FOR_MS)).toBe(false);
    expect(nagAgain(null, at)).toBe(false);
  });
});
