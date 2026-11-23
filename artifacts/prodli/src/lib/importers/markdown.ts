// Markdown or plain-text checklists (Obsidian, Notion pages, Apple Notes or
// Things copied as text, a README of to-dos):
//   # Heading            → a list for the tasks under it
//   - [ ] task / - [x]   → open / done task (also *, +, 1., ☐, ☑)
//   * item, plain lines  → a task
//   indented items       → subtasks of the task above
// Each task goes through the quick-add parser, so "Call Sam tomorrow !high
// #Work @phone" keeps its date, priority, list and label.

import { parseTask } from "../taskParse";
import type { ImportTask, ParsedImport } from "./core";

const ITEM = /^(\s*)(?:[-*+•]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/;
const BOX = /^(\s*)([☐□☑✓✔])\s*(.*)$/;
const SKIP = /^\s*(?:-{3,}|\*{3,}|_{3,}|```.*|~~~.*|<!--.*-->|\|.*\|)\s*$/;

const indentOf = (ws: string) => ws.replace(/\t/g, "    ").length;

export function parseMarkdownTasks(text: string, now = new Date()): ParsedImport {
  const tasks: ImportTask[] = [];
  let list: string | undefined;
  let top: ImportTask | null = null;
  let topIndent = 0;
  let inFence = false;
  let frontMatter = false;
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (i === 0 && raw.trim() === "---") {
      frontMatter = true;
      return;
    }
    if (frontMatter) {
      if (raw.trim() === "---") frontMatter = false;
      return;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence || !raw.trim() || SKIP.test(raw)) return;
    const h = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) {
      list = h[1].replace(/[*_`]/g, "").trim() || undefined;
      top = null;
      return;
    }
    let indent = 0;
    let done = false;
    let body = raw.trim().replace(/^>\s*/, "");
    const m = ITEM.exec(raw) ?? null;
    const b = m ? null : BOX.exec(raw);
    if (m) {
      indent = indentOf(m[1]);
      done = m[2] === "x" || m[2] === "X";
      body = m[3].trim();
    } else if (b) {
      indent = indentOf(b[1]);
      done = b[2] !== "☐" && b[2] !== "□";
      body = b[3].trim();
    }
    body = body.replace(/~~(.+)~~/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    if (!body) return;
    if (top && (m || b) && indent > topIndent) {
      (top.subtasks ??= []).push({ title: body, completed: done });
      return;
    }
    const p = parseTask(body, now);
    const t: ImportTask = { title: p.title, completed: done };
    const listName = p.listName ?? list;
    if (listName) t.list = listName;
    if (p.priority) t.priority = p.priority;
    if (p.dueDate) t.dueDate = p.dueDate;
    if (p.dueTime) t.dueTime = p.dueTime;
    if (p.repeat) t.repeat = p.repeat;
    if (p.labels?.length) t.labels = p.labels;
    tasks.push(t);
    top = t;
    topIndent = indent;
  });
  if (!tasks.length) throw new Error("No tasks found in this file.");
  return { app: "markdown", tasks, dropped: [], info: ["Headings become lists. Words like “tomorrow”, “!high” or “#Work” set the date, priority and list."] };
}
