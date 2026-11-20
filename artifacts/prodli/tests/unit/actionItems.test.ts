import { describe, expect, it } from "vitest";
import { groupByOwner, openActions } from "../../src/lib/actionItems";
import type { Meeting } from "../../src/recorder/types";
import type { Todo } from "../../src/types";

const TODAY = "2026-11-20";
const meeting = (id: string, items: [string, string | null, string | null][], extra: Partial<Meeting> = {}): Meeting =>
  ({
    id, platform: "zoom", title: `Meeting ${id}`, meetingCode: null, url: "", startedAt: "2026-11-18T10:00:00.000Z", endedAt: null, durationSec: 0, status: "ready", transcript: [], error: null, notice: null, hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: "",
    summary: { title: `Sync ${id}`, overview: "", keyPoints: [], decisions: [], openQuestions: [], model: "", generatedAt: "", actionItems: items.map(([task, owner, dueDate]) => ({ task, owner, dueDate, priority: "medium" as const })) },
    ...extra,
  }) as Meeting;
const todo = (title: string, completed = false): Todo => ({ id: title, title, completed, createdAt: "" });

describe("action items across meetings", () => {
  const meetings = [
    meeting("a", [["Send the pilot plan", "You", "2026-11-19"], ["Book the venue", "Priya", null], ["Share the deck", null, "2026-11-25"]]),
    meeting("b", [["Draft pricing", "priya", "2026-11-22"], ["Fix the login bug", "Me", null], ["Call the lawyer", "Sam", null]], { doneActions: ["call the LAWYER"] }),
  ];

  it("lists open items, skipping ones done here or finished as to-dos", () => {
    const items = openActions(meetings, [todo("Book the venue", true), todo("Share the deck")], TODAY);
    expect(items.map((i) => i.task)).toEqual(["Send the pilot plan", "Share the deck", "Draft pricing", "Fix the login bug"]);
    expect(items.find((i) => i.task === "Share the deck")?.todoId).toBe("Share the deck");
    expect(items.find((i) => i.task === "Send the pilot plan")?.overdue).toBe(true);
    expect(items[0].meetingTitle).toBe("Sync a");
  });

  it("groups by owner: you first, then people, then unassigned", () => {
    const groups = groupByOwner(openActions(meetings, [], TODAY));
    expect(groups.map((g) => [g.owner, g.items.map((i) => i.task)])).toEqual([
      ["You", ["Send the pilot plan", "Fix the login bug"]],
      ["Priya", ["Draft pricing", "Book the venue"]],
      ["Unassigned", ["Share the deck"]],
    ]);
  });
});
