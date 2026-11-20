// Meetings → "Action items" (Pro): every open action item from every meeting's
// summary, grouped by owner. An item is done when it's marked done here
// (Meeting.doneActions, synced with the meeting) or a to-do with the same
// title is finished. Pure (unit-tested).

import type { Meeting } from "../recorder/types";
import type { Todo } from "../types";

export interface OpenAction {
  key: string;
  task: string;
  owner: string | null;
  due: string | null;
  overdue: boolean;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  /** Already on the to-do list (open). */
  todoId?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** "you", "me", "I" and the recorder's own label all mean the user. */
const isYou = (owner: string | null) => !!owner && /^(you|me|i|myself)$/i.test(owner.trim());

export function openActions(meetings: Meeting[], todos: Todo[], today: string): OpenAction[] {
  const byTitle = new Map<string, Todo>();
  for (const t of todos) {
    const k = norm(t.title);
    const prev = byTitle.get(k);
    if (!prev || (prev.completed && !t.completed)) byTitle.set(k, t);
  }
  const out: OpenAction[] = [];
  for (const m of meetings) {
    const done = new Set((m.doneActions ?? []).map(norm));
    for (const a of m.summary?.actionItems ?? []) {
      const k = norm(a.task);
      if (!k || done.has(k)) continue;
      const todo = byTitle.get(k);
      if (todo?.completed) continue;
      out.push({ key: `${m.id}:${k}`, task: a.task, owner: a.owner, due: a.dueDate, overdue: !!a.dueDate && a.dueDate < today, meetingId: m.id, meetingTitle: m.summary?.title || m.title, meetingDate: m.startedAt, todoId: todo?.id });
    }
  }
  return out;
}

export interface OwnerGroup {
  owner: string;
  you: boolean;
  items: OpenAction[];
}

/** Groups by owner: you first, then people by name, then unassigned; overdue and soonest first inside. */
export function groupByOwner(items: OpenAction[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  for (const i of items) {
    const you = isYou(i.owner);
    const name = you ? "You" : i.owner?.trim() || "Unassigned";
    const key = you ? "\u0000you" : name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { owner: name, you, items: [] });
    groups.get(key)!.items.push(i);
  }
  const rank = (g: OwnerGroup) => (g.you ? 0 : g.owner === "Unassigned" ? 2 : 1);
  for (const g of groups.values()) g.items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.meetingDate.localeCompare(a.meetingDate));
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.owner.localeCompare(b.owner));
}
