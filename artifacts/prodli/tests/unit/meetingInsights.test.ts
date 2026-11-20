import { describe, expect, it } from "vitest";
import { hours, meetingInsights, weekStart } from "../../src/lib/meetingInsights";
import type { Meeting } from "../../src/recorder/types";

// Thursday 20 Nov 2026, noon local.
const NOW = new Date(2026, 10, 20, 12, 0, 0);
const at = (y: number, mo: number, d: number, h = 10) => new Date(y, mo, d, h).toISOString();

let n = 0;
const meeting = (startedAt: string, durationMin: number, extra: Partial<Meeting> = {}): Meeting => ({
  id: `m${++n}`,
  platform: "zoom",
  title: "Weekly sync",
  meetingCode: null,
  url: "",
  startedAt,
  endedAt: startedAt,
  durationSec: durationMin * 60,
  status: "ready",
  transcript: [],
  summary: null,
  error: null,
  notice: null,
  hasAudio: false,
  micIncluded: true,
  audioMimeType: null,
  updatedAt: startedAt,
  ...extra,
});

const summary = (decisions: string[], tasks: string[]) => ({ title: "t", overview: "", keyPoints: [], decisions, actionItems: tasks.map((task) => ({ task, owner: null, dueDate: null, priority: "medium" as const })), openQuestions: [], model: "t", generatedAt: "" });

describe("weekStart", () => {
  it("is the Monday of the week", () => {
    expect(weekStart(NOW).getDate()).toBe(16);
    expect(weekStart(new Date(2026, 10, 22)).getDate()).toBe(16); // Sunday
    expect(weekStart(new Date(2026, 10, 16)).getDate()).toBe(16);
  });
});

describe("meetingInsights", () => {
  const meetings = [
    meeting(at(2026, 10, 17), 30, { summary: summary(["Ship Friday"], ["Write notes", "Book room"]), doneActions: ["write notes"] }),
    meeting(at(2026, 10, 19), 60, { platform: "google-meet", title: "Design review", meetingCode: "abc-defg-hij" }),
    meeting(at(2026, 10, 10), 45),
    meeting(at(2026, 10, 3), 45, { speakerActivity: [[0, 30000, 0], [30000, 40000, 1]] }),
    meeting(at(2026, 8, 1), 120), // too long ago
    meeting(at(2026, 10, 20, 11), 15, { status: "recording" }), // still going
  ];
  const r = meetingInsights(meetings, NOW);

  it("adds up this week, last week and 8 weekly bars", () => {
    expect(r.weeks).toHaveLength(8);
    expect(r.weeks[7]).toMatchObject({ weekStart: "2026-11-16", minutes: 90, count: 2 });
    expect(r.thisWeek).toEqual({ minutes: 90, count: 2 });
    expect(r.lastWeek).toEqual({ minutes: 45, count: 1 });
    expect(r.total).toEqual({ minutes: 180, count: 4 });
    expect(r.avgMinutes).toBe(45);
  });
  it("finds the busiest weekday", () => {
    // Tue 17th 30 + Tue 10th 45 + Tue 3rd 45 = 120 on Tuesday vs 60 on Thursday.
    expect(r.busiestDay).toBe(1);
  });
  it("splits time by call app, most first", () => {
    expect(r.byPlatform).toEqual([
      { platform: "zoom", minutes: 120, count: 3 },
      { platform: "google-meet", minutes: 60, count: 1 },
    ]);
  });
  it("lists meetings held 2+ times as recurring", () => {
    expect(r.series).toEqual([{ title: "Weekly sync", count: 3, minutes: 120, latestId: meetings[0].id }]);
  });
  it("counts decisions and action items, with the ones done", () => {
    expect([r.decisions, r.actionItems, r.actionItemsDone]).toEqual([1, 2, 1]);
  });
  it("averages your talk share where it was recorded", () => {
    expect(r.talkShare).toBe(75);
  });
  it("copes with no meetings", () => {
    const e = meetingInsights([], NOW);
    expect(e.total.count).toBe(0);
    expect(e.busiestDay).toBeNull();
    expect(e.talkShare).toBeNull();
  });
});

describe("hours", () => {
  it("formats minutes", () => {
    expect(hours(45)).toBe("45 min");
    expect(hours(60)).toBe("1 h");
    expect(hours(135)).toBe("2 h 15 min");
  });
});
