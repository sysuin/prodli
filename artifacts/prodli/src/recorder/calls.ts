// Which calls ProdLi can record, from a tab's address (pure, unit-tested).
//
//  - Google Meet: meet.google.com/abc-defg-hij. Transcript from Meet's captions.
//  - Zoom (in the browser): zoom.us/wc/<meeting id>/join, or /wc/join/<id>.
//  - Microsoft Teams (in the browser): teams.microsoft.com, teams.live.com or
//    teams.cloud.microsoft. Teams addresses don't show whether you're in a
//    call, so ProdLi records the tab when you click it there.
// Zoom and Teams have no captions ProdLi reads: their audio is recorded and
// transcribed after the call (AI transcription when signed in, or on-device).

/** "in-person": recorded from the microphone on the Meetings page (recorder/inPerson.ts), not a call tab. */
export type CallPlatform = "google-meet" | "zoom" | "teams" | "in-person";

export interface CallInfo {
  platform: CallPlatform;
  /** Meet code (abc-defg-hij) or Zoom meeting ID (digits); null for Teams. */
  code: string | null;
}

export const PLATFORM_LABEL: Record<CallPlatform, string> = { "google-meet": "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", "in-person": "In person" };

const TEAMS_HOSTS = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"];
const isZoomHost = (h: string) => h === "zoom.us" || h.endsWith(".zoom.us") || h === "zoomgov.com" || h.endsWith(".zoomgov.com");

const parse = (url: string | undefined): URL | null => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** The meeting code (abc-defg-hij) of a Google Meet call URL, wherever it is in the path. */
export function meetingCodeFromUrl(url: string | undefined): string | null {
  const u = parse(url);
  if (!u || u.hostname !== "meet.google.com") return null;
  return /(?:^|\/)([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
}

/** The meeting ID of a Zoom web-client call (zoom.us/wc/123456789/join or /wc/join/123456789). */
export function zoomMeetingId(url: string | undefined): string | null {
  const u = parse(url);
  if (!u || !isZoomHost(u.hostname)) return null;
  return /^\/wc\/(?:join\/)?(\d{9,12})(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
}

export function isTeamsUrl(url: string | undefined): boolean {
  const u = parse(url);
  return !!u && TEAMS_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/** The call on this tab, if ProdLi can record it. */
export function callFromUrl(url: string | undefined): CallInfo | null {
  const meet = meetingCodeFromUrl(url);
  if (meet) return { platform: "google-meet", code: meet };
  const zoom = zoomMeetingId(url);
  if (zoom) return { platform: "zoom", code: zoom };
  if (isTeamsUrl(url)) return { platform: "teams", code: null };
  return null;
}

/** "86012345678" → "860 1234 5678" (how Zoom shows meeting IDs). */
export function formatZoomId(id: string): string {
  return id.length === 11 ? `${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7)}` : id.length === 10 ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : id;
}

/** The meeting's starting title, until the page or the summary gives a better one. */
export function placeholderTitle(call: CallInfo): string {
  if (call.platform === "google-meet") return `Google Meet · ${call.code}`;
  if (call.platform === "zoom") return `Zoom · ${formatZoomId(call.code ?? "")}`;
  return "Teams · meeting";
}

/** Still the starting title (so a page or summary title may replace it)? */
export function isPlaceholderTitle(title: string): boolean {
  return /^(Google Meet|Zoom|Teams|In person) · /.test(title);
}

/** A meeting name from a Zoom or Teams tab title, if it has one ("Weekly sync | Microsoft Teams" → "Weekly sync"). */
export function titleFromTab(platform: CallPlatform, tabTitle: string | undefined): string | null {
  if (!tabTitle || platform === "google-meet") return null;
  const t = tabTitle
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[|\-–]\s*(Microsoft Teams|Teams|Zoom( Meeting| Workplace)?)\s*$/i, "")
    .replace(/^(Microsoft Teams|Zoom( Meeting| Workplace)?)\s*[|\-–:]\s*/i, "")
    .trim();
  if (!t || /^(Microsoft Teams|Teams|Zoom( Meeting| Workplace)?|Meeting|Calendar|Chat|Activity)$/i.test(t) || /^meeting( compact)? view/i.test(t)) return null;
  return t.slice(0, 200);
}

/** Still in the call this recording started on? (Leaving it stops the recording.) */
export function stillInCall(platform: CallPlatform, url: string | undefined): boolean {
  if (platform === "google-meet") return !!meetingCodeFromUrl(url);
  if (platform === "zoom") return !!zoomMeetingId(url);
  if (platform === "teams") return isTeamsUrl(url);
  return true; // in person: not tied to a tab
}

/** Why recording can't start on this tab, in plain words (null when it can). */
export function notACallReason(url: string | undefined): string | null {
  if (callFromUrl(url)) return null;
  if (!url) return "ProdLi couldn't read this tab's address. Click the ProdLi icon while the call is the active tab.";
  const u = parse(url);
  if (u?.hostname === "meet.google.com") return "Join the call first: ProdLi records once you're in a meeting (the address looks like meet.google.com/abc-defg-hij).";
  if (u?.hostname === "mail.google.com" || u?.hostname === "calendar.google.com") return "Meet calls inside Gmail or Calendar can't be recorded. Open the call in its own tab at meet.google.com, then click the ProdLi icon.";
  if (u && isZoomHost(u.hostname)) return "Join the Zoom meeting in your browser first (choose “Join from your browser”; the address has /wc/), then click the ProdLi icon.";
  return "ProdLi records Google Meet, Zoom and Microsoft Teams calls in the browser. Join a call, then click the ProdLi icon (or press Alt+Shift+R) on that tab.";
}
