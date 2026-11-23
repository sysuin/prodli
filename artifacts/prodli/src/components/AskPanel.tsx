// Ask ProdLi: a chat panel that slides in from the right (full screen on
// phones). Answers come from the user's own tasks, calendar, habits, notes and
// meetings; suggested actions apply only when the user clicks them.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { askProdli, canAsk, RECIPES, SUGGESTIONS, type AskAction, type ChatTurn } from "../lib/ask";
import { openSource } from "../lib/askOpen";
import { addPrompt } from "../lib/askPrompts";
import { SavedPrompts } from "./SavedPrompts";
import { addNote, addTask } from "../lib/capture";
import { accountsEnabled, onProdliAccountChange } from "../lib/prodliAccount";
import { storageGet, storageSet } from "../lib/storage";
import { dayKey } from "../lib/today";
import type { Todo } from "../types";

// The conversation lasts as long as the page (not stored or synced).
let chat: ChatTurn[] = [];

const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#A78BFA" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "6px 10px",
  fontWeight: 800,
  fontSize: 12,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});

async function applyAction(a: AskAction): Promise<string> {
  if (a.type === "add_note") {
    await addNote({ title: a.title, text: a.details });
    return `Saved note “${a.title}”`;
  }
  if (a.type === "plan_today") {
    const todos = await storageGet<Todo[]>("todos", []);
    const match = todos.find((t) => !t.completed && t.title.trim().toLowerCase() === a.title.trim().toLowerCase());
    if (match) {
      await storageSet("todos", todos.map((t) => (t.id === match.id ? { ...t, plannedFor: dayKey(), updatedAt: new Date().toISOString() } : t)));
      return `Planned “${match.title}” for today`;
    }
    await addTask({ title: a.title, text: a.details, planToday: true });
    return `Added “${a.title}” for today`;
  }
  await addTask({ title: a.title, text: a.details });
  return `Added to-do “${a.title}”`;
}

const ACTION_LABEL: Record<AskAction["type"], string> = { add_task: "✅ Add to-do", plan_today: "☀️ Plan for today", add_note: "✍️ Save note" };

export function AskPanel({ onClose, initialQuestion, initialTurns }: { onClose: () => void; initialQuestion?: string; initialTurns?: ChatTurn[] }) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns ?? chat);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    void canAsk().then(setAllowed);
    const off = onProdliAccountChange(() => void canAsk().then(setAllowed));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    chat = turns;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: q }]);
    setBusy(true);
    try {
      const r = await askProdli(q, history);
      setTurns((t) => [...t, { role: "assistant", text: r.answer, actions: r.actions, sources: r.sources }]);
    } catch (err) {
      setTurns((t) => [...t, { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    if (initialQuestion && allowed && !asked.current) {
      asked.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, allowed]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Ask ProdLi" className="ask-backdrop" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2050, background: "rgba(0,0,0,0.35)", display: "flex", justifyContent: "flex-end" }}>
      <div className="ask-panel" onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", height: "100%", background: "hsl(var(--background))", color: "hsl(var(--foreground))", borderLeft: "3px solid #000", boxShadow: "-6px 0 0 #A78BFA", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#000", color: "#A78BFA", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>✨ Ask ProdLi</span>
          <div style={{ display: "flex", gap: 6 }}>
            {turns.length > 0 && (
              <button onClick={() => setTurns([])} style={{ border: "none", background: "transparent", color: "#aaa", fontWeight: 800, fontSize: 11, cursor: "pointer", textTransform: "uppercase" }}>
                New chat
              </button>
            )}
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "#A78BFA", fontSize: 20, cursor: "pointer", fontWeight: 900 }}>
              ×
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }} aria-live="polite">
          {allowed === false && turns.length === 0 ? (
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <strong>Ask ProdLi about your day.</strong>
              <p style={{ margin: "6px 0 0" }}>{accountsEnabled() ? "Sign in (👤) to ask questions about your tasks, calendar, notes and meetings. It's free." : "Ask ProdLi needs a ProdLi account, which isn't available in this copy of ProdLi."}</p>
            </div>
          ) : turns.length === 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>Ask about your tasks, calendar, habits, notes and meetings. ProdLi can also add to-dos and notes for you.</p>
              <SavedPrompts onRun={(q) => void send(q)} disabled={!allowed || busy} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => void send(s)} disabled={!allowed || busy} style={{ ...btn(false, !allowed || busy), fontWeight: 600, fontSize: 12 }}>
                    {s}
                  </button>
                ))}
              </div>
              <div data-testid="ask-recipes" style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7 }}>Recipes for meetings and notes</div>
                {RECIPES.map((r) => (
                  <div key={r} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => void send(r)} disabled={!allowed || busy} style={{ ...btn(false, !allowed || busy), fontWeight: 600, fontSize: 12, textAlign: "left", flex: 1 }}>
                      {r}
                    </button>
                    <button
                      onClick={() => void addPrompt(r).then(() => setSaved((x) => ({ ...x, [r]: true })))}
                      disabled={saved[r]}
                      aria-label={saved[r] ? "Saved prompt" : `Save prompt: ${r}`}
                      title="Save to ask again (or on a schedule)"
                      style={{ border: "none", background: "none", cursor: saved[r] ? "default" : "pointer", fontSize: 13, fontWeight: 800, color: "hsl(var(--muted-foreground))", fontFamily: "inherit", padding: "0 4px" }}
                    >
                      {saved[r] ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t, i) => (
              <div key={i} style={{ justifySelf: t.role === "user" ? "end" : "start", maxWidth: "88%" }}>
                <div
                  data-testid={t.role === "assistant" ? "ask-answer" : undefined}
                  style={{ border: "var(--nb-border)", padding: "8px 11px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", background: t.role === "user" ? "#A78BFA" : t.error ? "#FFF3CD" : "hsl(var(--card))", color: t.role === "user" || t.error ? "#000" : "inherit" }}
                >
                  {t.text}
                </div>
                {t.role === "user" && (
                  <div style={{ textAlign: "right", marginTop: 2 }}>
                    <button
                      onClick={() => void addPrompt(t.text).then(() => setSaved((x) => ({ ...x, [t.text]: true })))}
                      disabled={saved[t.text]}
                      aria-label={saved[t.text] ? "Saved prompt" : `Save prompt: ${t.text}`}
                      title="Save this question to ask again (or on a schedule)"
                      style={{ border: "none", background: "none", cursor: saved[t.text] ? "default" : "pointer", fontSize: 11, fontWeight: 800, color: "hsl(var(--muted-foreground))", fontFamily: "inherit", padding: 0 }}
                    >
                      {saved[t.text] ? "★ Saved" : "☆ Save prompt"}
                    </button>
                  </div>
                )}
                {t.sources && t.sources.length > 0 && (
                  <div data-testid="ask-sources" style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6, fontSize: 11 }}>
                    <span style={{ fontWeight: 800, opacity: 0.75 }}>Sources:</span>
                    {t.sources.map((src) => (
                      <button
                        key={src.id}
                        onClick={() => {
                          void openSource(src);
                          onClose();
                        }}
                        title={`Open ${src.kind === "note" ? "note" : "meeting"}${src.date ? ` (${src.date})` : ""}`}
                        style={{ border: "1px solid var(--nb-section-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "1px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {src.kind === "note" ? "📝" : "🎙"} {src.title}
                      </button>
                    ))}
                  </div>
                )}
                {t.actions && t.actions.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {t.actions.map((a, j) => {
                      const key = `${i}-${j}`;
                      return applied[key] ? (
                        <span key={key} style={{ fontSize: 12, fontWeight: 700 }}>
                          ✓ {applied[key]}
                        </span>
                      ) : (
                        <button key={key} onClick={() => void applyAction(a).then((m) => setApplied((x) => ({ ...x, [key]: m })))} style={{ ...btn(), fontSize: 11 }} title={a.details || a.title}>
                          {ACTION_LABEL[a.type]}: {a.title.length > 40 ? `${a.title.slice(0, 40)}…` : a.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
          {busy && <div style={{ fontSize: 13, opacity: 0.7 }}>Thinking…</div>}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          style={{ borderTop: "var(--nb-border)", padding: 12, display: "flex", gap: 8 }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={allowed === false ? "Sign in to ask" : "Ask anything about your day…"}
            aria-label="Ask ProdLi a question"
            disabled={allowed === false}
            style={{ flex: 1, border: "var(--nb-border)", padding: 8, fontFamily: "inherit", fontSize: 14, resize: "none", background: "hsl(var(--card))", color: "inherit" }}
          />
          <button type="submit" disabled={busy || !draft.trim() || allowed === false} style={{ ...btn(true, busy || !draft.trim() || allowed === false), alignSelf: "stretch", padding: "0 14px" }}>
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
