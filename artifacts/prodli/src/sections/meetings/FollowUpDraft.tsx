// "✉️ Draft follow-up" in a meeting's summary: writes a subject and email body
// from the summary only (never the transcript), in a Formal or Friendly tone.
// The draft is editable here; Copy or Open in email app sends it on. Nothing
// is sent to anyone by ProdLi. Network and helpers: lib/write.ts (phase 2 in
// docs/PLAN-WRITING-ASSIST.md).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { draftFollowUp, followUpMeeting, mailtoHref, RewriteError, type FollowUpResult, type FollowUpTone } from "../../lib/write";
import type { MeetingSummary } from "../../recorder/types";

const ACCENT = "#FF4FA3";
const TONES: { id: FollowUpTone; label: string }[] = [
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
];

function btn(primary = false, disabled = false): CSSProperties {
  return {
    border: "var(--nb-border)",
    boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
    background: primary ? ACCENT : "hsl(var(--card))",
    color: primary ? "#000" : "hsl(var(--foreground))",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    display: "inline-block",
  };
}

const field: CSSProperties = {
  width: "100%",
  border: "var(--nb-border)",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  fontFamily: "inherit",
  fontSize: 14,
  padding: "6px 8px",
  boxSizing: "border-box",
};

const fieldLabel: CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };

interface Draft extends FollowUpResult {
  /** What the user sees and can edit. */
  editedSubject: string;
  editedBody: string;
}

type Phase = { kind: "loading"; tone: FollowUpTone } | { kind: "error"; tone: FollowUpTone; message: string } | { kind: "ready" };

export function FollowUpDraft({
  summary,
  meetingTitle,
  startedAt,
  onClose,
  flash,
}: {
  summary: MeetingSummary;
  meetingTitle: string;
  startedAt: string;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const [tone, setTone] = useState<FollowUpTone>("friendly");
  const [drafts, setDrafts] = useState<Partial<Record<FollowUpTone, Draft>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "loading", tone: "friendly" });
  const request = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Latest props, read when a draft is requested. The meeting list reloads from
  // storage and hands down new objects, which must not start (and spend) a new draft.
  const source = useRef({ summary, meetingTitle, startedAt });
  source.current = { summary, meetingTitle, startedAt };
  const started = useRef(false);

  const write = useCallback(async (t: FollowUpTone) => {
    const id = ++request.current;
    setPhase({ kind: "loading", tone: t });
    try {
      const { summary: s, meetingTitle: title, startedAt: at } = source.current;
      const r = await draftFollowUp(t, followUpMeeting(s, title, at));
      if (id !== request.current) return;
      setDrafts((d) => ({ ...d, [t]: { ...r, editedSubject: r.subject, editedBody: r.body } }));
      setPhase({ kind: "ready" });
    } catch (err) {
      if (id !== request.current) return;
      setPhase({ kind: "error", tone: t, message: err instanceof RewriteError ? err.message : "Something went wrong. Try again." });
    }
  }, []);

  // Write the first draft once, when the panel opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void write("friendly");
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [write]);

  const pickTone = (t: FollowUpTone) => {
    if (t === tone && phase.kind !== "error") return;
    setTone(t);
    if (drafts[t]) {
      request.current++; // a draft for the other tone may still be loading
      setPhase({ kind: "ready" });
    } else void write(t);
  };

  const draft = phase.kind === "ready" ? drafts[tone] : undefined;
  const edit = (patch: Partial<Pick<Draft, "editedSubject" | "editedBody">>) => setDrafts((d) => (d[tone] ? { ...d, [tone]: { ...d[tone]!, ...patch } } : d));

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash("Couldn't copy. Select the text and copy it instead.");
    }
  };

  const mailto = draft ? mailtoHref(draft.editedSubject, draft.editedBody) : null;
  const left = draft?.usage ? Math.max(0, draft.usage.limit - draft.usage.used) : null;
  const loading = phase.kind === "loading";

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Follow-up email"
      data-testid="follow-up"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", padding: 14, marginTop: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>✉️ Follow-up email</div>
        <div role="group" aria-label="Tone" style={{ display: "flex" }}>
          {TONES.map((t) => (
            <button key={t.id} aria-pressed={tone === t.id} onClick={() => pickTone(t.id)} style={{ ...btn(tone === t.id), boxShadow: "none", marginLeft: t.id === "formal" ? -2 : 0 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Writing a {phase.tone === "formal" ? "formal" : "friendly"} follow-up…</span>
          <button style={btn()} onClick={() => (request.current++, onClose())}>Cancel</button>
        </div>
      )}

      {phase.kind === "error" && (
        <div style={{ marginTop: 12 }}>
          <div role="alert" style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{phase.message}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={() => void write(phase.tone)}>Try again</button>
            <button style={btn()} onClick={onClose}>Close</button>
          </div>
        </div>
      )}

      {draft && (
        <div>
          <label style={fieldLabel} htmlFor="follow-up-subject">Subject</label>
          <input id="follow-up-subject" style={field} value={draft.editedSubject} onChange={(e) => edit({ editedSubject: e.target.value })} />
          <label style={fieldLabel} htmlFor="follow-up-body">Email</label>
          <textarea
            id="follow-up-body"
            data-testid="follow-up-body"
            style={{ ...field, minHeight: 220, resize: "vertical", lineHeight: 1.5 }}
            value={draft.editedBody}
            onChange={(e) => edit({ editedBody: e.target.value })}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <button style={btn(true)} onClick={() => void copy(draft.editedBody, "Email")}>Copy email</button>
            <button style={btn()} onClick={() => void copy(draft.editedSubject, "Subject")}>Copy subject</button>
            {mailto && (
              <a href={mailto} style={btn()} target="_blank" rel="noopener noreferrer">
                Open in email app
              </a>
            )}
            <button style={btn()} onClick={() => void write(tone)} title="Write a new draft (uses one more writing-help use)">Write again</button>
            <button style={btn()} onClick={onClose}>Discard</button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
            {mailto ? "" : "Too long to open in an email app directly. Copy it instead. "}
            Written from the summary only. Check names and dates before sending.
            {left !== null ? ` ${left} of ${draft.usage!.limit} writing-help uses left this month.` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
