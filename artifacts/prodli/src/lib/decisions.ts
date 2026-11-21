// Meetings → "🧭 Decisions" (Pro): every decision from every meeting summary,
// newest meeting first, searchable — a decision log to check "what did we
// agree?" without opening meetings one by one.

import type { Meeting } from "../recorder/types";

export interface DecisionGroup {
  meetingId: string;
  title: string;
  startedAt: string;
  decisions: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Meetings with decisions, newest first; with a query, only decisions (or meetings by title) that match. */
export function decisionLog(meetings: Meeting[], query = ""): DecisionGroup[] {
  const q = norm(query.trim());
  return meetings
    .filter((m) => m.summary?.decisions.length)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((m) => {
      const title = m.summary?.title || m.title;
      const all = m.summary!.decisions;
      const decisions = !q || norm(title).includes(q) ? all : all.filter((d) => norm(d).includes(q));
      return { meetingId: m.id, title, startedAt: m.startedAt, decisions };
    })
    .filter((g) => g.decisions.length);
}

export function decisionsToMarkdown(groups: DecisionGroup[]): string {
  const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  return `# Decisions\n\n${groups.map((g) => `## ${g.title} (${date(g.startedAt)})\n${g.decisions.map((d) => `- ${d}`).join("\n")}`).join("\n\n")}\n`;
}
