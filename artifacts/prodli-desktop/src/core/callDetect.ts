// "You're in a call — record it?": noticing that a call has started in another app.
//
// Windows: Windows records which apps are using the microphone right now
// (Settings → Privacy → Microphone shows the same list). In the registry, an app
// whose LastUsedTimeStop is 0 is using it at this moment — that works for any
// call app, packaged (new Teams) or not (Zoom, Slack, browsers).
//
// macOS has no such list without extra permissions, so it looks for helper
// processes that only run during a call (Zoom's CptHost, Webex's meeting process).
//
// Pure parsing here; main/callNudge.ts runs the commands and shows the reminder.

export const WINDOWS_MIC_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/** Call apps by a lower-case fragment of their executable / package name. */
const CALL_APPS: [fragment: string, name: string][] = [
  ["zoom", "Zoom"],
  ["msteams", "Microsoft Teams"],
  ["teams", "Microsoft Teams"],
  ["slack", "Slack"],
  ["webex", "Webex"],
  ["ciscocollabhost", "Webex"],
  ["discord", "Discord"],
  ["skype", "Skype"],
  ["facetime", "FaceTime"],
  ["whatsapp", "WhatsApp"],
  ["telegram", "Telegram"],
  ["signal", "Signal"],
  ["gotomeeting", "GoTo Meeting"],
  ["ringcentral", "RingCentral"],
];

/** Browsers (a Meet / web call): matched by their exact program name only. */
const BROWSERS = new Set(["chrome", "msedge", "firefox", "brave", "arc", "opera", "vivaldi", "safari"]);

/** ProdLi itself (and its development build) never counts. */
const SELF = /(^|[\\/#])(prodli|electron)(\.exe)?$/i;

export function callAppName(exeOrPackage: string): string | null {
  const s = exeOrPackage.toLowerCase();
  if (SELF.test(s)) return null;
  const base = s.split(/[\\/#]/).pop() ?? s;
  if (BROWSERS.has(base.replace(/\.exe$/, ""))) return "your browser";
  return CALL_APPS.find(([f]) => base.includes(f))?.[1] ?? null;
}

/**
 * Output of `reg query <WINDOWS_MIC_KEY> /s /v LastUsedTimeStop` → names of
 * call apps using the microphone right now.
 */
export function parseWindowsMicInUse(regOutput: string): string[] {
  const found = new Set<string>();
  let key = "";
  for (const raw of regOutput.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("HKEY_")) key = line;
    else if (/^LastUsedTimeStop\s+REG_QWORD\s+0x0+$/i.test(line) && key) {
      const app = callAppName(key.slice(key.lastIndexOf("\\") + 1));
      if (app) found.add(app);
    }
  }
  return [...found];
}

/** macOS processes that run only while a call is on. */
const MAC_IN_CALL: [process: string, name: string][] = [
  ["CptHost", "Zoom"],
  ["Meeting Center", "Webex"],
];

/** Output of `ps -axco comm` → call apps with a call in progress. */
export function parseMacInCall(psOutput: string): string[] {
  const procs = new Set(psOutput.split(/\r?\n/).map((l) => l.trim()));
  return [...new Set(MAC_IN_CALL.filter(([p]) => procs.has(p)).map(([, n]) => n))];
}

/** Which apps just started a call (to remind once per call, not every check). */
export function newCalls(before: readonly string[], now: readonly string[]): string[] {
  return now.filter((a) => !before.includes(a));
}

export function reminderText(apps: string[]): { title: string; body: string } {
  const app = apps[0];
  return {
    title: app === "your browser" ? "In a call in your browser?" : `In a ${app} call?`,
    body: "Click to record it with ProdLi — transcript, summary and action items, without a bot joining.",
  };
}
