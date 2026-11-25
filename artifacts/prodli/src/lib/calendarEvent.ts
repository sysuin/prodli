// A calendar event as ProdLi uses it (lib/calendar.ts reads them from Google).
// Its own file so pure code (time blocks, the desktop menu bar) can use the type
// without pulling in the Google Calendar code.

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null; // HH:MM (local) or null for all-day
  end: string | null;
  allDay: boolean;
  location?: string;
  meetLink?: string;
  /** Other people invited (not you, not rooms). Used on this device for meeting prep. */
  attendees?: { name?: string; email?: string }[];
}
