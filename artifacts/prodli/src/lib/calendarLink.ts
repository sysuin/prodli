// Meetings tied to calendar events: when a recording starts, ProdLi looks at
// today's Google Calendar (only if it's connected) and files the meeting under
// the event that's on now: the same Meet link wins, otherwise the event whose
// time covers now (from 10 minutes before its start). The meeting then shows
// the event, takes its title if it had none, and meeting prep finds it for the
// next event in the series. Nothing is sent anywhere.

import type { CalendarEvent } from "./calendar";
import type { CalendarEventRef } from "../recorder/types";
import { meetCode } from "./meetingPrep";

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

/** Pure: the event a call starting at `at` belongs to, or null. */
export function eventForCall(events: CalendarEvent[], call: { code?: string | null; url?: string | null; at: Date }): CalendarEvent | null {
  const code = (call.code ?? meetCode(call.url))?.toLowerCase() ?? null;
  const timed = events.filter((e) => !e.allDay && e.start);
  if (code) {
    const byLink = timed.find((e) => meetCode(e.meetLink) === code);
    if (byLink) return byLink;
  }
  const now = call.at.getHours() * 60 + call.at.getMinutes();
  const covering = timed
    .filter((e) => {
      const start = minutesOf(e.start!);
      const end = e.end ? minutesOf(e.end) : start + 30;
      return now >= start - 10 && now < Math.max(end, start + 1);
    })
    // Another call's link means it's not this one.
    .filter((e) => !code || !meetCode(e.meetLink));
  if (!covering.length) return null;
  return covering.sort((a, b) => Math.abs(minutesOf(a.start!) - now) - Math.abs(minutesOf(b.start!) - now))[0];
}

export function eventRef(e: CalendarEvent): CalendarEventRef {
  return { id: e.id, title: e.title, start: e.start, end: e.end, attendees: e.attendees?.slice(0, 30) };
}

/** Recurring events share an id before "_" (the instance's date): the same series. */
export const sameSeries = (a: string, b: string) => a === b || a.split("_")[0] === b.split("_")[0];

/** Files a just-started meeting under today's matching calendar event (best effort; never throws). */
export async function linkCalendarEvent(meetingId: string, call: { code?: string | null; url?: string | null; at: Date }): Promise<CalendarEventRef | null> {
  try {
    const { isCalendarConnected, todaysEvents, calendarAvailable } = await import("./calendar");
    if (!calendarAvailable() || !(await isCalendarConnected())) return null;
    const event = eventForCall(await todaysEvents(false, call.at), call);
    if (!event) return null;
    const ref = eventRef(event);
    const { updateMeeting } = await import("../recorder/db");
    const { isPlaceholderTitle } = await import("../recorder/calls");
    await updateMeeting(meetingId, (m) => ({ calendarEvent: ref, ...(isPlaceholderTitle(m.title) && event.title !== "(No title)" ? { title: event.title } : {}) }));
    return ref;
  } catch {
    return null;
  }
}
