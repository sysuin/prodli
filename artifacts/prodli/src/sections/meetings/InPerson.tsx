// Meetings → "🎙 Record in person": the header button and the recording bar.
// Logic (and why the recording lives in this page): recorder/inPerson.ts.

import { useEffect, useState, type CSSProperties } from "react";
import { inPersonSupported, startInPerson, stopInPerson } from "../../recorder/inPerson";
import { currentInPerson, onInPersonChange } from "../../recorder/inPersonState";
import { formatTimestamp } from "../../recorder/format";
import { copyDisclosure } from "./MeetingNotesSettings";
import { updateMeeting } from "../../recorder/db";
import { addMark } from "../../lib/moments";
import { YourNotes } from "./YourNotes";

const ACCENT = "#FF4FA3";
const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? ACCENT : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "7px 12px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
});

const PHASE_TEXT = { saving: "Saving the recording…", transcribing: "Transcribing with AI…", summarizing: "Writing the summary…" } as const;

/** The in-person recording in this page (survives switching ProdLi sections). */
function useInPerson() {
  const [rec, setRec] = useState(currentInPerson);
  useEffect(() => onInPersonChange(() => setRec(currentInPerson())), []);
  // Leaving the page would stop the recording: ask first.
  useEffect(() => {
    if (!rec) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rec]);
  return rec;
}

export function InPersonButton({ disabled, flash, onStarted }: { disabled?: boolean; flash: (msg: string) => void; onStarted?: (meetingId: string) => void }) {
  const rec = useInPerson();
  const [starting, setStarting] = useState(false);
  if (!inPersonSupported() || rec) return null;
  return (
    <button
      data-testid="record-in-person"
      style={btn(false, disabled || starting)}
      disabled={disabled || starting}
      title="Record a meeting in the room (or a voice note) from your microphone"
      onClick={() => {
        setStarting(true);
        startInPerson()
          .then((id) => onStarted?.(id))
          .catch((err: unknown) => flash(err instanceof Error ? err.message : "Recording couldn't start."))
          .finally(() => setStarting(false));
      }}
    >
      {starting ? "Starting…" : "🎙 Record in person"}
    </button>
  );
}

export function InPersonBar({ flash, onDone }: { flash: (msg: string) => void; onDone: (meetingId: string) => void }) {
  const rec = useInPerson();
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<keyof typeof PHASE_TEXT | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rec]);

  if (phase && !rec)
    return (
      <div role="status" data-testid="in-person-phase" style={{ borderBottom: "var(--nb-border)", background: "#000", color: "#fff", padding: "8px 24px", fontWeight: 700, fontSize: 13 }}>
        {PHASE_TEXT[phase]}
      </div>
    );
  if (!rec) return null;
  const stop = () => {
    void stopInPerson(setPhase).then((r) => {
      setPhase(null);
      if (!r) return;
      onDone(r.meetingId);
      flash(r.summarized ? "Notes ready" : r.transcribed ? "Transcript ready" : r.problem ? r.problem : "Recording saved");
    });
  };
  const mark = () => {
    let count = 0;
    void updateMeeting(rec.meetingId, (m) => {
      const marks = addMark(m.marks, Date.now() - rec.startedAt);
      count = marks.length;
      return { marks };
    }).then((m) => flash(m ? `★ Moment marked${count > 1 ? ` (${count})` : ""}` : "Couldn't mark the moment"));
  };
  return (
    <>
      <div data-testid="in-person-bar" style={{ borderBottom: "var(--nb-border)", background: "#000", color: "#fff", padding: "8px 24px", display: "flex", alignItems: "center", gap: 12, fontWeight: 700, fontSize: 13, flexWrap: "wrap" }}>
      <span className="timer-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "#E53935", display: "inline-block" }} />
      <span role="timer">Recording in person · {formatTimestamp(Math.max(0, now - rec.startedAt))}</span>
      <span style={{ opacity: 0.85, flex: "1 1 220px" }}>From your microphone. Keep this tab open; you can switch ProdLi sections.</span>
      <button style={btn()} onClick={() => void copyDisclosure().then((ok) => flash(ok ? "Heads-up copied" : "Couldn't copy"))} title="Copy your “I'm taking AI notes” message">📋 Copy heads-up</button>
      <button style={btn(notesOpen)} aria-pressed={notesOpen} onClick={() => setNotesOpen((v) => !v)} title="Your notes for this meeting">📝 Notes</button>
      <button style={btn()} onClick={mark} title="Mark this moment as important">★ Mark moment</button>
      <button style={btn(true)} onClick={stop}>■ Stop</button>
      </div>
      {notesOpen && (
        <div style={{ borderBottom: "var(--nb-border)", background: "hsl(var(--muted))", padding: "10px 24px" }}>
          <YourNotes meetingId={rec.meetingId} live compact />
        </div>
      )}
    </>
  );
}
