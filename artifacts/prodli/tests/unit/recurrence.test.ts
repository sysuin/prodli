import { describe, expect, it } from "vitest";
import { firstOccurrence, nextDue, nextOccurrence, reminderAt, repeatLabel, toggleTodo } from "../../src/lib/recurrence";
import { parseTask } from "../../src/lib/taskParse";
import { withRepeat } from "../../src/sections/todo/TaskDetails";
import type { Todo } from "../../src/types";

describe("repeating to-dos: next dates", () => {
  it("steps by days, weeks, months and years", () => {
    expect(nextOccurrence("2026-11-18", { unit: "day", every: 1 })).toBe("2026-11-19");
    expect(nextOccurrence("2026-11-18", { unit: "day", every: 3 })).toBe("2026-11-21");
    expect(nextOccurrence("2026-11-18", { unit: "week", every: 2 })).toBe("2026-12-02");
    expect(nextOccurrence("2026-12-15", { unit: "month", every: 1 })).toBe("2027-01-15");
    expect(nextOccurrence("2026-11-18", { unit: "year", every: 1 })).toBe("2027-11-18");
  });

  it("keeps month-end dates sensible", () => {
    const r = { unit: "month" as const, every: 1, monthDay: 31 };
    expect(nextOccurrence("2027-01-31", r)).toBe("2027-02-28");
    expect(nextOccurrence("2027-02-28", r)).toBe("2027-03-31");
    expect(nextOccurrence("2028-02-29", { unit: "year", every: 1, monthDay: 29 })).toBe("2029-02-28");
  });

  it("repeats on chosen weekdays, also every other week", () => {
    const mwf = { unit: "week" as const, every: 1, weekdays: [1, 3, 5] };
    expect(nextOccurrence("2026-11-16", mwf)).toBe("2026-11-18"); // Mon → Wed
    expect(nextOccurrence("2026-11-20", mwf)).toBe("2026-11-23"); // Fri → Mon
    const weekdays = { unit: "week" as const, every: 1, weekdays: [1, 2, 3, 4, 5] };
    expect(nextOccurrence("2026-11-20", weekdays)).toBe("2026-11-23");
    const biweeklyTue = { unit: "week" as const, every: 2, weekdays: [2] };
    expect(nextOccurrence("2026-11-17", biweeklyTue)).toBe("2026-12-01");
  });

  it("skips missed dates instead of piling up overdue copies", () => {
    expect(nextDue({ dueDate: "2026-11-01", repeat: { unit: "day", every: 1 } }, "2026-11-18")).toBe("2026-11-18");
    expect(nextDue({ dueDate: "2026-11-18", repeat: { unit: "day", every: 1 } }, "2026-11-18")).toBe("2026-11-19");
    expect(nextDue({ repeat: { unit: "week", every: 1 } }, "2026-11-18")).toBe("2026-11-25");
  });

  it("starts on the first matching day", () => {
    expect(firstOccurrence({ unit: "week", every: 1, weekdays: [1] }, "2026-11-18")).toBe("2026-11-23");
    expect(firstOccurrence({ unit: "week", every: 1, weekdays: [3] }, "2026-11-18")).toBe("2026-11-18");
    expect(firstOccurrence({ unit: "day", every: 1 }, "2026-11-18")).toBe("2026-11-18");
  });

  it("describes the rule", () => {
    expect(repeatLabel({ unit: "day", every: 1 })).toBe("Every day");
    expect(repeatLabel({ unit: "week", every: 2 })).toBe("Every 2 weeks");
    expect(repeatLabel({ unit: "week", every: 1, weekdays: [5, 1] })).toBe("Every Mon, Fri");
    expect(repeatLabel({ unit: "week", every: 1, weekdays: [1, 2, 3, 4, 5] })).toBe("Every weekdays");
  });
});

describe("repeating to-dos: completing", () => {
  const now = new Date(2026, 10, 18, 10, 0);
  const base: Todo = { id: "a", title: "Water plants", completed: false, dueDate: "2026-11-18", dueTime: "09:00", repeat: { unit: "week", every: 1 }, plannedFor: "2026-11-18", subtasks: [{ id: "s", title: "Balcony", completed: true }], createdAt: "2026-11-01T00:00:00.000Z" };

  it("moves the task to its next date and keeps a done copy", () => {
    const list = toggleTodo([base, { id: "b", title: "Other", completed: false, createdAt: "x" }], "a", now);
    expect(list).toHaveLength(3);
    const [next, done, other] = list;
    expect(next).toMatchObject({ id: "a", completed: false, dueDate: "2026-11-25", dueTime: "09:00", plannedFor: undefined, repeat: { unit: "week", every: 1 } });
    expect(next.subtasks?.[0].completed).toBe(false);
    expect(done).toMatchObject({ title: "Water plants", completed: true, dueDate: "2026-11-18", repeat: undefined });
    expect(done.id).not.toBe("a");
    expect(done.completedAt).toBe(now.toISOString());
    expect(other.id).toBe("b");
  });

  it("toggles one-off tasks as before", () => {
    const once = { ...base, repeat: undefined };
    const [t] = toggleTodo([once], "a", now);
    expect(t).toMatchObject({ completed: true, completedAt: now.toISOString() });
    expect(toggleTodo([t], "a", now)[0]).toMatchObject({ completed: false, completedAt: undefined });
  });

  it("knows when the reminder is due", () => {
    expect(reminderAt(base)).toBe(new Date(2026, 10, 18, 9, 0).getTime());
    expect(reminderAt({ ...base, dueTime: undefined })).toBeNull();
    expect(reminderAt({ ...base, completed: true })).toBeNull();
  });
});

describe("quick add: repeats and times", () => {
  const now = new Date(2026, 10, 18, 10, 0); // Wednesday 18 Nov 2026, 10:00
  it("understands repeat phrases", () => {
    expect(parseTask("Standup every weekday at 9:30am", now)).toMatchObject({ title: "Standup", repeat: { unit: "week", weekdays: [1, 2, 3, 4, 5] }, dueTime: "09:30", dueDate: "2026-11-18" });
    expect(parseTask("Gym every monday and thursday", now)).toMatchObject({ title: "Gym", repeat: { unit: "week", every: 1, weekdays: [1, 4] }, dueDate: "2026-11-19" });
    expect(parseTask("Payroll every 2 weeks", now)).toMatchObject({ title: "Payroll", repeat: { unit: "week", every: 2 } });
    expect(parseTask("Backup every other day", now)).toMatchObject({ title: "Backup", repeat: { unit: "day", every: 2 } });
    expect(parseTask("Pay rent monthly Dec 1", now)).toMatchObject({ title: "Pay rent", repeat: { unit: "month", every: 1, monthDay: 1 }, dueDate: "2026-12-01" });
    expect(parseTask("Renew domain yearly", now).repeat).toEqual({ unit: "year", every: 1, monthDay: 18 });
  });

  it("understands times and picks today or tomorrow", () => {
    expect(parseTask("Call Sam at 3pm", now)).toMatchObject({ title: "Call Sam", dueTime: "15:00", dueDate: "2026-11-18" });
    expect(parseTask("Call Sam 8am", now)).toMatchObject({ dueTime: "08:00", dueDate: "2026-11-19" });
    expect(parseTask("Lunch noon friday", now)).toMatchObject({ title: "Lunch", dueTime: "12:00", dueDate: "2026-11-20" });
    expect(parseTask("Deploy at 16:45", now)).toMatchObject({ dueTime: "16:45" });
    expect(parseTask("Dentist at 3 tomorrow", now)).toMatchObject({ dueTime: "15:00", dueDate: "2026-11-19" });
    expect(parseTask("Call Sam at 3pm", now).matched).toEqual(expect.arrayContaining(["⏰ 3:00 PM"]));
  });

  it("leaves ordinary titles alone", () => {
    expect(parseTask("Read Every Tool's a Hammer", now)).toEqual({ title: "Read Every Tool's a Hammer", matched: [] });
    expect(parseTask("Buy 3 apples", now)).toEqual({ title: "Buy 3 apples", matched: [] });
    expect(parseTask("Version 2.10 notes", now).dueTime).toBeUndefined();
  });
});

describe("setting a repeat on an existing task", () => {
  it("gives it a start date, moves it onto a chosen weekday, and remembers the month day", () => {
    expect(withRepeat({ dueDate: undefined }, { unit: "day", every: 1 }, "2026-11-18")).toEqual({ dueDate: "2026-11-18", repeat: { unit: "day", every: 1, monthDay: undefined } });
    expect(withRepeat({ dueDate: "2026-11-18" }, { unit: "week", every: 1, weekdays: [2, 4] }).dueDate).toBe("2026-11-19");
    expect(withRepeat({ dueDate: "2026-11-30" }, { unit: "month", every: 1 }).repeat).toEqual({ unit: "month", every: 1, monthDay: 30 });
    expect(withRepeat({ dueDate: "2026-11-30", repeat: { unit: "day", every: 1 } }, undefined).repeat).toBeUndefined();
  });
});
