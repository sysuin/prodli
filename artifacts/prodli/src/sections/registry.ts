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
  /** A sentence or two for the welcome screen. */
  pitch: string;
}

export const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "create", label: "Create" },
  { id: "focus", label: "Focus" },
];

export const SECTIONS: SectionDef[] = [
  { key: "today", label: "Today", emoji: "☀️", accent: "#F59E0B", group: "plan", shortcut: "0", description: "Daily brief, plan your day, agenda", pitch: "A daily brief that plans your day around your calendar, tasks and habits — plus an evening wrap-up." },
  { key: "review", label: "Review", emoji: "📊", accent: "#14B8A6", group: "plan", shortcut: "8", description: "Weekly review: wins, what slipped, next week's priorities", pitch: "Each week: what got done, what slipped, how habits and focus went, and three priorities for next week." },
  { key: "todos", label: "To-Dos", emoji: "✅", accent: "#00BCD4", group: "plan", shortcut: "2", description: "Tasks with priorities and due dates", pitch: "Tasks with priorities, due dates and subtasks. Type “Call Sam friday !high” and ProdLi fills in the rest." },
  { key: "habits", label: "Habits", emoji: "🎯", accent: "#66BB6A", group: "plan", shortcut: "4", description: "Daily habits and streaks", pitch: "Daily check-ins with streaks and a heatmap calendar." },
  { key: "editor", label: "Notes", emoji: "✍️", accent: "#FFD700", group: "create", shortcut: "1", description: "Rich notes with checklists and tables", pitch: "Rich notes with checklists, tables and a “/” menu. Paste Markdown, pin, export or print." },
  { key: "meetings", label: "Meetings", emoji: "🎙️", accent: "#FF4FA3", group: "create", shortcut: "6", description: "AI notes for calls and in person", pitch: "AI notes for Meet, Zoom, Teams, Webex, Slack and other calls, or meetings in the room, without a bot joining: transcript, summary and action items." },
  { key: "files", label: "Files", emoji: "📄", accent: "#FF9800", group: "create", shortcut: "7", description: "Preview Markdown, CSV, JSON and code", pitch: "Open Markdown, CSV, JSON and code files nicely — drop them anywhere in Chrome — and save them as notes." },
  { key: "pomodoro", label: "Pomodoro", emoji: "🍅", accent: "#FF6B6B", group: "focus", shortcut: "3", description: "Focus timer with breaks", pitch: "A focus timer that keeps running across tabs and tells you when to take a break." },
  { key: "tracker", label: "Time Tracker", emoji: "⏱", accent: "#A78BFA", group: "focus", shortcut: "5", description: "Where your browsing time goes", pitch: "See where your browsing time goes, and set daily limits for distracting sites." },
];

/** The phone tab bar shows these; everything else is under "More". */
export const MOBILE_TABS: Section[] = ["today", "editor", "todos"];

export const sectionByKey = (key: Section) => SECTIONS.find((s) => s.key === key)!;
export const sectionByShortcut = (key: string) => SECTIONS.find((s) => s.shortcut === key);

/** Opens a section from anywhere in the app (App.tsx listens). */
export const GO_EVENT = "prodli-go";
export function openSection(section: Section): void {
  window.dispatchEvent(new CustomEvent(GO_EVENT, { detail: { section } }));
}
