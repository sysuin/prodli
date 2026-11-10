export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  /** True until the user renames the note: the title follows the first line. */
  autoTitle?: boolean;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
  subtasks?: Subtask[];
  /** Day (YYYY-MM-DD) the user planned to do it — set from Today → Plan your day. */
  plannedFor?: string;
  /** Rough time estimate in minutes (Plan your day). */
  estimateMin?: number;
  /** A time block for it on a day (Today → Time blocks): start "HH:MM", length = estimateMin (or 30). */
  block?: { day: string; start: string };
  /** When it was completed (ISO) — lets the evening review and tomorrow's brief see what got done. */
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  completedDays: string[];
  createdAt: string;
  updatedAt?: string;
  archived: boolean;
}

/** One record per day (Today section): focus, the AI brief, the evening reflection. Synced. */
export interface DayRecord {
  id: string; // YYYY-MM-DD
  focus?: string;
  reflection?: string;
  brief?: DailyBrief;
  /** Fingerprint of the tasks and events the brief was written from (to notice when it's out of date). */
  briefBasis?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DailyBrief {
  headline: string;
  summary: string;
  priorities: { title: string; reason: string }[];
  schedule: { start: string; end: string; title: string; kind: "meeting" | "focus" | "task" | "break" | "habit" }[];
  watchouts: string[];
  habits: string[];
  tip: string;
  model: string;
  generatedAt: string;
  /** "ai" from ProdLi's server, "basic" built on the device without AI. */
  source?: "ai" | "basic";
}

export interface TodaySettings {
  workStart: string; // HH:MM
  workEnd: string;
  /** Daily reminder time (extension notification), or null for none. */
  reminder: string | null;
  /** Open ProdLi on Today the first time each day. */
  startOnToday: boolean;
  /** Write the AI brief automatically the first time Today opens each day. */
  autoBrief: boolean;
  /** Notify when a time block starts (extension). */
  blockReminders?: boolean;
}

export type Section = "today" | "editor" | "todos" | "pomodoro" | "habits" | "tracker" | "meetings" | "files";

export interface FocusRule {
  id: string;
  domain: string;
  limitMinutes: number;
  redirectEnabled: boolean;
}

export interface TrackerSettings {
  idleThreshold: number;
  notifyEnabled: boolean;
  notifyTime: string;
  focusList: FocusRule[];
  excludedDomains: string[];
}

export type TimeTrackingDay = Record<string, number>;
