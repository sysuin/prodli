// Today → "🗒 Meeting prep": for each upcoming meeting with history, last time's
// summary, open action items (add them as to-dos) and related to-dos. Logic:
// lib/meetingPrep.ts. Recorded meetings are read from this device only.

import { useEffect, useState, type CSSProperties } from "react";
import { aiPrepInput, metLabel, type AiPrep, type MeetingPrep as Prep } from "../../lib/meetingPrep";
import { accountRequest, accountsEnabled, AccountError } from "../../lib/prodliAccount";
import { getDayKey } from "../../lib/utils";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";
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
  const access = useProAccess();
  const [ai, setAi] = useState<Record<string, { busy?: boolean; prep?: AiPrep; error?: string }>>({});
  const runAi = async (p: Prep) => {
    const input = aiPrepInput(p, getDayKey());
    if (!input) return;
    setAi((s) => ({ ...s, [p.eventId]: { busy: true } }));
    try {
      const r = await accountRequest<{ prep: AiPrep }>("/api/ai/meeting-prep", { method: "POST", body: JSON.stringify(input) }, { brief_quota_exceeded: "You've used this month's AI briefs and prep." });
      setAi((s) => ({ ...s, [p.eventId]: { prep: r.prep } }));
    } catch (err) {
      setAi((s) => ({ ...s, [p.eventId]: { error: err instanceof AccountError ? err.message : "Prep didn't work this time. Try again." } }));
    }
  };

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
            {accountsEnabled() && p.last && access?.allowed && !ai[p.eventId]?.prep && (
              <button style={small} disabled={ai[p.eventId]?.busy} onClick={() => void runAi(p)} aria-label={`Prep with AI: ${p.title}`}>
                {ai[p.eventId]?.busy ? "Preparing…" : "✨ Prep with AI"}
                <ProBadge />
              </button>
            )}
          </div>
          {accountsEnabled() && p.last && access && !access.allowed && <ProNote access={access} what="AI meeting prep" />}
          {ai[p.eventId]?.error && (
            <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", marginTop: 6 }}>
              {ai[p.eventId]?.error}
            </div>
          )}
          {ai[p.eventId]?.prep && (
            <div data-testid="ai-prep" style={{ border: "var(--nb-border)", padding: 8, marginTop: 8, background: "hsl(var(--muted))" }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>✨ {ai[p.eventId]!.prep!.goal}</div>
              <p style={{ fontSize: 13, margin: "4px 0 0" }}>{ai[p.eventId]!.prep!.recap}</p>
              {([["Follow up on", ai[p.eventId]!.prep!.followUps], ["Questions to ask", ai[p.eventId]!.prep!.questions], ["Suggested agenda", ai[p.eventId]!.prep!.agenda]] as const).map(([h, items]) =>
                items.length ? (
                  <div key={h}>
                    <div style={sub}>{h}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {items.map((x, j) => (
                        <li key={j}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
