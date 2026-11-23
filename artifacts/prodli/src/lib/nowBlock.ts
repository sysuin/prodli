// Today's "Now" card (gentle day mode): the time block that's on now, how long
// is left, and what's next. Pure helpers; the card is sections/today/NowCard.tsx.
// "✨ Break it down" asks ProdLi's AI for a few small steps (a writing-help use).

import type { Todo } from "../types";
import { blockOf, type Slot } from "./timeBlocks";
import { accountRequest } from "./prodliAccount";

export interface BlockAt {
  todo: Todo;
  slot: Slot;
}

/** The open task whose block covers `nowMin` today (the latest-starting one if blocks overlap). */
export function currentBlock(todos: Todo[], day: string, nowMin: number): BlockAt | null {
  let best: BlockAt | null = null;
  for (const t of todos) {
    const slot = blockOf(t, day);
    if (slot && slot.start <= nowMin && nowMin < slot.end && (!best || slot.start > best.slot.start)) best = { todo: t, slot };
  }
  return best;
}

/** The next block starting after `nowMin` today. */
export function nextBlock(todos: Todo[], day: string, nowMin: number): BlockAt | null {
  let best: BlockAt | null = null;
  for (const t of todos) {
    const slot = blockOf(t, day);
    if (slot && slot.start > nowMin && (!best || slot.start < best.slot.start)) best = { todo: t, slot };
  }
  return best;
}

/** "12:05" (minutes:seconds) or "1:02:05" left. */
export function countdown(msLeft: number): string {
  const s = Math.max(0, Math.round(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Steps from ProdLi's AI for a task (needs an account; counts as a writing-help use). */
export async function breakDown(task: string, context = ""): Promise<string[]> {
  const r = await accountRequest<{ steps: string[] }>("/api/ai/breakdown", { method: "POST", body: JSON.stringify({ task: task.slice(0, 300), context: context.slice(0, 1500) }) }, { write_quota_exceeded: "You've used this month's writing help. It resets on the 1st (or go Pro)." });
  return r.steps;
}
