// Commands the desktop app's menu bar, tray / dock menu and shortcuts send to the
// main window (artifacts/prodli-desktop/src/main/menu.ts builds the same strings).
// A command is a plain string so it crosses the bridge without surprises:
//   "go:<section>"  "settings[:<tab>]"  "search"  "ask"  "quick-add"  "daily-note"  "record-call"

import type { SettingsTab } from "../components/Settings";
import type { Section } from "../types";

const SECTIONS: readonly Section[] = ["today", "review", "todos", "habits", "editor", "meetings", "files", "pomodoro", "tracker"];
const TABS: readonly SettingsTab[] = ["account", "plan", "devices", "data", "appearance", "desktop", "writing", "today", "pomodoro", "tracker", "meetings", "files", "help", "about"];

export type DesktopCommand =
  | { kind: "go"; section: Section }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "search" | "ask" | "quick-add" | "daily-note" | "record-call" };

export function parseDesktopCommand(raw: unknown): DesktopCommand | null {
  if (typeof raw !== "string") return null;
  const [head, arg] = raw.split(":", 2);
  if (head === "go") return (SECTIONS as readonly string[]).includes(arg ?? "") ? { kind: "go", section: arg as Section } : null;
  if (head === "settings") return arg === undefined ? { kind: "settings", tab: "appearance" } : (TABS as readonly string[]).includes(arg) ? { kind: "settings", tab: arg as SettingsTab } : null;
  if (arg === undefined && (head === "search" || head === "ask" || head === "quick-add" || head === "daily-note" || head === "record-call")) return { kind: head };
  return null;
}
