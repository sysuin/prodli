import { describe, expect, it } from "vitest";
import { applyPull, blockFromEvent, eventBody, eventIdFor, planSync, type GEvent } from "../../src/lib/calendarSync";
import type { Todo } from "../../src/types";

const now = new Date(2026, 10, 23, 8, 0);
const day = "2026-11-23";
const iso = (h: number, m = 0, d = 23) => new Date(2026, 10, d, h, m).toISOString();
const todo = (id: string, start: string | null, extra: Partial<Todo> = {}): Todo => ({ id, title: id, completed: false, createdAt: iso(7), updatedAt: iso(7), ...(start ? { block: { day, start } } : {}), estimateMin: 30, ...extra });
const event = (t: Todo, extra: Partial<GEvent> = {}): GEvent => {
  const b = eventBody(t, "UTC");
  return { id: b.id, summary: b.summary, start: { dateTime: b.start.dateTime }, end: { dateTime: b.end.dateTime }, updated: iso(7, 30), extendedProperties: b.extendedProperties, status: "confirmed", ...extra };
};

describe("two-way time blocks", () => {
  it("makes valid Google event ids and reads blocks back", () => {
    expect(eventIdFor("abc-1")).toMatch(/^pl[0-9a-v]+$/);
    const t = todo("t", "09:30", { estimateMin: 45 });
    expect(blockFromEvent(event(t))).toEqual({ day, start: "09:30", minutes: 45 });
  });

  it("creates events for new blocks and leaves matching ones alone", () => {
    const a = todo("a", "09:00");
    const b = todo("b", "10:00");
    const plan = planSync([a, b], [event(a)], now);
    expect(plan.create.map((t) => t.id)).toEqual(["b"]);
    expect(plan.update).toEqual([]);
    expect(plan.pull).toEqual([]);
  });

  it("pushes ProdLi changes made after the event, pulls Google changes made after the task", () => {
    const moved = todo("moved", "11:00", { updatedAt: iso(7, 45) }); // moved in ProdLi after the event was written
    const movedEvent = event(todo("moved", "09:00"));
    const g = todo("g", "09:00");
    const gEvent = { ...event(todo("g", "14:15", { estimateMin: 60 })), updated: iso(7, 50) }; // moved in Google later
    const plan = planSync([moved, g], [movedEvent, gEvent], now);
    expect(plan.update.map((t) => t.id)).toEqual(["moved"]);
    expect(plan.pull).toEqual([{ todoId: "g", block: { day, start: "14:15" }, estimateMin: 60 }]);
  });

  it("unblocks a task whose event was deleted in Google; removes events for unblocked or deleted tasks", () => {
    const kept = todo("kept", "09:00");
    const unblocked = todo("unblocked", null);
    const deleted = todo("deleted", "09:00");
    const done = todo("done", "08:00", { completed: true });
    const plan = planSync(
      [kept, unblocked, done],
      [{ ...event(kept), status: "cancelled", updated: iso(7, 59) }, event(todo("unblocked", "10:00")), event(deleted), event(done)],
      now,
    );
    expect(plan.pull).toEqual([{ todoId: "kept", block: null }]);
    expect(plan.remove.sort()).toEqual([eventIdFor("deleted"), eventIdFor("unblocked")].sort());
  });

  it("only syncs today and the next 7 days", () => {
    const far = todo("far", null, { block: { day: "2026-12-10", start: "09:00" } });
    const past = todo("past", null, { block: { day: "2026-11-20", start: "09:00" } });
    expect(planSync([far, past], [], now).create).toEqual([]);
  });

  it("applies Google changes to the to-do list", () => {
    const list = [todo("a", "09:00"), todo("b", "10:00")];
    const out = applyPull(list, [{ todoId: "a", block: { day, start: "13:00" }, estimateMin: 50 }, { todoId: "b", block: null }], now);
    expect(out[0]).toMatchObject({ block: { day, start: "13:00" }, estimateMin: 50 });
    expect(out[1].block).toBeUndefined();
    expect(out[1].updatedAt).toBe(now.toISOString());
  });
});
