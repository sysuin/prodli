// "Download everything as Markdown" (Settings → Backup & data): notes, meeting
// notes (with transcripts) and to-dos as plain .md files in one .zip, readable
// in any editor and importable into Notion, Obsidian or Google Docs. Part of
// ProdLi's promise that your data is yours (see Privacy): export works offline,
// without an account, and keeps working whatever happens to ProdLi.

import type { Note, Todo } from "../types";
import type { Meeting } from "../recorder/types";
import { noteToMarkdown, safeFileName } from "./markdownExport";
import { meetingToMarkdown } from "./meetingExport";
import { zipFiles } from "./zip";

const stamp = (iso: string) => (iso || "").slice(0, 10);

/** Unique file names inside one folder. */
function namer() {
  const used = new Set<string>();
  return (base: string) => {
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = base.replace(/(\.\w+)$/, ` (${i})$1`);
    used.add(name.toLowerCase());
    return name;
  };
}

function transcriptMarkdown(m: Meeting): string {
  if (!m.transcript?.length) return "";
  const t = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  return `\n\n## Transcript\n\n${m.transcript.map((e) => `**${e.speaker}** (${t(e.startMs)}): ${e.text}`).join("\n\n")}\n`;
}

export function todosMarkdown(todos: Todo[]): string {
  const line = (t: Todo) => `- [${t.completed ? "x" : " "}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}${t.priority === "high" ? " !high" : ""}${t.labels?.length ? ` ${t.labels.map((l) => `@${l}`).join(" ")}` : ""}${t.subtasks?.length ? `\n${t.subtasks.map((s) => `  - [${s.completed ? "x" : " "}] ${s.title}`).join("\n")}` : ""}`;
  const open = todos.filter((t) => !t.completed);
  const done = todos.filter((t) => t.completed);
  return `# To-dos\n\n${open.map(line).join("\n") || "_Nothing open._"}\n\n## Done\n\n${done.map(line).join("\n") || "_None yet._"}\n`;
}

export function buildExportFiles(data: { notes: Note[]; meetings: Meeting[]; todos: Todo[] }): { name: string; text: string }[] {
  const files: { name: string; text: string }[] = [];
  const noteName = namer();
  for (const n of data.notes) files.push({ name: `notes/${noteName(safeFileName(`${stamp(n.createdAt)} ${n.title || "Untitled"}`, "md"))}`, text: noteToMarkdown(n.title || "Untitled", n.content) });
  const meetingName = namer();
  for (const m of data.meetings) {
    if (m.status === "recording") continue;
    const body = m.summary ? meetingToMarkdown(m) : `# ${m.title || "Meeting"}\n\n${new Date(m.startedAt).toLocaleString()}\n`;
    files.push({ name: `meetings/${meetingName(safeFileName(`${stamp(m.startedAt)} ${m.summary?.title || m.title || "Meeting"}`, "md"))}`, text: body + transcriptMarkdown(m) });
  }
  files.push({ name: "to-dos.md", text: todosMarkdown(data.todos) });
  files.push({ name: "README.md", text: `# Your ProdLi export\n\nExported ${new Date().toLocaleString()}.\n\n- notes/ — your notes (${data.notes.length})\n- meetings/ — meeting notes and transcripts (${data.meetings.length}); recordings are not included\n- to-dos.md — open and done to-dos\n\nFor a full backup you can restore into ProdLi (habits, time tracking and settings too), use Settings → Backup & data → Export Data.\n` });
  return files;
}

export async function downloadEverythingAsMarkdown(): Promise<number> {
  const { storageGet } = await import("./storage");
  const [notes, todos] = await Promise.all([storageGet<Note[]>("notes", []), storageGet<Todo[]>("todos", [])]);
  let meetings: Meeting[] = [];
  try {
    meetings = await (await import("../recorder/db")).listMeetings();
  } catch {
    // No meetings storage here.
  }
  const files = buildExportFiles({ notes, meetings, todos });
  const url = URL.createObjectURL(zipFiles(files));
  const a = document.createElement("a");
  a.href = url;
  a.download = `prodli-export-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return files.length;
}
