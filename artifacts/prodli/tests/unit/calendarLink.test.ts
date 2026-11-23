import { describe, expect, it } from "vitest";
import { eventForCall, eventRef, sameSeries } from "../../src/lib/calendarLink";
import { matchMeeting } from "../../src/lib/meetingPrep";
import type { CalendarEvent } from "../../src/lib/calendar";

const ev = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: id, start, end, allDay: false, ...extra });
const at = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 10, 23, h, m);
};

describe("meetings tied to calendar events", () => {
  const events: CalendarEvent[] = [
    { id: "allday", title: "Holiday", start: null, end: null, allDay: true },
    ev("standup", "09:30", "09:45", { meetLink: "https://meet.google.com/abc-defg-hij" }),
    ev("client", "10:00", "11:00", { meetLink: "https://meet.google.com/zzz-yyyy-xxx", attendees: [{ name: "Priya Shah", email: "priya@acme.com" }] }),
    ev("focus", "10:00", "12:00"),
  ];

  it("prefers the same Meet link, whatever the time", () => {
    expect(eventForCall(events, { code: "abc-defg-hij", at: at("10:20") })?.id).toBe("standup");
    expect(eventForCall(events, { url: "https://meet.google.com/zzz-yyyy-xxx?authuser=0", at: at("13:00") })?.id).toBe("client");
  });

  it("otherwise picks the event on now (from 10 minutes early), never all-day ones", () => {
    expect(eventForCall(events, { at: at("09:22") })?.id).toBe("standup");
    expect(eventForCall(events, { at: at("10:05") })?.id).toMatch(/client|focus/);
    expect(eventForCall(events, { at: at("12:30") })).toBeNull();
    // A call on an unknown Meet link doesn't take another call's event.
    expect(eventForCall(events, { code: "qqq-wwww-eee", at: at("10:05") })?.id).toBe("focus");
  });

  it("keeps what meeting prep needs, and matches the next event in the series", () => {
    const ref = eventRef(events[2]);
    expect(ref).toEqual({ id: "client", title: "client", start: "10:00", end: "11:00", attendees: [{ name: "Priya Shah", email: "priya@acme.com" }] });
    expect(sameSeries("abc123_20261123T100000Z", "abc123_20261130T100000Z")).toBe(true);
    expect(sameSeries("abc", "xyz")).toBe(false);
    const past = { id: "m1", title: "Untitled", meetingCode: null, url: "", transcript: [], summary: null, calendarEvent: { id: "abc123_20261116T100000Z", title: "Weekly", start: "10:00", end: "10:30" } };
    expect(matchMeeting(ev("abc123_20261123T100000Z", "10:00", "10:30", { title: "Weekly" }), past as never)).toBe("link");
  });
});
