export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  completedDays: string[];
  createdAt: string;
  archived: boolean;
}

export type Section = "editor" | "todos" | "pomodoro" | "habits" | "tracker";

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
