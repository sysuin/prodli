// Time in apps on this computer (Time Tracker › Apps, desktop app only, opt-in).
// Every few seconds the app notes which app is in front; while you're idle
// nothing is counted. Totals per day live in the store under apps_YYYY-MM-DD
// ({ "Slack": 1840, … } in seconds), on this computer only (not synced).
//
//   macOS:   NSWorkspace's frontmost app (no permission needed), via a JXA one-liner
//   Windows: GetForegroundWindow in a long-running PowerShell loop
//
// Pure helpers here; main/appTracker.ts runs them.

export { APP_TRACKING_KEY, APPS_DAY, appsDayKey, topApps } from "../../../prodli/src/lib/appUsage";

export const MAC_FRONT_APP_SCRIPT = 'ObjC.import("AppKit"); const a = $.NSWorkspace.sharedWorkspace.frontmostApplication; a ? a.localizedName.js : ""';

/** Prints the foreground app's name (its description, e.g. "Microsoft Teams", or process name) every `seconds`. */
export function windowsForegroundScript(seconds: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class ProdLiFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
while ($true) {
  $n = ''
  $p = 0
  [void][ProdLiFg]::GetWindowThreadProcessId([ProdLiFg]::GetForegroundWindow(), [ref]$p)
  if ($p -ne 0) {
    $pr = Get-Process -Id $p
    if ($pr) { $d = $pr.MainModule.FileVersionInfo.FileDescription; $n = if ($d) { $d } else { $pr.ProcessName } }
  }
  [Console]::Out.WriteLine($n)
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${Math.max(1, Math.round(seconds))}
}`;
}

/** PowerShell -EncodedCommand wants UTF-16LE base64. */
export const encodePowerShell = (script: string) => Buffer.from(script, "utf16le").toString("base64");

/** Names that aren't really "an app you used". */
const IGNORE = new Set(["", "loginwindow", "ScreenSaverEngine", "Dock", "explorer", "Windows Explorer", "LockApp", "Search", "SearchHost", "ShellExperienceHost", "StartMenuExperienceHost", "Idle"]);

/** A tidy app name from a sample, or null to skip it. */
export function cleanAppName(raw: string): string | null {
  let n = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (IGNORE.has(n)) return null;
  // Windows file descriptions sometimes carry a vendor prefix or ".exe".
  n = n.replace(/\.exe$/i, "").replace(/^Microsoft®\s*/i, "").slice(0, 60);
  if (n === "File Explorer" || n === "Windows Explorer") return "File Explorer";
  return n || null;
}

/** Adds one sample to a day's totals (a sample counts at most `maxSeconds`, e.g. after sleep). */
export function addSample(day: Record<string, number> | undefined, app: string, seconds: number, maxSeconds = 60): Record<string, number> {
  const s = Math.max(0, Math.min(Math.round(seconds), maxSeconds));
  const out = { ...(day ?? {}) };
  if (s > 0) out[app] = (out[app] ?? 0) + s;
  return out;
}
