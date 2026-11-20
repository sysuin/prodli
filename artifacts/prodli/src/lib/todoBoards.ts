// To-dos → Board and Matrix views: the same tasks arranged in columns or in an
// Eisenhower matrix. Pure rules (unit-tested); moving a card returns the patch
// to apply. Nothing new is stored: columns come from dates, "planned for today",
// priority and done.

import { getDayKey } from "./utils";
import type { Todo } from "../types";

export type BoardColumn = "nodate" | "upcoming" | "today" | "done";
export type Quadrant = "do" | "schedule" | "quick" | "later";

export const BOARD_COLUMNS: { id: BoardColumn; label: string; hint: string }[] = [
  { id: "nodate", label: "No date", hint: "Not planned yet" },
  { id: "upcoming", label: "Upcoming", hint: "Has a date after today" },
  { id: "today", label: "Today", hint: "Planned, due or overdue" },
  { id: "done", label: "Done", hint: "Finished" },
];

export const QUADRANTS: { id: Quadrant; label: string; hint: string }[] = [
  { id: "do", label: "Do first", hint: "Important and urgent" },
  { id: "schedule", label: "Schedule", hint: "Important, not urgent" },
  { id: "quick", label: "Quick wins", hint: "Urgent, less important" },
  { id: "later", label: "Later", hint: "Neither: batch, drop or delegate" },
];

const addDays = (day: string, n: number) => getDayKey(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86_400_000));

/** Where a task sits on the board. */
export function boardColumn(t: Todo, today: string): BoardColumn {
  if (t.completed) return "done";
  if ((t.plannedFor && t.plannedFor <= today) || (t.dueDate && t.dueDate <= today)) return "today";
  if (t.dueDate) return "upcoming";
  return "nodate";
}

/** Important = high priority. */
export const isImportant = (t: Todo) => t.priority === "high";
/** Urgent = overdue, due today or tomorrow, or planned for today. */
export const isUrgent = (t: Todo, today: string) => (!!t.plannedFor && t.plannedFor <= today) || (!!t.dueDate && t.dueDate <= addDays(today, 1));

export function quadrant(t: Todo, today: string): Quadrant {
  const i = isImportant(t);
  const u = isUrgent(t, today);
  return i && u ? "do" : i ? "schedule" : u ? "quick" : "later";
}

/**
 * The change that moves an open task to a column ("done" is handled by the
 * caller's normal complete, so repeating tasks repeat). Returns null if it's
 * already there.
 */
export function moveToColumn(t: Todo, to: BoardColumn, today: string): Partial<Todo> | null {
  if (to === "done" || boardColumn(t, today) === to) return null;
  if (to === "today") return { plannedFor: today };
  if (to === "upcoming") return { plannedFor: undefined, dueDate: t.dueDate && t.dueDate > today ? t.dueDate : addDays(today, 1), block: undefined };
  return { plannedFor: undefined, dueDate: undefined, dueTime: undefined, block: undefined };
}

/** The change that moves a task to a quadrant (priority and/or timing), or null if it's already there. */
export function moveToQuadrant(t: Todo, to: Quadrant, today: string): Partial<Todo> | null {
  if (quadrant(t, today) === to) return null;
  const patch: Partial<Todo> = {};
  const wantImportant = to === "do" || to === "schedule";
  const wantUrgent = to === "do" || to === "quick";
  if (wantImportant !== isImportant(t)) patch.priority = wantImportant ? "high" : "medium";
  if (wantUrgent !== isUrgent(t, today)) {
    if (wantUrgent) patch.plannedFor = today;
    else {
      patch.plannedFor = undefined;
      patch.block = undefined;
      // Not urgent: give it some room (a week out) if it was due today or tomorrow.
      if (t.dueDate && t.dueDate <= addDays(today, 1)) patch.dueDate = addDays(today, 7);
    }
  }
  return patch;
}

/** Plain words for what a move changed (announced to screen readers and shown briefly). */
export function describeMove(t: Todo, patch: Partial<Todo>, today: string): string {
  const bits: string[] = [];
  if ("priority" in patch) bits.push(patch.priority === "high" ? "high priority" : "priority lowered");
  if ("plannedFor" in patch) bits.push(patch.plannedFor ? "planned for today" : "no longer planned for today");
  if ("dueDate" in patch) bits.push(patch.dueDate ? `due ${patch.dueDate === addDays(today, 1) ? "tomorrow" : patch.dueDate}` : "no date");
  return `${t.title}: ${bits.join(", ") || "moved"}.`;
}
