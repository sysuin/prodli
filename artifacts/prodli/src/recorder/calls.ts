// Which calls ProdLi can record, from a tab's address (pure, unit-tested).
//
//  - Google Meet: meet.google.com/abc-defg-hij. Transcript from Meet's captions.
//  - Zoom (in the browser): zoom.us/wc/<meeting id>/join, or /wc/join/<id>.
//  - Microsoft Teams, Webex, Slack (huddles), Discord (voice), Jitsi and
//    Whereby in the browser (see CALL_APPS). Several of these don't show in the
//    address whether you're in a call, so ProdLi records the tab you click on.
//  - Any other website, only if the user turns on "Record any website" in
//    Meetings → Setup ("browser" platform).
// Apart from Meet, no captions are read: the tab's audio is recorded and
// transcribed after the call (AI transcription when signed in, or on-device).

/** "in-person": recorded from the microphone on the Meetings page (recorder/inPerson.ts), not a call tab. */
export type CallPlatform = "google-meet" | "zoom" | "teams" | "webex" | "slack" | "discord" | "jitsi" | "whereby" | "browser" | "in-person" | "desktop";

export interface CallInfo {
  platform: CallPlatform;
  /** Meet code (abc-defg-hij), Zoom meeting ID (digits), Jitsi/Whereby room, the site for "browser"; null otherwise. */
  code: string | null;
}

export const PLATFORM_LABEL: Record<CallPlatform, string> = {
  "google-meet": "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  webex: "Webex",
  slack: "Slack",
  discord: "Discord",
  jitsi: "Jitsi Meet",
  whereby: "Whereby",
  browser: "Browser call",
  "in-person": "In person",
  desktop: "Call",
};

const parse = (url: string | undefined): URL | null => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
const onHost = (h: string, domain: string) => h === domain || h.endsWith(`.${domain}`);
const isZoomHost = (h: string) => onHost(h, "zoom.us") || onHost(h, "zoomgov.com");

/** Whereby pages that aren't rooms. */
const WHEREBY_PAGES = new Set(["", "user", "information", "login", "signup", "pricing", "business", "blog", "embed", "org", "dashboard"]);

/**
 * Call apps recognised by address (besides Meet and Zoom). `match` returns the
 * call (with a room code where the address has one), or null.
 */
const CALL_APPS: { platform: CallPlatform; match: (u: URL) => string | null | false }[] = [
  { platform: "teams", match: (u) => (["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].some((d) => onHost(u.hostname, d)) ? null : false) },
  { platform: "webex", match: (u) => (onHost(u.hostname, "webex.com") ? null : false) },
  // Huddles run inside the Slack client tab.
  { platform: "slack", match: (u) => (u.hostname === "app.slack.com" ? null : false) },
  // Voice channels and calls run inside a channel page.
  { platform: "discord", match: (u) => ((u.hostname === "discord.com" || u.hostname === "ptb.discord.com" || u.hostname === "canary.discord.com") && u.pathname.startsWith("/channels/") ? null : false) },
  {
    platform: "jitsi",
    match: (u) => {
      if (u.hostname !== "meet.jit.si" && u.hostname !== "8x8.vc") return false;
      const room = u.pathname.split("/").filter(Boolean).pop() ?? "";
      return room && !/^(static|libs|sounds|images)$/.test(room) ? decodeURIComponent(room).slice(0, 80) : false;
    },
  },
  {
    platform: "whereby",
    match: (u) => {
      if (!onHost(u.hostname, "whereby.com")) return false;
      const room = u.pathname.split("/").filter(Boolean)[0] ?? "";
      return WHEREBY_PAGES.has(room.toLowerCase()) ? false : decodeURIComponent(room).slice(0, 80);
    },
  },
];

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
  return callFromUrl(url)?.platform === "teams";
}

/** The call on this tab, if ProdLi recognises it. */
export function callFromUrl(url: string | undefined): CallInfo | null {
  const meet = meetingCodeFromUrl(url);
  if (meet) return { platform: "google-meet", code: meet };
  const zoom = zoomMeetingId(url);
  if (zoom) return { platform: "zoom", code: zoom };
  const u = parse(url);
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
  for (const app of CALL_APPS) {
    const m = app.match(u);
    if (m !== false) return { platform: app.platform, code: m };
  }
  return null;
}

/** Any ordinary web page, for "Record any website" (Setup): never ProdLi's own pages or browser pages. */
export function anyWebsiteCall(url: string | undefined): CallInfo | null {
  const u = parse(url);
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
  return { platform: "browser", code: u.hostname.replace(/^www\./, "") };
}

/** "86012345678" → "860 1234 5678" (how Zoom shows meeting IDs). */
export function formatZoomId(id: string): string {
  return id.length === 11 ? `${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7)}` : id.length === 10 ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : id;
}

/** The meeting's starting title, until the page or the summary gives a better one. */
export function placeholderTitle(call: CallInfo): string {
  switch (call.platform) {
    case "google-meet":
      return `Google Meet · ${call.code}`;
    case "zoom":
      return `Zoom · ${formatZoomId(call.code ?? "")}`;
    case "teams":
      return "Teams · meeting";
    case "slack":
      return "Slack · huddle";
    case "discord":
      return "Discord · call";
    case "jitsi":
    case "whereby":
      return `${PLATFORM_LABEL[call.platform]} · ${call.code ?? "meeting"}`;
    case "browser":
      return `Browser call · ${call.code ?? "website"}`;
    default:
      return `${PLATFORM_LABEL[call.platform]} · meeting`;
  }
}

/** Still the starting title (so a page or summary title may replace it)? */
export function isPlaceholderTitle(title: string): boolean {
  return /^(Google Meet|Zoom|Teams|Webex|Slack|Discord|Jitsi Meet|Whereby|Browser call|In person|Call) · /.test(title);
}

/** App names that tab titles add around the meeting's name. */
const APP_NAMES = "Microsoft Teams|Teams|Zoom(?: Meeting| Workplace)?|Webex(?: Meetings)?|Cisco Webex(?: Meetings)?|Slack|Discord|Jitsi Meet|Whereby";
const GENERIC_TITLES = new RegExp(`^(${APP_NAMES}|Meeting|Calendar|Chat|Activity|Huddle|Home|Inbox|Threads|DMs|Direct Messages|Friends|Loading.*)$`, "i");

/** A meeting name from a call tab's title, if it has one ("Weekly sync | Microsoft Teams" → "Weekly sync"). */
export function titleFromTab(platform: CallPlatform, tabTitle: string | undefined): string | null {
  if (!tabTitle || platform === "google-meet" || platform === "in-person") return null;
  const t = tabTitle
    .replace(/^\(\d+\)\s*/, "")
    .replace(/^[•●]\s*/, "")
    .replace(new RegExp(`\\s*[|\\-–]\\s*(${APP_NAMES})\\s*$`, "i"), "")
    .replace(new RegExp(`^(${APP_NAMES})\\s*[|\\-–:]\\s*`, "i"), "")
    .trim();
  if (!t || GENERIC_TITLES.test(t) || /^meeting( compact)? view/i.test(t)) return null;
  return t.slice(0, 200);
}

/** Still in the call this recording started on? (Leaving it stops the recording.) */
export function stillInCall(platform: CallPlatform, url: string | undefined): boolean {
  if (platform === "google-meet") return !!meetingCodeFromUrl(url);
  if (platform === "zoom") return !!zoomMeetingId(url);
  if (platform === "browser" || platform === "in-person") return true; // stops when you click Stop or close the tab
  // The other apps: still on that app's pages.
  return callFromUrl(url)?.platform === platform;
}

/** The apps ProdLi recognises, for messages. */
export const SUPPORTED_APPS = "Google Meet, Zoom, Microsoft Teams, Webex, Slack huddles, Discord, Jitsi and Whereby";

/** Why recording can't start on this tab, in plain words (null when it can). */
export function notACallReason(url: string | undefined): string | null {
  if (callFromUrl(url)) return null;
  if (!url) return "ProdLi couldn't read this tab's address. Click the ProdLi icon while the call is the active tab.";
  const u = parse(url);
  if (u?.hostname === "meet.google.com") return "Join the call first: ProdLi records once you're in a meeting (the address looks like meet.google.com/abc-defg-hij).";
  if (u?.hostname === "mail.google.com" || u?.hostname === "calendar.google.com") return "Meet calls inside Gmail or Calendar can't be recorded. Open the call in its own tab at meet.google.com, then click the ProdLi icon.";
  if (u && isZoomHost(u.hostname)) return "Join the Zoom meeting in your browser first (choose “Join from your browser”; the address has /wc/), then click the ProdLi icon.";
  if (u && (u.hostname === "discord.com" || u.hostname.endsWith(".discord.com"))) return "Open the Discord voice channel or call in the browser (the address has /channels/), then click the ProdLi icon.";
  return `ProdLi records calls in the browser on ${SUPPORTED_APPS}. For another call app, turn on “Record any website” in Meetings → Setup, then click the ProdLi icon on the call's tab.`;
}
