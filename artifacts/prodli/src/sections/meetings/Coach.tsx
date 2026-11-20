// A meeting's "🎯 Coach me" (Pro): short, honest AI feedback on how the meeting
// went for you — what worked, what to try next time, whether clear next steps
// were agreed, and questions you could have asked. The transcript (and your
// talk share, if recorded) goes to /api/ai/meeting-coach; the feedback is kept
// on the meeting (synced). Counts as one AI meeting summary.

import { useState, type CSSProperties } from "react";
import { accountRequest, AccountError, accountsEnabled } from "../../lib/prodliAccount";
import { transcriptToText } from "../../recorder/format";
import { updateMeeting } from "../../recorder/db";
import { talkStats } from "../../recorder/speakers";
import { COACH_FOCUS, type CoachFocus, type Meeting, type MeetingCoaching } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#FF4FA3" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "6px 12px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
});
const sub: CSSProperties = { fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };

/** What's sent: the transcript, who "you" are in it, and your talk share. */
export function coachInput(m: Meeting, focus: CoachFocus) {
  const you = m.transcript.some((e) => e.speaker === "You") ? "You" : null;
  return {
    title: (m.summary?.title || m.title).slice(0, 300),
    date: new Date(m.startedAt).toISOString().slice(0, 10),
    transcript: transcriptToText(m.transcript),
    you,
    talkShare: talkStats(m.speakerActivity)?.youShare ?? null,
    focus,
  };
}

export function Coach({ meeting }: { meeting: Meeting }) {
  const access = useProAccess();
  const [focus, setFocus] = useState<CoachFocus>(meeting.coaching?.focus ?? "general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = meeting.coaching;
  const locked = !!access && !access.allowed;
  // Can this copy ask for coaching at all? (Saved feedback shows either way.)
  const canRun = accountsEnabled() && !locked;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await accountRequest<{ coaching: Omit<MeetingCoaching, "focus"> }>("/api/ai/meeting-coach", { method: "POST", body: JSON.stringify(coachInput(meeting, focus)) }, { ai_quota_exceeded: "You've used this month's AI meeting summaries." });
      await updateMeeting(meeting.id, () => ({ coaching: { ...r.coaching, focus } }));
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Coaching didn't work this time. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="meeting-coach" style={{ display: "grid", gap: 6, fontSize: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 13 }}>
        🎯 Coach me
        <ProBadge />
      </div>
      {!c && canRun && <div style={{ fontSize: 12, opacity: 0.85 }}>Honest feedback on how this meeting went for you: what worked, what to try next time, and whether clear next steps were agreed.</div>}
      <ProNote access={access} what="Coaching tips" />
      {canRun && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
            This was
            <select value={focus} onChange={(e) => setFocus(e.target.value as CoachFocus)} style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "3px 4px" }}>
              {COACH_FOCUS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button style={btn(!c, busy)} disabled={busy} onClick={() => void run()}>
            {busy ? "Thinking…" : c ? "Coach again" : "🎯 Coach me"}
          </button>
          <span style={{ fontSize: 11, opacity: 0.75 }}>Uses 1 AI meeting summary.</span>
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
      {c && (
        <div data-testid="coach-result" style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 12px", marginTop: 4 }}>
          <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.5 }}>{c.verdict}</p>
          {c.strengths.length > 0 && (
            <>
              <div style={sub}>What worked</div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, listStyle: "disc" }}>{c.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
          {c.improvements.length > 0 && (
            <>
              <div style={sub}>Try next time</div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, listStyle: "disc" }}>{c.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
          <div style={sub}>Next steps</div>
          <div style={{ lineHeight: 1.5 }}>
            <strong>{c.nextStepsAgreed ? "✓ Agreed. " : "⚠ Left open. "}</strong>
            {c.nextStepsNote}
          </div>
          {c.missedQuestions.length > 0 && (
            <>
              <div style={sub}>Questions you could have asked</div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, listStyle: "disc" }}>{c.missedQuestions.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
