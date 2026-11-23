export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  /** True until the user renames the note: the title follows the first line. */
  autoTitle?: boolean;
  /** A template (Editor → ▾ templates), kept out of the note list and search. */
  template?: boolean;
  /** The day (YYYY-MM-DD) this is the daily note for. */
  dailyFor?: string;
  /** Page icon (an emoji), shown above the note and in the list. */
  icon?: string;
  /** Cover colour band at the top of the note (a NOTE_COVERS id). */
  cover?: string;
  /** The web page this note is about (page summaries and saved highlights). */
  sourceUrl?: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

/** How a to-do repeats. Weekly with `weekdays` means on those days (0 = Sunday … 6 = Saturday). */
export interface Repeat {
  unit: "day" | "week" | "month" | "year";
  /** Every N units (1 = every day/week/month/year). */
  every: number;
  weekdays?: number[];
  /** Day of the month it started on, so "monthly on the 31st" comes back to the 31st after short months. */
  monthDay?: number;
}

/** A page saved to read later. Synced as the "readLater" collection. */
export interface ReadLaterItem {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  /** When it was opened or marked read. */
  readAt?: string;
  /** The to-do made from it (Add as to-do). */
  todoId?: string;
}

/** A quick link tile on Today. Synced as the "quickLinks" collection. */
export interface QuickLink {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
}

/** A saved set of browser tabs ("Saved tabs" on Today). Synced as the "tabSessions" collection. */
export interface TabSession {
  id: string;
  name: string;
  tabs: { url: string; title: string }[];
  createdAt: string;
  updatedAt?: string;
}

/** What a saved filter (or the current To-do view) shows. */
export interface TaskQuery {
  /** A list id, or "inbox" for tasks without a list. */
  list?: string;
  label?: string;
  priority?: "high" | "medium" | "low";
  due?: "overdue" | "today" | "week" | "none";
  status?: "active" | "completed";
  text?: string;
}

/** A to-do list (project) or a saved filter. Synced as the "lists" collection. */
export type ListItem =
  | { id: string; kind: "list"; name: string; emoji?: string; createdAt: string; updatedAt?: string }
  | { id: string; kind: "filter"; name: string; query: TaskQuery; createdAt: string; updatedAt?: string };

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
  /** Time on the due date ("HH:MM"). The extension sends a reminder then. */
  dueTime?: string;
  /** Repeating task: completing it saves a done copy and moves this one to its next date. */
  repeat?: Repeat;
  /** The list (project) it belongs to; none = Inbox. */
  listId?: string;
  /** Labels without the "@", e.g. ["errands", "waiting"]. */
  labels?: string[];
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
  /** Days it was done (check, count and timed habits). Quit habits use `log` instead. */
  completedDays: string[];
  createdAt: string;
  updatedAt?: string;
  archived: boolean;
  /** check (default): done or not · count: N times a day · timed: N minutes a day · quit: at most N a day. */
  kind?: "check" | "count" | "timed" | "quit";
  /** count: times · timed: minutes · quit: the most allowed (0 = none). */
  target?: number;
  /** count: what's counted, e.g. "glasses". */
  unit?: string;
  /** Day → amount (times, minutes, or slips for quit habits). */
  log?: Record<string, number>;
  /** Only these weekdays (0 = Sunday); missing = every day. Other days never break a streak. */
  days?: number[];
  /** Days skipped on purpose (sick, travel): they don't break a streak. */
  skipped?: string[];
}

/** One record per day (Today section): focus, the AI brief, the evening reflection. Synced. */
export interface DayRecord {
  id: string; // YYYY-MM-DD
  focus?: string;
  reflection?: string;
  brief?: DailyBrief;
  /** On a week's Monday record: that week's review (Review section). */
  review?: WeeklyReview;
  /** On a week's Monday record: the user's own notes on that week. */
  reviewNote?: string;
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
  /** One line per upcoming meeting that has history (older briefs don't have it). */
  prep?: { event: string; note: string }[];
  model: string;
  generatedAt: string;
  /** "ai" from ProdLi's server, "basic" built on the device without AI. */
  source?: "ai" | "basic";
}

export interface WeeklyReview {
  headline: string;
  summary: string;
  wins: string[];
  slipped: { title: string; suggestion: string }[];
  patterns: string[];
  nextWeek: { title: string; reason: string }[];
  habitTip: string;
  question: string;
  model: string;
  generatedAt: string;
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
  /** Prep reminders 10 minutes before meetings with prep (Pro). Missing = on. */
  prepReminders?: boolean;
  /** Notify at a task's time (to-dos with a time). Default on. */
  taskReminders?: boolean;
  /** Keep reminding every 10 minutes (up to 2 hours) until the task is ticked off. Default off. */
  nagReminders?: boolean;
}

export type Section = "today" | "review" | "editor" | "todos" | "pomodoro" | "habits" | "tracker" | "meetings" | "files";

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
