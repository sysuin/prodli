// "📋 Copy notes" / "⬇ .md" under a meeting's summary: the notes as Markdown,
// which pastes cleanly into Notion, Slack, Google Docs, email or a wiki.
// Summary only (plus marked moments); never the transcript or audio.

import type { Meeting } from "../recorder/types";
import { clock, momentExcerpts } from "./moments";

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

export function meetingToMarkdown(m: Meeting): string {
  const s = m.summary;
  const date = new Date(m.startedAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const mins = Math.max(1, Math.round((m.durationSec || 0) / 60));
  const parts = [`# ${s?.title || m.title}`, `_${date} · ${mins} min_`];
  if (s) {
    if (s.overview) parts.push(s.overview);
    for (const c of s.customSections ?? []) if (c.points.length) parts.push(`## ${c.heading}\n${list(c.points)}`);
    if (s.keyPoints.length) parts.push(`## Key points\n${list(s.keyPoints)}`);
    if (s.decisions.length) parts.push(`## Decisions\n${list(s.decisions)}`);
    if (s.actionItems.length) {
      const done = new Set((m.doneActions ?? []).map((t) => t.trim().toLowerCase()));
      parts.push(`## Action items\n${s.actionItems.map((a) => `- [${done.has(a.task.trim().toLowerCase()) ? "x" : " "}] ${a.task}${a.owner || a.dueDate ? ` (${[a.owner, a.dueDate && `due ${a.dueDate}`].filter(Boolean).join(", ")})` : ""}`).join("\n")}`);
    }
    if (s.openQuestions.length) parts.push(`## Open questions\n${list(s.openQuestions)}`);
  }
  const moments = momentExcerpts(m.transcript, m.marks).filter((x) => x.text);
  if (moments.length) parts.push(`## Key moments\n${list(moments.map((x) => `**${clock(x.atMs)}** ${x.text}`))}`);
  return `${parts.join("\n\n")}\n`;
}
