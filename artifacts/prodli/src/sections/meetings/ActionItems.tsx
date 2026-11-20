// Meetings → "✅ Action items" (Pro): every open action item from every meeting,
// grouped by owner (you first), overdue first. Mark one done, add it to your
// to-dos, or open the meeting it came from. Rules: lib/actionItems.ts.

import { useState, type CSSProperties } from "react";
import { groupByOwner, openActions } from "../../lib/actionItems";
import { addTask } from "../../lib/capture";
import { useSyncedList } from "../../lib/syncedList";
import { getDayKey } from "../../lib/utils";
import { updateMeeting } from "../../recorder/db";
import type { Meeting } from "../../recorder/types";
import type { Todo } from "../../types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "2px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export function ActionItems({ meetings, onOpenMeeting, flash }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void; flash: (msg: string) => void }) {
  const access = useProAccess();
  const { items: todos } = useSyncedList<Todo>("todos");
  const [onlyMine, setOnlyMine] = useState(false);
  const today = getDayKey();
  const all = openActions(meetings, todos, today);
  const groups = groupByOwner(all).filter((g) => !onlyMine || g.you);
  const locked = !!access && !access.allowed;

  return (
    <div data-testid="action-items" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>
          Action items from your meetings
          <ProBadge />
        </div>
        {!locked && all.length > 0 && (
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, fontWeight: 700, marginLeft: "auto" }}>
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only mine
          </label>
        )}
      </div>
      <ProNote access={access} what="Action items across meetings" />
      {locked ? null : all.length === 0 ? (
        <div style={{ border: "var(--nb-border)", padding: 20, textAlign: "center", fontSize: 14, fontWeight: 700 }}>Nothing open. Action items from meeting summaries show up here until they're done.</div>
      ) : (
        groups.map((g) => (
          <section key={g.owner} aria-label={`${g.owner}, ${g.items.length} open`} data-testid="action-owner">
            <h3 style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px" }}>
              {g.owner} <span style={{ fontWeight: 700, opacity: 0.7 }}>{g.items.length}</span>
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {g.items.map((i) => (
                <li key={i.key} data-testid="action-item" style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "8px 10px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="checkbox"
                    aria-label={`Done: ${i.task}`}
                    onChange={() => {
                      void updateMeeting(i.meetingId, (m) => ({ doneActions: [...new Set([...(m.doneActions ?? []), i.task])] }));
                      flash(`Done: ${i.task}`);
                    }}
                  />
                  <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{i.task}</span>
                    <span style={{ display: "block", fontSize: 11, opacity: 0.8 }}>
                      {i.due && <span style={{ color: i.overdue ? "var(--danger-text)" : undefined, fontWeight: i.overdue ? 800 : 600 }}>{i.overdue ? "Overdue · " : "Due "}{i.due} · </span>}
                      <button onClick={() => onOpenMeeting(i.meetingId)} style={{ border: "none", background: "none", padding: 0, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: "inherit" }}>
                        {i.meetingTitle}, {fmt(i.meetingDate)}
                      </button>
                    </span>
                  </span>
                  {i.todoId ? (
                    <span style={{ fontSize: 11, fontWeight: 800 }}>In to-dos ✓</span>
                  ) : (
                    <button
                      style={small}
                      aria-label={`+ To-do: ${i.task}`}
                      onClick={() => {
                        void addTask({ title: i.task, smart: false }).then(() => flash("Added to your to-dos"));
                      }}
                    >
                      + To-do
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
