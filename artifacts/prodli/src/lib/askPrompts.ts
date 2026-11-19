// Saved Ask ProdLi prompts ("recipes") and scheduled prompts. A saved prompt
// can run on chosen days at a time; the extension's background asks it then,
// keeps the answer in a small inbox and shows a notification. Clicking it
// opens Ask ProdLi with the answer. Each run uses one Ask question.

import { storageGet, storageSet } from "./storage";
import { generateId } from "./utils";
import type { AskSource } from "./ask";

export interface SavedPrompt {
  id: string;
  text: string;
  /** Run on these weekdays (0 = Sunday) at "HH:MM". */
  schedule?: { time: string; days: number[] };
  createdAt: string;
}

export interface InboxAnswer {
  id: string;
  promptId: string;
  question: string;
  answer: string;
  sources: AskSource[];
  at: string;
}

export const PROMPTS_KEY = "askPrompts";
export const INBOX_KEY = "askInbox";
/** Set by a notification click: App opens Ask ProdLi with this answer. */
export const OPEN_INBOX_KEY = "openAskInbox";
export const MAX_PROMPTS = 20;

export const getPrompts = () => storageGet<SavedPrompt[]>(PROMPTS_KEY, []);
export const savePrompts = (p: SavedPrompt[]) => storageSet(PROMPTS_KEY, p.slice(0, MAX_PROMPTS));

export async function addPrompt(text: string, now = new Date()): Promise<SavedPrompt | null> {
  const t = text.trim().slice(0, 500);
  if (!t) return null;
  const list = await getPrompts();
  const existing = list.find((p) => p.text.toLowerCase() === t.toLowerCase());
  if (existing) return existing;
  const p: SavedPrompt = { id: generateId(), text: t, createdAt: now.toISOString() };
  await savePrompts([p, ...list]);
  return p;
}

/** The next time (ms) a schedule fires after `now`, or null if it has no days. */
export function nextRun(schedule: { time: string; days: number[] }, now = new Date()): number | null {
  if (!schedule.days.length || !/^\d{2}:\d{2}$/.test(schedule.time)) return null;
  const [h, m] = schedule.time.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
    if (schedule.days.includes(d.getDay()) && d.getTime() > now.getTime() + 30_000) return d.getTime();
  }
  return null;
}

export async function addToInbox(a: Omit<InboxAnswer, "id">): Promise<InboxAnswer> {
  const item: InboxAnswer = { id: generateId(), ...a };
  const list = await storageGet<InboxAnswer[]>(INBOX_KEY, []);
  await storageSet(INBOX_KEY, [item, ...list].slice(0, 20));
  return item;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function scheduleLabel(s: { time: string; days: number[] }): string {
  const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const d = days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5" ? "Weekdays" : days.map((x) => DAYS[x]).join(", ");
  return `${d} at ${s.time}`;
}
