import { describe, expect, it } from "vitest";
import { dismissMonth, dismissTrialToday, monthRecapWindow, NO_RECAP_STATE, recapPhrases, recapStats, trialReminderDue } from "../../src/lib/valueRecap";
import { cleanRetention, retentionPlan } from "../../src/recorder/retention";
import { crc32, zipFiles } from "../../src/lib/zip";
import { buildExportFiles, todosMarkdown } from "../../src/lib/exportAll";
import { blockReason, normalizeSite, pageMatches, pathOf, DEFAULT_FOCUS_BLOCK } from "../../src/lib/focusBlock";
import { trialDaysLeft } from "../../src/lib/billing";
import { RECIPES } from "../../src/lib/ask";

const DAY = 86_400_000;

describe("value recap", () => {
  const nov = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
  const input = {
    todos: [
      { completed: true, completedAt: nov(3) },
      { completed: true, completedAt: nov(20) },
      { completed: true, completedAt: new Date(2026, 9, 31).toISOString() }, // October
      { completed: false },
    ],
    meetings: [{ summary: { generatedAt: nov(10) } }, { summary: null }],
    sessions: [{ completedAt: nov(5), duration: 25 }, { completedAt: nov(6), duration: 50 }, { completedAt: nov(7), duration: 25 }, { completedAt: nov(8), duration: 25 }],
    habits: [{ completedDays: ["2026-11-01", "2026-11-02", "2026-10-30"], log: { "2026-11-04": 2, "2026-11-05": 0 } }],
    dictation: [{ at: nov(9), words: 120 }, { at: nov(9), words: 1 }],
  };
  const from = new Date(2026, 10, 1).getTime();
  const to = new Date(2026, 11, 1).getTime();

  it("counts last month's activity on this device", () => {
    const s = recapStats(input, from, to);
    expect(s).toEqual({ tasksDone: 2, meetingsSummarized: 1, focusMinutes: 125, habitCheckIns: 3, dictatedWords: 121 });
    expect(recapPhrases(s)).toEqual(["summarized 1 meeting", "finished 2 to-dos", "2.1 hours of focus", "3 habit check-ins", "121 words dictated"]);
    expect(recapPhrases(recapStats({ todos: [], meetings: [], sessions: [], habits: [], dictation: [] }, from, to))).toEqual([]);
  });

  it("shows the month recap in the first 5 days, once", () => {
    const w = monthRecapWindow(new Date(2026, 11, 2), NO_RECAP_STATE)!;
    expect(w).toMatchObject({ id: "2026-11", from, to });
    expect(monthRecapWindow(new Date(2026, 11, 6), NO_RECAP_STATE)).toBeNull();
    expect(monthRecapWindow(new Date(2026, 11, 2), dismissMonth(NO_RECAP_STATE, "2026-11"))).toBeNull();
    // January shows December of the year before.
    expect(monthRecapWindow(new Date(2027, 0, 1), NO_RECAP_STATE)?.id).toBe("2026-12");
  });

  it("reminds in the last 3 days of the trial, at most once a day", () => {
    const now = new Date(2026, 10, 20, 9);
    expect(trialReminderDue(now.getTime() + 2 * DAY, now, NO_RECAP_STATE)).toBe(true);
    expect(trialReminderDue(now.getTime() + 5 * DAY, now, NO_RECAP_STATE)).toBe(false);
    expect(trialReminderDue(now.getTime() - 1, now, NO_RECAP_STATE)).toBe(false);
    expect(trialReminderDue(null, now, NO_RECAP_STATE)).toBe(false);
    const dismissed = dismissTrialToday(NO_RECAP_STATE, now);
    expect(trialReminderDue(now.getTime() + 2 * DAY, now, dismissed)).toBe(false);
    expect(trialReminderDue(now.getTime() + 2 * DAY, new Date(now.getTime() + DAY), dismissed)).toBe(true);
    expect(trialDaysLeft(now.getTime() + 2.5 * DAY, now.getTime())).toBe(3);
    expect(trialDaysLeft(now.getTime() + 1000, now.getTime())).toBe(1);
  });
});

describe("meeting auto-delete", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const ago = (d: number) => new Date(now - d * DAY).toISOString();
  const meetings = [
    { id: "new", startedAt: ago(2), status: "ready" as const, hasAudio: true },
    { id: "month", startedAt: ago(40), status: "ready" as const, hasAudio: true },
    { id: "month-noaudio", startedAt: ago(40), status: "ready" as const, hasAudio: false },
    { id: "old", startedAt: ago(400), status: "ready" as const, hasAudio: true },
    { id: "live", startedAt: ago(400), status: "recording" as const, hasAudio: true },
  ];

  it("is off by default and ignores unknown values", () => {
    expect(cleanRetention(undefined)).toEqual({ audioDays: 0, meetingDays: 0 });
    expect(cleanRetention({ audioDays: 5, meetingDays: 30 })).toEqual({ audioDays: 0, meetingDays: 30 });
    expect(retentionPlan(meetings, cleanRetention(null), now)).toEqual({ deleteMeetings: [], deleteAudio: [] });
  });

  it("deletes old recordings (keeping notes) and old meetings, never one in progress", () => {
    expect(retentionPlan(meetings, { audioDays: 30, meetingDays: 0 }, now)).toEqual({ deleteMeetings: [], deleteAudio: ["month", "old"] });
    expect(retentionPlan(meetings, { audioDays: 30, meetingDays: 365 }, now)).toEqual({ deleteMeetings: ["old"], deleteAudio: ["month"] });
  });
});

describe("download everything as Markdown", () => {
  it("writes a valid zip (stored entries, CRC-32)", async () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const blob = zipFiles([{ name: "notes/a.md", text: "# A" }, { name: "b.md", text: "héllo" }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(new TextDecoder().decode(bytes)).toContain("notes/a.md");
  });

  it("puts notes, meetings and to-dos in readable files with unique names", () => {
    const files = buildExportFiles({
      notes: [
        { id: "1", title: "Plan", content: "<p>Hello</p>", createdAt: "2026-11-01T00:00:00Z", updatedAt: "" },
        { id: "2", title: "Plan", content: "<p>Again</p>", createdAt: "2026-11-01T00:00:00Z", updatedAt: "" },
      ],
      meetings: [{ id: "m", title: "Standup", startedAt: "2026-11-02T09:00:00Z", status: "ready", transcript: [{ id: "t", speaker: "Priya", text: "Ship it", startMs: 61000, endMs: 62000 }], summary: null } as never],
      todos: [{ id: "t1", title: "Call Sam", completed: false, dueDate: "2026-11-30", createdAt: "" }, { id: "t2", title: "Done thing", completed: true, createdAt: "" }],
    });
    const names = files.map((f) => f.name);
    expect(names).toEqual(["notes/2026-11-01 Plan.md", "notes/2026-11-01 Plan (2).md", "meetings/2026-11-02 Standup.md", "to-dos.md", "README.md"]);
    expect(files[2].text).toContain("**Priya** (1:01): Ship it");
    expect(todosMarkdown([{ id: "t1", title: "Call Sam", completed: false, dueDate: "2026-11-30", createdAt: "" }])).toContain("- [ ] Call Sam (due 2026-11-30)");
  });
});

describe("blocking Shorts and Reels without the whole site", () => {
  it("keeps short-video paths, drops other paths", () => {
    expect(normalizeSite("https://www.youtube.com/shorts/abc")).toBe("youtube.com/shorts");
    expect(normalizeSite("m.youtube.com/shorts")).toBe("youtube.com/shorts");
    expect(normalizeSite("instagram.com/reels/")).toBe("instagram.com/reels");
    expect(normalizeSite("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
  });

  it("matches only pages under the path", () => {
    expect(pageMatches("youtube.com", "/shorts/abc", "youtube.com/shorts")).toBe(true);
    expect(pageMatches("m.youtube.com", "/shorts", "youtube.com/shorts")).toBe(true);
    expect(pageMatches("youtube.com", "/watch", "youtube.com/shorts")).toBe(false);
    expect(pageMatches("youtube.com", "/shortsfan", "youtube.com/shorts")).toBe(false);
    expect(pathOf("https://www.instagram.com/reels/xyz/?a=1")).toBe("/reels/xyz/");
    const s = { ...DEFAULT_FOCUS_BLOCK, enabled: true, sites: ["youtube.com/shorts"], duringPomodoro: true };
    expect(blockReason("youtube.com", s, { pomodoroFocus: true, path: "/shorts/1" })).toBe("pomodoro");
    expect(blockReason("youtube.com", s, { pomodoroFocus: true, path: "/watch" })).toBeNull();
  });
});

it("offers starter recipes for meetings and notes", () => {
  expect(RECIPES.length).toBeGreaterThanOrEqual(4);
  expect(RECIPES.some((r) => /promise/i.test(r))).toBe(true);
});
