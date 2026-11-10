import { describe, expect, it } from "vitest";
import { parseTask } from "../../src/lib/taskParse";

const NOW = new Date(2026, 10, 10, 9, 0); // Tuesday 10 Nov 2026

describe("smart add", () => {
  it.each([
    ["Pay rent tomorrow !high", { title: "Pay rent", dueDate: "2026-11-11", priority: "high" }],
    ["Pay rent friday !high", { title: "Pay rent", dueDate: "2026-11-13", priority: "high" }],
    ["Pay rent !high friday", { title: "Pay rent", dueDate: "2026-11-13", priority: "high" }],
    ["Call mom today", { title: "Call mom", dueDate: "2026-11-10" }],
    ["Submit report by friday p2", { title: "Submit report", dueDate: "2026-11-13", priority: "medium" }],
    ["Team lunch on Tuesday", { title: "Team lunch", dueDate: "2026-11-17" }], // today is Tuesday → next week
    ["Plan offsite next week", { title: "Plan offsite", dueDate: "2026-11-16" }],
    ["Renew passport in 3 weeks !low", { title: "Renew passport", dueDate: "2026-12-01", priority: "low" }],
    ["Dentist Nov 20", { title: "Dentist", dueDate: "2026-11-20" }],
    ["Dentist 20th November", { title: "Dentist", dueDate: "2026-11-20" }],
    ["Taxes March 15", { title: "Taxes", dueDate: "2027-03-15" }], // already passed this year → next year
    ["Launch 2026-12-01 #today", { title: "Launch", dueDate: "2026-12-01", planToday: true }],
    ["Write notes ☀️", { title: "Write notes", planToday: true }],
  ])("%s", (input, expected) => {
    expect(parseTask(input, NOW)).toMatchObject(expected);
  });

  it("leaves ordinary words alone", () => {
    expect(parseTask("Read Monday Morning Leadership book", NOW)).toEqual({ title: "Read Monday Morning Leadership book", matched: [] });
    expect(parseTask("Lunch with Sam friday", NOW).dueDate).toBe("2026-11-13");
    expect(parseTask("Buy maybe 2 apples", NOW)).toEqual({ title: "Buy maybe 2 apples", matched: [] });
    expect(parseTask("Email p.r. team", NOW).priority).toBeUndefined();
    expect(parseTask("Fix today-view bug", NOW).dueDate).toBeUndefined(); // not a standalone word
  });

  it("never leaves the title empty", () => {
    expect(parseTask("tomorrow", NOW)).toEqual({ title: "tomorrow", matched: [] });
  });

  it("describes what it understood", () => {
    expect(parseTask("Pay rent tomorrow !high", NOW).matched).toEqual(["High priority", "📅 Tomorrow"]);
  });
});
