// Note templates and the daily note — the pure part, shared by the extension
// and the phone app (artifacts/prodli-mobile). Your own templates are notes
// marked `template: true` (so they sync and back up like notes) and stay out
// of the note list and search. Templates can use {{date}}, {{weekday}} and {{time}}.

import { generateId, getDayKey } from "./utils";
import type { DayRecord, Note, Todo } from "../types";

export interface BuiltinTemplate {
  id: string;
  name: string;
  emoji: string;
  html: string;
}

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tasks = (items: string[]) => `<ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join("")}</ul>`;

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: "meeting", name: "Meeting notes", emoji: "🎙️", html: `<h1>Meeting: </h1><p><em>{{weekday}} {{date}} · {{time}}</em></p><h2>Attendees</h2><ul><li><p></p></li></ul><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><p></p><h2>Decisions</h2><ul><li><p></p></li></ul><h2>Action items</h2>${tasks([""])}` },
  { id: "daily", name: "Daily note", emoji: "📅", html: `<h1>{{weekday}} {{date}}</h1><h2>Main focus</h2><p></p><h2>Today</h2>${tasks([""])}<h2>Notes</h2><p></p><h2>Wins</h2><ul><li><p></p></li></ul>` },
  { id: "weekly", name: "Weekly plan", emoji: "🗓️", html: `<h1>Week of {{date}}</h1><h2>Top 3 outcomes</h2><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol><h2>Monday</h2>${tasks([""])}<h2>Tuesday</h2>${tasks([""])}<h2>Wednesday</h2>${tasks([""])}<h2>Thursday</h2>${tasks([""])}<h2>Friday</h2>${tasks([""])}<h2>Not this week</h2><ul><li><p></p></li></ul>` },
  { id: "project", name: "Project brief", emoji: "🚀", html: `<h1>Project: </h1><p><em>Started {{date}}</em></p><h2>Goal</h2><p></p><h2>Why it matters</h2><p></p><h2>Scope</h2><ul><li><p>In: </p></li><li><p>Out: </p></li></ul><h2>Milestones</h2>${tasks([""])}<h2>Risks</h2><ul><li><p></p></li></ul><h2>Links</h2><p></p>` },
  { id: "oneonone", name: "1:1", emoji: "🤝", html: `<h1>1:1 · {{date}}</h1><h2>How are things?</h2><p></p><h2>Wins since last time</h2><ul><li><p></p></li></ul><h2>Blockers</h2><ul><li><p></p></li></ul><h2>Feedback</h2><p></p><h2>Next steps</h2>${tasks([""])}` },
  { id: "decision", name: "Decision record", emoji: "⚖️", html: `<h1>Decision: </h1><p><em>{{date}}</em></p><h2>Context</h2><p></p><h2>Options</h2><ol><li><p></p></li><li><p></p></li></ol><h2>Decision</h2><p></p><h2>Consequences</h2><ul><li><p></p></li></ul>` },
];

/** Replaces {{date}}, {{weekday}}, {{time}} (in the user's locale). */
export function fillTemplate(html: string, now = new Date()): string {
  const date = now.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return html.replace(/\{\{\s*date\s*\}\}/gi, h(date)).replace(/\{\{\s*weekday\s*\}\}/gi, h(weekday)).replace(/\{\{\s*time\s*\}\}/gi, h(time));
}

/** The first <h1> text, or the template name (for the new note's title). */
export function titleFrom(html: string, fallback: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = (m?.[1] ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
  return t.replace(/[:·]\s*$/, "").trim() || fallback;
}

export function newNoteFromTemplate(html: string, name: string, now = new Date()): Note {
  const content = fillTemplate(html, now);
  const stamp = now.toISOString();
  return { id: generateId(), title: titleFrom(content, name), content, createdAt: stamp, updatedAt: stamp, autoTitle: true };
}

export const isTemplate = (n: Note) => !!n.template;

/**
 * Today's daily note: your own "Daily note" template if you made one, else the
 * built-in one, filled with today's main focus and planned tasks.
 */
export function dailyNoteHtml(opts: { now?: Date; focus?: string; tasks: string[]; template?: string }): string {
  const now = opts.now ?? new Date();
  let html = fillTemplate(opts.template ?? BUILTIN_TEMPLATES.find((t) => t.id === "daily")!.html, now);
  if (opts.focus) html = html.replace(/(<h2>Main focus<\/h2>)<p><\/p>/i, `$1<p>${h(opts.focus)}</p>`);
  if (opts.tasks.length) {
    const list = tasks(opts.tasks.map(h));
    html = /<h2>Today<\/h2><ul data-type="taskList">[\s\S]*?<\/ul>/i.test(html) ? html.replace(/(<h2>Today<\/h2>)<ul data-type="taskList">[\s\S]*?<\/ul>/i, `$1${list}`) : `${html}<h2>Today</h2>${list}`;
  }
  return html;
}

export function dailyTitle(now = new Date()): string {
  return `Daily note · ${now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`;
}

/** Pure: today's daily note — the existing one's id, or a new note to add (focus and planned tasks filled in). */
export function buildDailyNote(notes: Note[], todos: Todo[], days: DayRecord[], now = new Date()): { id: string; note?: Note } {
  const today = getDayKey(now);
  const existing = notes.find((n) => n.dailyFor === today && !n.template);
  if (existing) return { id: existing.id };
  const planned = todos.filter((t) => !t.completed && ((t.plannedFor && t.plannedFor <= today) || (t.dueDate && t.dueDate <= today))).map((t) => t.title).slice(0, 20);
  const custom = notes.find((n) => n.template && n.title.trim().toLowerCase() === "daily note");
  const stamp = now.toISOString();
  const note: Note = {
    id: generateId(),
    title: dailyTitle(now),
    content: dailyNoteHtml({ now, focus: days.find((d) => d.id === today)?.focus, tasks: planned, template: custom?.content }),
    createdAt: stamp,
    updatedAt: stamp,
    autoTitle: false,
    dailyFor: today,
  };
  return { id: note.id, note };
}
