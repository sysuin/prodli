// Every ProdLi section in one place: label, icon, colour, group, shortcut.
// The sidebar, the phone tab bar, the command palette and keyboard shortcuts
// all read from this list, so a new section is one entry here plus its
// component in App.tsx.
import type { Section } from "../types";

export type SectionGroup = "plan" | "create" | "focus";

export interface SectionDef {
  key: Section;
  label: string;
  emoji: string;
  accent: string;
  group: SectionGroup;
  /** Ctrl/⌘ + this key opens the section. */
  shortcut: string;
  /** One line for the command palette. */
  description: string;
}

export const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "create", label: "Create" },
  { id: "focus", label: "Focus" },
];

export const SECTIONS: SectionDef[] = [
  { key: "today", label: "Today", emoji: "☀️", accent: "#F59E0B", group: "plan", shortcut: "0", description: "Daily brief, plan your day, agenda" },
  { key: "todos", label: "To-Dos", emoji: "✅", accent: "#00BCD4", group: "plan", shortcut: "2", description: "Tasks with priorities and due dates" },
  { key: "habits", label: "Habits", emoji: "🎯", accent: "#66BB6A", group: "plan", shortcut: "4", description: "Daily habits and streaks" },
  { key: "editor", label: "Notes", emoji: "✍️", accent: "#FFD700", group: "create", shortcut: "1", description: "Rich notes with checklists and tables" },
  { key: "meetings", label: "Meetings", emoji: "🎙️", accent: "#FF4FA3", group: "create", shortcut: "6", description: "AI notes for Google Meet" },
  { key: "files", label: "Files", emoji: "📄", accent: "#FF9800", group: "create", shortcut: "7", description: "Preview Markdown, CSV, JSON and code" },
  { key: "pomodoro", label: "Pomodoro", emoji: "🍅", accent: "#FF6B6B", group: "focus", shortcut: "3", description: "Focus timer with breaks" },
  { key: "tracker", label: "Time Tracker", emoji: "⏱", accent: "#A78BFA", group: "focus", shortcut: "5", description: "Where your browsing time goes" },
];

/** The phone tab bar shows these; everything else is under "More". */
export const MOBILE_TABS: Section[] = ["today", "editor", "todos"];

export const sectionByKey = (key: Section) => SECTIONS.find((s) => s.key === key)!;
export const sectionByShortcut = (key: string) => SECTIONS.find((s) => s.shortcut === key);
