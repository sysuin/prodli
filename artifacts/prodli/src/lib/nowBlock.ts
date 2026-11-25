// Today's "Now" card (gentle day mode): the time block that's on now, how long
// is left, and what's next. Pure helpers (also used by the desktop menu bar,
// lib/menuBar.ts); the card is sections/today/NowCard.tsx. "✨ Break it down"
// is in lib/breakDown.ts.

import type { Todo } from "../types";
import { blockOf, type Slot } from "./timeBlocks";

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
