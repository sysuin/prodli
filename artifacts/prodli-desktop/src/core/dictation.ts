// Dictation into any app (Settings › Desktop app): press the shortcut in any
// app, talk, press it again. A small pill floats at the bottom of the screen
// without taking the focus; the text is cleaned up and pasted where the cursor
// is (clipboard + a simulated ⌘V / Ctrl+V; the clipboard is put back after).
//
// Pure helpers here; main/dictation.ts runs them.

export { appCategory, appFieldKind } from "../../../prodli/src/dictation/core";
export { DEFAULT_DICTATE_SHORTCUT, DICTATE_SHORTCUTS, shortcutLabel, type DictateShortcut } from "../../../prodli/src/lib/desktop";

export const PILL_SIZE = { width: 380, height: 72 };

/** Bottom centre of the screen the mouse is on, just above the dock / taskbar. */
export function pillBounds(workArea: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(workArea.x + (workArea.width - PILL_SIZE.width) / 2),
    y: Math.round(workArea.y + workArea.height - PILL_SIZE.height - 24),
    ...PILL_SIZE,
  };
}

/** The command that presses paste in the app in front, or null when this computer can't. */
export function pasteCommand(platform: NodeJS.Platform): { file: string; args: string[] } | null {
  if (platform === "darwin") return { file: "osascript", args: ["-e", 'tell application "System Events" to keystroke "v" using command down'] };
  if (platform === "win32")
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"],
    };
  if (platform === "linux") return { file: "xdotool", args: ["key", "--clearmodifiers", "ctrl+v"] };
  return null;
}

/** Windows: the app in front, once (its description, e.g. "Microsoft Outlook", or the process name). */
export const WINDOWS_FRONT_APP_ONCE = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class ProdLiFgOnce {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$p = 0
[void][ProdLiFgOnce]::GetWindowThreadProcessId([ProdLiFgOnce]::GetForegroundWindow(), [ref]$p)
if ($p -ne 0) { $pr = Get-Process -Id $p; if ($pr) { $d = $pr.MainModule.FileVersionInfo.FileDescription; if ($d) { $d } else { $pr.ProcessName } } }`;

/** Messages to the pill window and what paste() did (the bridge's types). */
export type { DesktopDictationControl as PillControl, DesktopPasteResult as PasteResult } from "../../../prodli/src/lib/desktop";
