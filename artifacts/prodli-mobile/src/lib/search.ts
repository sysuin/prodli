// Search on the phone: notes, to-dos, meetings and Read later, newest first.
import type { Note, ReadLaterItem, Todo } from "../shared";
import { htmlToText } from "./html";
import { transcriptToText, type Meeting } from "./meetings";

export interface SearchHit {
  kind: "note" | "todo" | "meeting" | "readLater";
  id: string;
  title: string;
  snippet: string;
  at: string;
}

/** A few words around the first match. */
export function snippetAround(text: string, q: string, width = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, width);
  const from = Math.max(0, i - Math.floor((width - q.length) / 2));
  return `${from > 0 ? "…" : ""}${flat.slice(from, from + width)}${from + width < flat.length ? "…" : ""}`;
}

/** Pure: everything that contains all the words of `query` (case-insensitive). */
export function search(query: string, data: { notes: Note[]; todos: Todo[]; meetings: Meeting[]; readLater: ReadLaterItem[] }, max = 60): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (text: string) => {
    const l = text.toLowerCase();
    return words.every((w) => l.includes(w));
  };
  const hits: SearchHit[] = [];
  for (const n of data.notes) {
    if (n.template) continue;
    const text = htmlToText(n.content);
    if (has(`${n.title}\n${text}`)) hits.push({ kind: "note", id: n.id, title: n.title || "Untitled", snippet: snippetAround(text, words[0]), at: n.updatedAt });
  }
  for (const t of data.todos) {
    const text = [t.title, ...(t.subtasks ?? []).map((s) => s.title), ...(t.labels ?? []).map((l) => `@${l}`)].join("\n");
    if (has(text)) hits.push({ kind: "todo", id: t.id, title: t.title, snippet: t.completed ? "Done" : t.dueDate ? `Due ${t.dueDate}` : "To-do", at: t.updatedAt ?? t.createdAt });
  }
  for (const m of data.meetings) {
    const s = m.summary;
    const text = [m.title, s?.title, s?.overview, ...(s?.keyPoints ?? []), ...(s?.decisions ?? []), ...(s?.actionItems ?? []).map((a) => a.task), transcriptToText(m.transcript ?? [])].filter(Boolean).join("\n");
    if (has(text)) hits.push({ kind: "meeting", id: m.id, title: s?.title || m.title || "Meeting", snippet: snippetAround(text, words[0]), at: m.startedAt });
  }
  for (const r of data.readLater) {
    if (has(`${r.title}\n${r.url}`)) hits.push({ kind: "readLater", id: r.id, title: r.title, snippet: r.url, at: r.createdAt });
  }
  return hits.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, max);
}
