// A meeting's "Earlier in this series" (Pro): past occurrences of a recurring
// meeting (same Meet link or title) with their decisions and still-open items,
// so you can see what changed since last time. Matching: lib/meetingPrep.ts.

import { meetingSeries } from "../../lib/meetingPrep";
import type { Meeting } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const fmt = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

export function Series({ meeting, meetings, onOpen }: { meeting: Meeting; meetings: Meeting[]; onOpen: (id: string) => void }) {
  const access = useProAccess();
  const earlier = meetingSeries(meeting, meetings);
  if (!earlier.length) return null;
  const locked = !!access && !access.allowed;
  return (
    <div data-testid="meeting-series" style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <div style={{ fontWeight: 800 }}>
        Earlier in this series ({earlier.length})
        <ProBadge />
      </div>
      {locked ? (
        <ProNote access={access} what="Meeting series" />
      ) : (
        <>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {earlier.map((o) => {
              const done = new Set((o.doneActions ?? []).map((x) => x.toLowerCase()));
              const open = (o.summary?.actionItems ?? []).filter((a) => !done.has(a.task.toLowerCase()));
              return (
                <li key={o.id} data-testid="series-item" style={{ borderLeft: "3px solid var(--nb-section-border)", paddingLeft: 8 }}>
                  <button onClick={() => onOpen(o.id)} style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", fontWeight: 800, fontSize: 13, textDecoration: "underline", cursor: "pointer", color: "inherit", textAlign: "left" }}>
                    {fmt(o.startedAt)} · {o.summary?.title || o.title}
                  </button>
                  {o.summary?.decisions.length ? <div style={{ fontSize: 12, marginTop: 2 }}>Decided: {o.summary.decisions.slice(0, 3).join(" · ")}</div> : null}
                  {open.length ? <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>Still open: {open.slice(0, 3).map((a) => a.task).join(" · ")}{open.length > 3 ? ` (+${open.length - 3})` : ""}</div> : null}
                  {!o.summary && <div style={{ fontSize: 12, opacity: 0.7 }}>Not summarized.</div>}
                </li>
              );
            })}
          </ol>
          {access?.earlyAccess && <ProNote access={access} what="Meeting series" />}
        </>
      )}
    </div>
  );
}
