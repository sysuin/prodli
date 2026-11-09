import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toEvents } from "../../src/lib/calendar";
import { storageSet } from "../../src/lib/storage";
import { basicBrief, contextFrom, DEFAULT_TODAY_SETTINGS, habitStreak, isForToday, minutesLeft, writeBrief } from "../../src/lib/today";
import type { DayRecord, Habit, Todo } from "../../src/types";
import type { Meeting } from "../../src/recorder/types";

const NOW = new Date(2026, 10, 10, 8, 30); // Tue 10 Nov 2026, 08:30 local
const todo = (title: string, extra: Partial<Todo> = {}): Todo => ({ id: title, title, completed: false, createdAt: "2026-11-01T00:00:00.000Z", ...extra });
const habit = (name: string, days: string[]): Habit => ({ id: name, name, emoji: "💧", color: "#4ECDC4", completedDays: days, createdAt: "", archived: false });

describe("today: picking what matters", () => {
  it("counts planned, overdue and due-today tasks as today's", () => {
    expect(isForToday(todo("a", { plannedFor: "2026-11-10" }), "2026-11-10")).toBe(true);
    expect(isForToday(todo("b", { plannedFor: "2026-11-08" }), "2026-11-10")).toBe(true); // rolled over
    expect(isForToday(todo("c", { dueDate: "2026-11-09" }), "2026-11-10")).toBe(true);
    expect(isForToday(todo("d", { dueDate: "2026-11-12" }), "2026-11-10")).toBe(false);
    expect(isForToday(todo("e", { plannedFor: "2026-11-10", completed: true }), "2026-11-10")).toBe(false);
  });

  it("works out streaks (today not done yet still keeps the streak)", () => {
    expect(habitStreak(habit("w", ["2026-11-07", "2026-11-08", "2026-11-09"]), "2026-11-10")).toBe(3);
    expect(habitStreak(habit("w", ["2026-11-08", "2026-11-09", "2026-11-10"]), "2026-11-10")).toBe(3);
    expect(habitStreak(habit("w", ["2026-11-07"]), "2026-11-10")).toBe(0);
  });

  it("knows how much of the working day is left", () => {
    expect(minutesLeft({ workStart: "09:00", workEnd: "18:00" }, NOW)).toBe(540);
    expect(minutesLeft({ workStart: "09:00", workEnd: "18:00" }, new Date(2026, 10, 10, 17, 0))).toBe(60);
    expect(minutesLeft({ workStart: "09:00", workEnd: "18:00" }, new Date(2026, 10, 10, 19, 0))).toBe(0);
  });
});

describe("today: the brief's input", () => {
  const meeting = {
    id: "m", title: "Sprint review", startedAt: new Date(Date.now() - 86_400_000).toISOString(),
    summary: { title: "Sprint review", overview: "", keyPoints: [], decisions: [], openQuestions: [], model: "", generatedAt: "", actionItems: [
      { task: "Send the deck to Priya", owner: "You", dueDate: null, priority: "high" },
      { task: "Write release notes", owner: null, dueDate: null, priority: "medium" },
    ] },
  } as unknown as Meeting;
  const days: DayRecord[] = [
    { id: "2026-11-10", focus: "Ship 1.4", createdAt: "" },
    { id: "2026-11-09", reflection: "Too many meetings; start with deep work.", createdAt: "" },
  ];

  it("puts today's tasks first, flags overdue, and includes context from yesterday", () => {
    const ctx = contextFrom({
      now: NOW,
      settings: DEFAULT_TODAY_SETTINGS,
      todos: [
        todo("Someday idea", { priority: "low" }),
        todo("Write release notes", { plannedFor: "2026-11-10", estimateMin: 60 }),
        todo("Pay invoice", { dueDate: "2026-11-08", priority: "high" }),
        todo("Done yesterday", { completed: true, completedAt: new Date(2026, 10, 9, 15).toISOString() }),
      ],
      habits: [habit("Drink water", ["2026-11-09"])],
      meetings: [meeting],
      days,
      events: [{ id: "e", title: "Standup", start: "10:00", end: "10:15", allDay: false }],
      trackingYesterday: { "github.com": 3600, "news.com": 1200 },
      sessions: [{ completedAt: new Date(2026, 10, 9, 11).toISOString() }],
    });
    expect(ctx).toMatchObject({ date: "2026-11-10", weekday: "Tuesday", now: "08:30", focus: "Ship 1.4" });
    expect(ctx.tasks.map((t) => t.title)).toEqual(["Pay invoice", "Write release notes", "Someday idea"]);
    expect(ctx.tasks[0]).toMatchObject({ overdue: true, priority: "high" });
    expect(ctx.tasks[1]).toMatchObject({ planned: true, estimateMin: 60 });
    expect(ctx.doneYesterday).toEqual(["Done yesterday"]);
    expect(ctx.habits).toEqual([{ name: "Drink water", doneToday: false, streak: 1 }]);
    expect(ctx.events).toEqual([{ title: "Standup", start: "10:00", end: "10:15" }]);
    // Action items already in To-Dos aren't repeated.
    expect(ctx.meetingActions).toEqual([{ task: "Send the deck to Priya", owner: "You", due: null, meeting: "Sprint review" }]);
    expect(ctx.yesterday).toMatchObject({ browsingMinutes: 80, topSites: [{ site: "github.com", minutes: 60 }, { site: "news.com", minutes: 20 }], focusSessions: 1, reflection: "Too many meetings; start with deep work." });
  });

  it("stays within the server's limits", () => {
    const ctx = contextFrom({ now: NOW, settings: DEFAULT_TODAY_SETTINGS, todos: Array.from({ length: 200 }, (_, i) => todo(`t${i} ${"x".repeat(500)}`)), habits: [], meetings: [], days: [], events: [] });
    expect(ctx.tasks).toHaveLength(60);
    expect(ctx.tasks[0].title.length).toBeLessThanOrEqual(280);
    expect(JSON.stringify(ctx).length).toBeLessThan(40_000);
  });
});

describe("today: the basic brief (no AI)", () => {
  it("leads with the focus, lists priorities, schedules meetings and warns about overload", () => {
    const b = basicBrief({
      date: "2026-11-10", weekday: "Tuesday", now: "16:00", workHours: { start: "09:00", end: "18:00" }, focus: "Ship 1.4",
      tasks: [{ title: "Pay invoice", overdue: true, priority: "high" }, { title: "Write notes", planned: true, estimateMin: 180 }],
      habits: [{ name: "Drink water", doneToday: false, streak: 4 }, { name: "Read", doneToday: true, streak: 2 }],
      events: [{ title: "Standup", start: "16:30", end: "17:00" }],
    });
    expect(b.headline).toBe("Today's focus: Ship 1.4");
    expect(b.priorities).toEqual([{ title: "Pay invoice", reason: "Overdue" }, { title: "Write notes", reason: "Planned for today" }]);
    expect(b.schedule).toEqual([{ start: "16:30", end: "17:00", title: "Standup", kind: "meeting" }]);
    expect(b.watchouts.join(" ")).toMatch(/1 overdue task/);
    expect(b.watchouts.join(" ")).toMatch(/planned about 3 h of work but have about 1\.5 h free/);
    expect(b.habits).toEqual(["Drink water — keep your 4-day streak going"]);
    expect(b.source).toBe("basic");
  });

  it("is still helpful on an empty day", () => {
    const b = basicBrief({ date: "2026-11-10", weekday: "Tuesday", now: "08:30", workHours: { start: "09:00", end: "18:00" }, tasks: [] });
    expect(b.headline).toBe("A fresh Tuesday");
    expect(b.summary).toMatch(/plan one thing/);
  });
});

describe("today: writing the brief", () => {
  const ctx = { date: "2026-11-10", weekday: "Tuesday", now: "08:30", workHours: { start: "09:00", end: "18:00" }, tasks: [{ title: "Write notes" }] };
  beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("uses the basic brief when signed out (no request)", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const r = await writeBrief(ctx);
    expect(r).toMatchObject({ brief: { source: "basic" }, fallbackReason: "signed_out" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses ProdLi AI when signed in, and falls back with a clear reason when it can't", async () => {
    await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
    globalThis.fetch = vi.fn(async () => Response.json({ brief: { headline: "AI", summary: "", priorities: [], schedule: [], watchouts: [], habits: [], tip: "", model: "m", generatedAt: "x" }, usage: { used: 1, limit: 62 } })) as typeof fetch;
    expect(await writeBrief(ctx)).toMatchObject({ brief: { headline: "AI", source: "ai" }, usage: { used: 1, limit: 62 } });
    globalThis.fetch = vi.fn(async () => Response.json({ error: "brief_quota_exceeded" }, { status: 429 })) as typeof fetch;
    const r = await writeBrief(ctx);
    expect(r.brief.source).toBe("basic");
    expect(r.fallbackReason).toMatch(/used this month's AI briefs/);
  });
});

describe("calendar", () => {
  it("turns Google Calendar events into today's agenda, dropping cancelled and declined ones", () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m).toISOString();
    const events = toEvents([
      { id: "2", summary: "Lunch", start: { dateTime: at(12) }, end: { dateTime: at(13) } },
      { id: "1", summary: "Standup", start: { dateTime: at(10) }, end: { dateTime: at(10, 15) }, hangoutLink: "https://meet.google.com/x" },
      { id: "3", summary: "Holiday", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } },
      { id: "4", summary: "Cancelled", status: "cancelled", start: { dateTime: at(9) }, end: { dateTime: at(9, 30) } },
      { id: "5", summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: at(15) }, end: { dateTime: at(16) } },
      { id: "6", start: { dateTime: at(17) }, end: { dateTime: at(17, 30) } },
    ]);
    expect(events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ["Holiday", null, null, true],
      ["Standup", "10:00", "10:15", false],
      ["Lunch", "12:00", "13:00", false],
      ["(No title)", "17:00", "17:30", false],
    ]);
    expect(events[1].meetLink).toBe("https://meet.google.com/x");
  });
});
