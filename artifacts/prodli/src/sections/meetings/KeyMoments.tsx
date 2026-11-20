// A meeting's "★ Key moments": the moments marked while recording (★ on the
// recording bar, the in-call badge, or Alt+Shift+M), each with what was being
// said. With Pro, summaries make sure to cover them (lib/moments.ts).

import { clock, momentExcerpts, removeMark } from "../../lib/moments";
import { updateMeeting } from "../../recorder/db";
import type { Meeting } from "../../recorder/types";
import { ProBadge, useProAccess } from "../../components/Pro";

export function KeyMoments({ meeting }: { meeting: Meeting }) {
  const access = useProAccess();
  const moments = momentExcerpts(meeting.transcript, meeting.marks);
  if (!moments.length) return null;
  // The list refreshes itself (db broadcasts the change).
  const remove = (atMs: number) => void updateMeeting(meeting.id, (m) => ({ marks: removeMark(m.marks, atMs) }));
  return (
    <div data-testid="key-moments" style={{ display: "grid", gap: 8, fontSize: 14 }}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
        {moments.map((m) => (
          <li key={m.atMs} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "var(--nb-border)", background: "hsl(var(--card))", padding: "6px 8px" }}>
            <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>★ {clock(m.atMs)}</span>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5, opacity: m.text ? 1 : 0.7 }}>{m.text || (meeting.status === "recording" ? "Transcript still coming…" : "Nothing in the transcript at this point.")}</span>
            <button
              onClick={() => remove(m.atMs)}
              aria-label={`Remove the moment at ${clock(m.atMs)}`}
              title="Remove this moment"
              style={{ border: "none", background: "none", color: "hsl(var(--foreground))", cursor: "pointer", fontWeight: 800, fontSize: 14, padding: "0 2px", opacity: 0.6 }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {!access ? null : access.allowed ? (
          <>Summaries make sure to cover these moments{access.earlyAccess ? " (a Pro feature, free while Pro is launching)" : ""}. Summarize again to include new ones.</>
        ) : (
          <>
            With ProdLi Pro, summaries make sure to cover the moments you mark. <ProBadge />
          </>
        )}
      </div>
    </div>
  );
}
