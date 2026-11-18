// 🎙 Speak tasks: talk (or paste) a brain dump, review the tasks ProdLi found,
// add the ones you want. Logic: lib/voiceTasks.ts. Tasks are added with the
// normal quick add (lib/capture.ts addTask), so lists and dates work.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { addTask } from "../lib/capture";
import { parseTask } from "../lib/taskParse";
import { linesFromDump, listen, MAX_DUMP_CHARS, speechSupported } from "../lib/voiceTasks";

const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "8px 14px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});

type Step = { kind: "input" } | { kind: "thinking" } | { kind: "review"; lines: { text: string; on: boolean }[]; note?: string };

export function VoiceTasksModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [adding, setAdding] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopRef.current?.();
    };
  }, [onClose]);

  const toggleMic = async () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    setError("");
    baseRef.current = text ? `${text.trim()} ` : "";
    setListening(true);
    stopRef.current = await listen(
      navigator.language || "en-US",
      (final, live) => {
        setText((baseRef.current + final).slice(0, MAX_DUMP_CHARS));
        setInterim(live);
      },
      (err) => {
        setListening(false);
        setInterim("");
        stopRef.current = null;
        if (err) setError(err);
      },
    );
  };

  const makeTasks = async () => {
    stopRef.current?.();
    setStep({ kind: "thinking" });
    const r = await linesFromDump(text);
    setStep({ kind: "review", lines: r.lines.map((t) => ({ text: t, on: true })), note: r.note });
  };

  const addAll = async () => {
    if (step.kind !== "review") return;
    setAdding(true);
    const chosen = step.lines.filter((l) => l.on && l.text.trim());
    for (const l of chosen) await addTask({ title: l.text, smart: true });
    setAdding(false);
    onDone(`Added ${chosen.length} task${chosen.length === 1 ? "" : "s"}`);
    onClose();
  };

  const field: CSSProperties = { border: "var(--nb-border)", padding: "8px 10px", fontFamily: "inherit", fontSize: 14, background: "hsl(var(--card))", color: "hsl(var(--foreground))", width: "100%", boxSizing: "border-box" };

  return (
    <div role="dialog" aria-modal="true" aria-label="Speak tasks" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px 16px" }}>
      <div data-testid="voice-tasks" onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700", padding: 18 }}>
        <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>🎙 Speak tasks</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>Say or paste everything on your mind: “call mom tomorrow at 5, buy milk, the report is due Friday and it's urgent”. You'll see the tasks before they're added.</div>

        {step.kind !== "review" ? (
          <>
            <textarea
              value={interim ? `${text}${text ? " " : ""}${interim}` : text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_DUMP_CHARS))}
              readOnly={listening}
              rows={6}
              aria-label="Your tasks, in your own words"
              placeholder={speechSupported() ? "Press 🎙 and start talking, or type here…" : "Type or paste here…"}
              style={{ ...field, resize: "vertical" }}
            />
            {error && <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", marginTop: 6 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 12, flexWrap: "wrap" }}>
              {speechSupported() ? (
                <button style={{ ...btn(), background: listening ? "#C62828" : "hsl(var(--card))", color: listening ? "#fff" : "hsl(var(--foreground))" }} onClick={() => void toggleMic()} aria-pressed={listening}>
                  {listening ? "■ Stop" : "🎙 Talk"}
                </button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btn()} onClick={onClose}>Cancel</button>
                <button style={btn(true, !text.trim() || step.kind === "thinking")} disabled={!text.trim() || step.kind === "thinking"} onClick={() => void makeTasks()}>
                  {step.kind === "thinking" ? "Finding tasks…" : "Make tasks"}
                </button>
              </div>
            </div>
            {listening && <div role="status" style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>Listening… press Stop when you're done.</div>}
          </>
        ) : (
          <>
            {step.note && <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>{step.note}</div>}
            {step.lines.length === 0 ? (
              <div role="status" style={{ fontWeight: 700 }}>No tasks found. Go back and add a bit more.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {step.lines.map((l, i) => {
                  const p = parseTask(l.text);
                  return (
                    <li key={i} data-testid="voice-task" style={{ border: "var(--nb-border)", padding: 8, background: l.on ? "hsl(var(--card))" : "hsl(var(--muted))" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={l.on} aria-label={`Add “${p.title}”`} onChange={(e) => setStep({ ...step, lines: step.lines.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                        <input value={l.text} aria-label={`Task ${i + 1}`} onChange={(e) => setStep({ ...step, lines: step.lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} style={{ ...field, padding: "4px 6px", fontSize: 13 }} />
                      </div>
                      {p.matched.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4, paddingLeft: 24 }}>
                          {p.matched.map((m) => (
                            <span key={m} style={{ border: "1px solid var(--nb-section-border)", padding: "0 5px", fontSize: 11, fontWeight: 700 }}>{m}</span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button style={btn()} onClick={() => setStep({ kind: "input" })}>Back</button>
              <button style={btn(true, adding || !step.lines.some((l) => l.on))} disabled={adding || !step.lines.some((l) => l.on)} onClick={() => void addAll()}>
                {adding ? "Adding…" : `Add ${step.lines.filter((l) => l.on).length} task${step.lines.filter((l) => l.on).length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
