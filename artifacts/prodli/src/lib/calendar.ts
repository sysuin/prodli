// Optional, read-only Google Calendar: today's events for the Today section and
// the daily brief. Events are read in the browser with the user's Google token
// and never stored on ProdLi's servers (only what ends up in the brief text).
//
// Extension: chrome.identity with the calendar.readonly scope.
// Web app:   Google Identity Services token client (a popup the first time).
// Desktop app: not yet (Google's web sign-in doesn't run inside apps; it needs
//             its own "Desktop" OAuth client and a browser hand-off).

import { googleConfigured, getToken, PROFILE_SCOPES } from "./google";
import { isDesktop } from "./desktop";
import { accountRequest } from "./prodliAccount";
import { storageGet, storageSet } from "./storage";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_KEY = "calendarConnected";

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

export class CalendarError extends Error {}

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.identity;
/** Test builds only: canned events instead of Google Calendar. */
const calendarStub = (): (() => CalendarEvent[]) | undefined => (import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliCalendarStub?: () => CalendarEvent[] }).__prodliCalendarStub : undefined);

/** Can this build connect a calendar at all? */
export function calendarAvailable(): boolean {
  if (calendarStub()) return true;
  if (isDesktop()) return false;
  return isExtension() ? googleConfigured() : typeof window !== "undefined";
}

export function isCalendarConnected(): Promise<boolean> {
  if (calendarStub()) return Promise.resolve(true);
  return storageGet<boolean>(CALENDAR_KEY, false);
}

let webToken: { token: string; expires: number } | null = null;

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}
interface GoogleOAuth {
  accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; prompt?: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type: string }) => void }): TokenClient } };
}

async function webAccessToken(interactive: boolean): Promise<string> {
  if (webToken && webToken.expires > Date.now() + 60_000) return webToken.token;
  if (!interactive) throw new CalendarError("Reconnect Google Calendar to see today's events.");
  const { googleWebClientId } = await accountRequest<{ googleWebClientId: string | null }>("/api/config");
  if (!googleWebClientId) throw new CalendarError("Google sign-in isn't set up on this server.");
  const w = window as unknown as { google?: GoogleOAuth };
  if (!w.google?.accounts?.oauth2) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = () => resolve();
      s.onerror = () => reject(new CalendarError("Google didn't load. Check your connection."));
      document.head.appendChild(s);
    });
  }
  return new Promise((resolve, reject) => {
    const client = w.google!.accounts.oauth2.initTokenClient({
      client_id: googleWebClientId,
      scope: CALENDAR_SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new CalendarError(r.error === "access_denied" ? "Calendar access wasn't allowed." : "Couldn't connect Google Calendar."));
        webToken = { token: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new CalendarError(e.type === "popup_closed" ? "The Google window was closed." : "Couldn't connect Google Calendar.")),
    });
    client.requestAccessToken();
  });
}

async function accessToken(interactive: boolean): Promise<string> {
  if (isExtension()) {
    try {
      return await getToken(interactive, [...PROFILE_SCOPES, CALENDAR_SCOPE]);
    } catch (err) {
      throw new CalendarError(err instanceof Error ? err.message : "Couldn't connect Google Calendar.");
    }
  }
  return webAccessToken(interactive);
}

/** Asks for read-only calendar access (the user clicked "Connect"). */
export async function connectCalendar(): Promise<void> {
  await accessToken(true);
  await storageSet(CALENDAR_KEY, true);
}

export async function disconnectCalendar(): Promise<void> {
  webToken = null;
  await storageSet(CALENDAR_KEY, false);
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

interface ApiEvent {
  id: string;
  summary?: string;
  status?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; resource?: boolean; responseStatus?: string; displayName?: string; email?: string }[];
}

/** Pure: Google Calendar API items → today's events (declined and cancelled ones dropped). */
export function toEvents(items: ApiEvent[]): CalendarEvent[] {
  return items
    .filter((e) => e.status !== "cancelled" && !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
    .map((e) => {
      const allDay = !e.start?.dateTime;
      return {
        id: e.id,
        title: e.summary?.trim() || "(No title)",
        start: allDay ? null : hm(new Date(e.start!.dateTime!)),
        end: allDay || !e.end?.dateTime ? null : hm(new Date(e.end.dateTime)),
        allDay,
        location: e.location,
        meetLink: e.hangoutLink,
        attendees: e.attendees
          ?.filter((a) => !a.self && !a.resource && a.responseStatus !== "declined")
          .slice(0, 30)
          .map((a) => ({ name: a.displayName?.trim() || undefined, email: a.email || undefined })),
      };
    })
    .sort((a, b) => (a.allDay === b.allDay ? (a.start ?? "").localeCompare(b.start ?? "") : a.allDay ? -1 : 1));
}

/** Today's events from the primary calendar. `interactive`: may show Google's prompt. */
export async function todaysEvents(interactive = false, day = new Date()): Promise<CalendarEvent[]> {
  const stub = calendarStub();
  if (stub) return stub();
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start.getTime() + 86_400_000);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`;
  let token = await accessToken(interactive);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 && isExtension()) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await accessToken(interactive);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (res.status === 401 || res.status === 403) {
    if (!isExtension()) webToken = null;
    throw new CalendarError("Reconnect Google Calendar to see today's events.");
  }
  if (!res.ok) throw new CalendarError(`Google Calendar didn't respond (${res.status}).`);
  return toEvents(((await res.json()) as { items?: ApiEvent[] }).items ?? []);
}
