import { describe, expect, it } from "vitest";
import { plannedReminders, reminderLine } from "../../src/lib/prepReminders";
import type { MeetingPrep } from "../../src/lib/meetingPrep";

const NOW = new Date(2026, 10, 20, 9, 0);
const prep = (extra: Partial<MeetingPrep> = {}): MeetingPrep => ({ eventId: "e1", title: "Acme pilot review", start: "14:00", end: "14:30", matchedBy: "link", pastCount: 1, last: { id: "m", title: "Acme", date: new Date(2026, 10, 12, 10).toISOString(), overview: "", decisions: [], openQuestions: [] }, openItems: [{ task: "Send the plan", owner: "You", due: null, meetingId: "m" }, { task: "Book", owner: null, due: null, meetingId: "m" }], relatedTasks: [], ...extra });

describe("prep reminders", () => {
  it("says what's open and when you last met", () => {
    expect(reminderLine(prep(), NOW)).toBe("2 open items · last met 12 Nov");
    expect(reminderLine(prep({ openItems: [], last: null, relatedTasks: [{ id: "t", title: "Call Priya" }] }), NOW)).toBe("1 related to-do");
  });

  it("plans one 10 minutes before each meeting still ahead", () => {
    const r = plannedReminders([prep(), prep({ eventId: "e2", start: "09:05" }), prep({ eventId: "e3", start: null })], NOW);
    expect(Object.keys(r)).toEqual(["e1"]); // 09:05 − 10 min is already past; no start time, no reminder
    expect(r.e1).toEqual({ title: "Acme pilot review", start: "14:00", line: "2 open items · last met 12 Nov", when: new Date(2026, 10, 20, 13, 50).getTime() });
  });
});
