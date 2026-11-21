import { describe, expect, it } from "vitest";
import { meetingToMarkdown } from "../../src/lib/meetingExport";
import type { Meeting } from "../../src/recorder/types";

const meeting = {
  id: "m1", platform: "zoom", title: "Zoom · 10:00", meetingCode: null, url: "", startedAt: "2026-11-20T10:00:00.000Z", endedAt: null, durationSec: 1800, status: "ready",
  error: null, notice: null, hasAudio: false, micIncluded: true, audioMimeType: null, updatedAt: "",
  transcript: [{ id: "1", speaker: "Ann", text: "We ship Friday.", startMs: 60000, endMs: 63000 }],
  marks: [64000],
  doneActions: ["Book the room"],
  userNotes: "Budget is 20k\nAnn owns QA",
  summary: {
    title: "Launch sync", overview: "We're on track.", keyPoints: ["Docs are ready"], decisions: ["Ship Friday"],
    actionItems: [{ task: "Send the notes", owner: "Ann", dueDate: "2026-11-21", priority: "high" }, { task: "Book the room", owner: null, dueDate: null, priority: "low" }],
    openQuestions: [], customSections: [{ heading: "Risks", points: ["Late QA"] }], model: "t", generatedAt: "",
  },
} as unknown as Meeting;

describe("meetingToMarkdown", () => {
  const md = meetingToMarkdown(meeting);
  it("has the title, date line and overview", () => {
    expect(md.startsWith("# Launch sync\n\n_")).toBe(true);
    expect(md).toContain("30 min_");
    expect(md).toContain("We're on track.");
  });
  it("lists sections, with action items as a checklist", () => {
    expect(md).toContain("## Risks\n- Late QA");
    expect(md).toContain("## Decisions\n- Ship Friday");
    expect(md).toContain("- [ ] Send the notes (Ann, due 2026-11-21)");
    expect(md).toContain("- [x] Book the room");
    expect(md).not.toContain("Open questions");
  });
  it("adds your notes", () => {
    expect(md).toContain("## My notes\nBudget is 20k\nAnn owns QA");
  });
  it("adds key moments but never the transcript itself", () => {
    expect(md).toContain("## Key moments\n- **01:04** Ann: We ship Friday.");
    expect(md.match(/We ship Friday/g)).toHaveLength(1);
  });
});
