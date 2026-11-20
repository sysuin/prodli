import { describe, expect, it } from "vitest";
import { coachInput } from "../../src/sections/meetings/Coach";
import type { Meeting } from "../../src/recorder/types";

const base = {
  id: "m1", platform: "zoom", title: "Zoom · 10:00", meetingCode: null, url: "", startedAt: "2026-11-20T10:00:00.000Z", endedAt: null, durationSec: 60, status: "ready",
  summary: null, error: null, notice: null, hasAudio: false, micIncluded: true, audioMimeType: null, updatedAt: "",
} as const;

describe("coachInput", () => {
  it("says who you are and your talk share when they're known", () => {
    const m = { ...base, transcript: [{ id: "1", speaker: "You", text: "Budget?", startMs: 0, endMs: 2000 }, { id: "2", speaker: "Others", text: "20k.", startMs: 3000, endMs: 5000 }], speakerActivity: [[0, 30000, 0], [30000, 40000, 1]] } as unknown as Meeting;
    const input = coachInput(m, "sales");
    expect(input).toMatchObject({ title: "Zoom · 10:00", date: "2026-11-20", you: "You", talkShare: 75, focus: "sales" });
    expect(input.transcript).toContain("You: Budget?");
  });
  it("leaves them out when the transcript doesn't say", () => {
    const m = { ...base, summary: { title: "Acme review" }, transcript: [{ id: "1", speaker: "Priya", text: "Hi", startMs: 0, endMs: 1000 }] } as unknown as Meeting;
    expect(coachInput(m, "general")).toMatchObject({ title: "Acme review", you: null, talkShare: null });
  });
});
