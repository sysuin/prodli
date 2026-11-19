import { describe, expect, it } from "vitest";
import { buildPrep, firstName, matchMeeting, meetCode, metLabel, titlesMatch } from "../../src/lib/meetingPrep";
import { basicBrief, contextFrom, DEFAULT_TODAY_SETTINGS, prepNote } from "../../src/lib/today";
import { toEvents } from "../../src/lib/calendar";
import type { CalendarEvent } from "../../src/lib/calendar";
import type { Meeting } from "../../src/recorder/types";
import type { Todo } from "../../src/types";

const NOW = new Date(2026, 10, 19, 9, 0); // Thu 19 Nov 2026, 09:00 local
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const event = (title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: title, title, start: "14:00", end: "14:30", allDay: false, ...extra });
const meeting = (id: string, extra: Partial<Meeting> = {}): Meeting => ({
  id,
  platform: "google-meet",
  title: "Google Meet · aaa-bbbb-ccc",
  meetingCode: "aaa-bbbb-ccc",
  url: "https://meet.google.com/aaa-bbbb-ccc",
  startedAt: daysAgo(7),
  endedAt: daysAgo(7),
  durationSec: 1800,
  status: "ready",
  transcript: [],
  summary: null,
  error: null,
  notice: null,
  hasAudio: false,
  micIncluded: false,
  audioMimeType: null,
  updatedAt: daysAgo(7),
  ...extra,
});
const summary = (extra: Partial<NonNullable<Meeting["summary"]>> = {}): NonNullable<Meeting["summary"]> => ({ title: "Acme pilot review", overview: "Agreed on a two-week pilot.", keyPoints: [], decisions: ["Pilot starts Monday"], actionItems: [], openQuestions: ["Who signs the contract?"], model: "t", generatedAt: "", ...extra });
const todo = (title: string, extra: Partial<Todo> = {}): Todo => ({ id: title, title, completed: false, createdAt: "", ...extra });

describe("meeting prep: matching", () => {
  it("reads the Meet code from a link", () => {
    expect(meetCode("https://meet.google.com/abc-defg-hij?authuser=0")).toBe("abc-defg-hij");
    expect(meetCode("https://zoom.us/j/123")).toBeNull();
    expect(meetCode(undefined)).toBeNull();
  });

  it("matches titles by their distinctive words", () => {
    expect(titlesMatch("Acme pilot review", "Acme – pilot review")).toBe(true);
    expect(titlesMatch("Weekly sync with Acme", "Acme sync")).toBe(true);
    expect(titlesMatch("Acme pilot review", "Globex pilot kickoff")).toBe(false);
    expect(titlesMatch("Weekly sync", "Weekly sync")).toBe(false); // nothing distinctive
    expect(titlesMatch("Google Meet · abc-defg-hij", "Google Meet · abc-defg-hij")).toBe(false);
  });

  it("gets first names from names and emails", () => {
    expect(firstName({ name: "Priya Shah" })).toBe("priya");
    expect(firstName({ email: "jose.garcia@acme.com" })).toBe("jose");
    expect(firstName({ email: "j2@acme.com" })).toBeNull();
    expect(firstName({ name: "Al" })).toBeNull();
  });

  it("prefers the Meet link, then the title, then the people", () => {
    const e = event("Acme pilot review", { meetLink: "https://meet.google.com/aaa-bbbb-ccc", attendees: [{ name: "Priya Shah" }, { email: "tom.lee@acme.com" }] });
    expect(matchMeeting(e, meeting("a"))).toBe("link");
    expect(matchMeeting(e, meeting("b", { meetingCode: "zzz-zzzz-zzz", url: "", title: "Acme pilot review" }))).toBe("title");
    const spoke = (names: string[]) => names.map((speaker, i) => ({ id: String(i), speaker, text: "hi", startMs: 0, endMs: 1 }));
    expect(matchMeeting(e, meeting("c", { meetingCode: null, url: "", title: "Catch-up", transcript: spoke(["Priya Shah", "Tom Lee", "You"]) }))).toBe("people");
    // One shared first name isn't enough when two people are invited.
    expect(matchMeeting(e, meeting("d", { meetingCode: null, url: "", title: "Catch-up", transcript: spoke(["Priya Kumar", "You"]) }))).toBeNull();
  });
});

describe("meeting prep: what it shows", () => {
  const e = event("Acme pilot review", { meetLink: "https://meet.google.com/aaa-bbbb-ccc", attendees: [{ name: "Priya Shah" }] });

  it("shows last time's summary and the action items that aren't done", () => {
    const meetings = [
      meeting("old", { startedAt: daysAgo(14), summary: summary({ overview: "Old", actionItems: [{ task: "Draft the pilot plan", owner: "You", dueDate: null, priority: "high" }, { task: "Book the venue", owner: null, dueDate: null, priority: "low" }] }) }),
      meeting("new", { startedAt: daysAgo(7), summary: summary({ actionItems: [{ task: "Send Priya the pilot plan", owner: "You", dueDate: "2026-11-20", priority: "high" }] }) }),
    ];
    const todos = [todo("Draft the pilot plan", { completed: true }), todo("Book the venue"), todo("Call Priya about pricing"), todo("Buy milk")];
    const [p] = buildPrep([e], meetings, todos, NOW);
    expect(p.matchedBy).toBe("link");
    expect(p.pastCount).toBe(2);
    expect(p.last).toMatchObject({ id: "new", overview: "Agreed on a two-week pilot.", decisions: ["Pilot starts Monday"], openQuestions: ["Who signs the contract?"] });
    expect(p.openItems.map((i) => [i.task, i.todoId])).toEqual([
      ["Send Priya the pilot plan", undefined],
      ["Book the venue", "Book the venue"],
    ]);
    expect(p.relatedTasks.map((t) => t.title)).toEqual(["Call Priya about pricing"]);
  });

  it("skips events that are over, all-day, or have no history", () => {
    const meetings = [meeting("m", { summary: summary() })];
    expect(buildPrep([{ ...e, start: "08:00", end: "08:30" }], meetings, [], NOW)).toEqual([]);
    expect(buildPrep([{ ...e, allDay: true, start: null, end: null }], meetings, [], NOW)).toEqual([]);
    expect(buildPrep([event("Dentist")], meetings, [], NOW)).toEqual([]);
    // A meeting in progress still gets prep.
    expect(buildPrep([{ ...e, start: "08:45", end: "09:30" }], meetings, [], NOW)).toHaveLength(1);
  });

  it("ignores meetings that aren't ready, are in the future, or are too old", () => {
    const s = summary();
    expect(buildPrep([e], [meeting("r", { status: "recording", summary: s }), meeting("f", { startedAt: new Date(NOW.getTime() + 3600_000).toISOString(), summary: s }), meeting("o", { startedAt: daysAgo(200), summary: s })], [], NOW)).toEqual([]);
  });

  it("labels when you last met", () => {
    expect(metLabel(daysAgo(1), NOW)).toBe("yesterday");
    expect(metLabel(new Date(2026, 10, 12, 15).toISOString(), NOW)).toBe("12 Nov");
  });
});

describe("meeting prep: in the daily brief", () => {
  it("adds prep to the brief's input and to the basic brief", () => {
    const events = [event("Acme pilot review", { meetLink: "https://meet.google.com/aaa-bbbb-ccc" })];
    const meetings = [meeting("m", { startedAt: daysAgo(7), summary: summary({ actionItems: [{ task: "Send Priya the pilot plan", owner: "You", dueDate: null, priority: "high" }] }) })];
    const ctx = contextFrom({ now: NOW, settings: DEFAULT_TODAY_SETTINGS, todos: [], habits: [], meetings, days: [], events });
    expect(ctx.meetingPrep).toEqual([{ event: "Acme pilot review", start: "14:00", lastMet: "12 Nov", lastSummary: "Agreed on a two-week pilot.", openItems: ["Send Priya the pilot plan"], relatedTasks: undefined }]);
    expect(basicBrief(ctx).prep).toEqual([{ event: "Acme pilot review (14:00)", note: "Last met 12 Nov · 1 open item: Send Priya the pilot plan" }]);
  });

  it("writes a short note", () => {
    expect(prepNote({ event: "x", openItems: ["a", "b", "c"] })).toBe("3 open items: a; b…");
    expect(prepNote({ event: "x", openItems: [], relatedTasks: ["Call Priya"], lastMet: "yesterday" })).toBe("Last met yesterday · Related to-do: Call Priya");
  });

  it("keeps other invitees from Google Calendar, not you or rooms", () => {
    const [ev] = toEvents([
      {
        id: "1",
        summary: "Acme",
        start: { dateTime: "2026-11-19T14:00:00" },
        end: { dateTime: "2026-11-19T14:30:00" },
        attendees: [{ self: true, email: "me@x.com" }, { resource: true, email: "room@x.com" }, { email: "priya@acme.com", displayName: "Priya Shah" }, { email: "no@acme.com", responseStatus: "declined" }],
      },
    ]);
    expect(ev.attendees).toEqual([{ name: "Priya Shah", email: "priya@acme.com" }]);
  });
});
