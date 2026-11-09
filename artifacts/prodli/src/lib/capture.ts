// "Add to ProdLi" from anywhere: right-click a page, link or selection (extension),
// the Quick add shortcut (Alt+Shift+A), the share sheet on phones (web app's
// share target) and the command palette. Items are added to storage the same
// way the app adds them, so open tabs and sync pick them up.

import { storageGet, storageSet } from "./storage";
import { generateId } from "./utils";
import type { Note, Todo } from "../types";
import { dayKey } from "./today";

export interface CaptureInput {
  title: string;
  /** Selected text or extra details. */
  text?: string;
  url?: string;
}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Only http(s) links are kept (never javascript: or data:). */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function addTask(input: CaptureInput & { planToday?: boolean }): Promise<Todo> {
  const now = new Date().toISOString();
  const title = clean(input.title, 300) || clean(input.text, 300) || "New task";
  const url = safeUrl(input.url);
  const extra = clean(input.text, 500);
  const todo: Todo = {
    id: generateId(),
    title,
    completed: false,
    subtasks: [
      ...(extra && extra !== title ? [{ id: generateId(), title: extra, completed: false }] : []),
      ...(url ? [{ id: generateId(), title: url, completed: false }] : []),
    ],
    plannedFor: input.planToday ? dayKey() : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const todos = await storageGet<Todo[]>("todos", []);
  await storageSet("todos", [todo, ...todos]);
  return todo;
}

export function noteHtml(input: CaptureInput): string {
  const url = safeUrl(input.url);
  const parts: string[] = [];
  const text = (input.text ?? "").trim();
  if (text) for (const para of text.split(/\n{2,}/)) parts.push(`<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`);
  if (url) parts.push(`<p>Source: <a href="${escapeHtml(url)}">${escapeHtml(clean(input.title, 200) || url)}</a></p>`);
  return parts.join("") || "<p></p>";
}

export async function addNote(input: CaptureInput): Promise<Note> {
  const now = new Date().toISOString();
  const note: Note = {
    id: generateId(),
    title: clean(input.title, 120) || clean(input.text, 60) || "Saved from the web",
    content: noteHtml(input),
    createdAt: now,
    updatedAt: now,
    autoTitle: false,
  };
  const notes = await storageGet<Note[]>("notes", []);
  await storageSet("notes", [note, ...notes]);
  return note;
}

/** Quick add opened with values in the URL (extension window hash, or the web share target). */
export function captureFromUrl(search: string): CaptureInput | null {
  const p = new URLSearchParams(search);
  const title = p.get("title") ?? "";
  const text = p.get("text") ?? "";
  // Android often puts the shared link in "text".
  let url = p.get("url") ?? "";
  const linkInText = !url && /^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : "";
  if (linkInText) url = linkInText;
  if (!title && !text && !url) return null;
  return { title: title.slice(0, 300), text: linkInText ? "" : text.slice(0, 5000), url: safeUrl(url) };
}
