// Today → "🗒 Meeting prep": for each upcoming meeting with history, last time's
// summary, open action items (add them as to-dos) and related to-dos. Logic:
// lib/meetingPrep.ts. Recorded meetings are read from this device only.

import { useEffect, useState, type CSSProperties } from "react";
import { metLabel, type MeetingPrep as Prep } from "../../lib/meetingPrep";
import { addTask } from "../../lib/capture";
import { openSource } from "../../lib/askOpen";
import type { Meeting } from "../../recorder/types";

const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "2px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const sub: CSSProperties = { fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 2px" };
const MATCH_LABEL = { link: "same Meet link", title: "same title", people: "same people" } as const;

/** Recorded meetings from this device, refreshed when one is added or changed. */
export function useMeetings(): Meeting[] {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    let alive = true;
    void import("../../recorder/db")
      .then((db) => {
        const load = () => void db.listMeetings().then((m) => alive && setMeetings(m), () => {});
        load();
        if (typeof BroadcastChannel !== "undefined") {
          ch = new BroadcastChannel(db.MEETINGS_CHANNEL);
          ch.onmessage = load;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      ch?.close();
    };
  }, []);
  return meetings;
}

/** The card's content (Today shows the card only when `prep` isn't empty). */
export function MeetingPrepList({ prep, onAsk }: { prep: Prep[]; onAsk?: (question?: string) => void }) {
  const [added, setAdded] = useState<Set<string>>(new Set());

  const add = async (p: Prep, task: string) => {
    await addTask({ title: task, smart: true });
    setAdded((s) => new Set(s).add(`${p.eventId}:${task}`));
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {prep.map((p) => (
        <article key={p.eventId} data-testid="meeting-prep-item" aria-label={`Prep for ${p.title}`} style={{ borderLeft: "4px solid #FF4FA3", paddingLeft: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 12, opacity: 0.8 }}>{p.start}</span>
            <strong style={{ fontSize: 14 }}>{p.title}</strong>
          </div>
          {p.last && (
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
              Last met {metLabel(p.last.date)}
              {p.pastCount > 1 ? ` · ${p.pastCount} earlier meetings` : ""} · matched by {MATCH_LABEL[p.matchedBy]}
            </div>
          )}
          {p.last?.overview && <p style={{ fontSize: 13, margin: "6px 0 0" }}>{p.last.overview}</p>}
          {!!p.last?.decisions.length && (
            <>
              <div style={sub}>Decided</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {p.last.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {p.openItems.length > 0 && (
            <>
              <div style={sub}>Open action items</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {p.openItems.map((i) => {
                  const done = added.has(`${p.eventId}:${i.task}`) || !!i.todoId;
                  return (
                    <li key={i.task} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 13, flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: 140 }}>
                        {i.task}
                        {(i.owner || i.due) && <span style={{ fontSize: 11, opacity: 0.75 }}> · {[i.owner, i.due].filter(Boolean).join(" · ")}</span>}
                      </span>
                      {done ? (
                        <span style={{ fontSize: 11, fontWeight: 800 }}>In to-dos ✓</span>
                      ) : (
                        <button style={small} onClick={() => void add(p, i.task)} aria-label={`+ To-do: ${i.task}`}>
                          + To-do
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!!p.last?.openQuestions.length && (
            <>
              <div style={sub}>Still open</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {p.last.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
          {p.relatedTasks.length > 0 && (
            <>
              <div style={sub}>Your to-dos with these people</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {p.relatedTasks.map((t) => (
                  <li key={t.id}>{t.title}</li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {p.last && (
              <button style={small} onClick={() => void openSource({ kind: "meeting", id: p.last!.id, title: p.last!.title })}>
                Open last meeting
              </button>
            )}
            {onAsk && (
              <button style={small} onClick={() => onAsk(`Help me prepare for my meeting "${p.title}". What did we discuss before, and what's still open?`)}>
                ✨ Ask ProdLi
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
