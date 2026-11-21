// "📝 Your notes": a notepad for the meeting, open while it's recorded (call or
// in person) and on the meeting afterwards. Saved on the meeting as you type
// (Meeting.userNotes, synced). With Pro, summaries build on them: what mattered
// to you, and your wording for decisions and action items (prodli-api ai.ts).

import { useEffect, useRef, useState } from "react";
import { getMeeting, updateMeeting } from "../../recorder/db";
import { ProBadge, useProAccess } from "../../components/Pro";

export const MAX_USER_NOTES = 8000;
const SAVE_AFTER_MS = 600;

export function YourNotes({ meetingId, live = false, compact = false }: { meetingId: string; live?: boolean; compact?: boolean }) {
  const access = useProAccess();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);

  // Load once per meeting; after that this box owns the text (no reloading under the cursor).
  useEffect(() => {
    let cancelled = false;
    setText(null);
    void getMeeting(meetingId).then((m) => {
      if (!cancelled) setText(m?.userNotes ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const flush = () => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    void updateMeeting(meetingId, () => ({ userNotes: value })).then(() => setSaved(pending.current === null));
  };
  // Save what's typed if the box goes away (recording stopped, another meeting opened).
  useEffect(() => () => flush(), [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (text === null) return null;
  const onChange = (value: string) => {
    const v = value.slice(0, MAX_USER_NOTES);
    setText(v);
    setSaved(false);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
  };

  return (
    <div data-testid="your-notes" style={{ display: "grid", gap: 4 }}>
      {!compact && (
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {access?.allowed ? (
            <>Summaries build on your notes: what mattered to you, in your words.{access.earlyAccess ? " (Pro, free while Pro is launching.)" : ""}</>
          ) : access ? (
            <>
              Your notes are kept with the meeting. With ProdLi Pro, summaries build on them. <ProBadge />
            </>
          ) : (
            <>Your notes are kept with the meeting.</>
          )}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        aria-label="Your notes for this meeting"
        placeholder={live ? "Jot down what matters as it happens: decisions, numbers, who owns what…" : "Add your own notes for this meeting…"}
        rows={compact ? 3 : 4}
        style={{ width: "100%", boxSizing: "border-box", border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, padding: "8px 10px", resize: "vertical" }}
      />
      <div aria-live="polite" style={{ fontSize: 11, opacity: 0.7, textAlign: "right" }}>
        {saved ? (text ? "Saved" : "") : "Saving…"}
      </div>
    </div>
  );
}
