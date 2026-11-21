// Meetings → "🧭 Decisions" (Pro): a searchable log of every decision from
// every meeting, newest first. Copy it as Markdown, or open the meeting a
// decision came from. Rules: lib/decisions.ts.

import { useState, type CSSProperties } from "react";
import { decisionLog, decisionsToMarkdown } from "../../lib/decisions";
import type { Meeting } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "4px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.04em" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function Decisions({ meetings, onOpenMeeting, flash }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void; flash: (msg: string) => void }) {
  const access = useProAccess();
  const [query, setQuery] = useState("");
  const locked = !!access && !access.allowed;
  const groups = decisionLog(meetings, query);
  const total = groups.reduce((n, g) => n + g.decisions.length, 0);
  const any = decisionLog(meetings).length > 0;

  return (
    <div data-testid="decision-log" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>
          Decisions from your meetings
          <ProBadge />
        </div>
        {!locked && any && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search decisions…"
              aria-label="Search decisions"
              style={{ border: "var(--nb-border)", padding: "5px 8px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))", minWidth: 0, width: 200 }}
            />
            <button
              style={small}
              disabled={!groups.length}
              onClick={() => void navigator.clipboard.writeText(decisionsToMarkdown(groups)).then(() => flash(`Copied ${total} decision${total === 1 ? "" : "s"}`), () => flash("Couldn't copy"))}
              title="Copy these decisions as Markdown"
            >
              📋 Copy
            </button>
          </div>
        )}
      </div>
      <ProNote access={access} what="Decision logs" />
      {locked ? null : !any ? (
        <div style={{ border: "var(--nb-border)", padding: 20, textAlign: "center", fontSize: 14, fontWeight: 700 }}>No decisions yet. Decisions from meeting summaries are collected here.</div>
      ) : groups.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.8 }}>No decisions match “{query}”.</div>
      ) : (
        <>
          <div aria-live="polite" style={{ fontSize: 12, opacity: 0.8 }}>
            {total} decision{total === 1 ? "" : "s"} from {groups.length} meeting{groups.length === 1 ? "" : "s"}
          </div>
          {groups.map((g) => (
            <section key={g.meetingId} data-testid="decision-group" aria-label={`${g.title}, ${fmt(g.startedAt)}`} style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
                <button onClick={() => onOpenMeeting(g.meetingId)} title="Open this meeting" style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", fontSize: 14, fontWeight: 800, color: "inherit", cursor: "pointer", textDecoration: "underline", textAlign: "left" }}>
                  {g.title}
                </button>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{fmt(g.startedAt)}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: 14, listStyle: "disc" }}>
                {g.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
