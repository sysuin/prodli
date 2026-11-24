// Quick add: a to-do or a note in a couple of seconds. Opened by the Quick add
// shortcut (its own small window), the phone share sheet and the command palette.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { addNote, addTask, type CaptureInput } from "../lib/capture";
import { parseTask } from "../lib/taskParse";
import { addReadLater } from "../lib/readLater";
import { logHabitToday, matchHabits, parsePrefix, prefixHelp, startPomodoroNow, type PrefixKind } from "../lib/palettePrefix";
import { isDone, kindOf, momentText, progressLabel } from "../lib/habits";
import { storageGet } from "../lib/storage";
import { getDayKey } from "../lib/utils";
import type { Habit } from "../types";
import { openAsk } from "../lib/ask";
import { isExtension } from "../lib/tabSessions";

/** The Quick add window (extension) asks in a new ProdLi tab: index.html#ask=… (App opens Ask). */
const askInNewTab = (question?: string) => void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#ask=${encodeURIComponent(question ?? "")}`) });
import { SCREENSHOT_MESSAGE } from "../lib/screenshotCore";

const field: CSSProperties = { border: "var(--nb-border)", padding: "8px 10px", fontFamily: "inherit", fontSize: 14, background: "hsl(var(--background))", color: "hsl(var(--foreground))", width: "100%", boxSizing: "border-box" };

/**
 * Typing a prefix first: "t " a to-do, "n " a note (both switch the form),
 * "h read" check off a habit, "p 25" start a Pomodoro, "? …" ask ProdLi
 * (where `onAsk` is given). Same prefixes as the palette (lib/palettePrefix.ts).
 */
export function QuickAddForm({ initial, onDone, onCancel, onAsk }: { initial?: CaptureInput; onDone: (message: string) => void; onCancel: () => void; onAsk?: (question?: string) => void }) {
  const [kind, setKind] = useState<"todo" | "note" | "later">(initial?.text && initial.text.length > 120 ? "note" : "todo");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [planToday, setPlanToday] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const [habits, setHabits] = useState<Habit[]>([]);
  useEffect(() => void storageGet<Habit[]>("habits", []).then(setHabits), []);

  // h / p / ? turn the form into that action; t / n just pick the kind (handled on typing).
  const pre = parsePrefix(title);
  const action: PrefixKind | null = pre && (pre.kind === "habit" || pre.kind === "pomodoro" || (pre.kind === "ask" && onAsk)) ? pre.kind : null;
  const habitMatches = action === "habit" ? matchHabits(habits, pre!.rest) : [];
  const onTitle = (value: string) => {
    const p = parsePrefix(value);
    if (p && (p.kind === "todo" || p.kind === "note")) {
      setKind(p.kind);
      setTitle(p.rest);
    } else setTitle(value);
  };
  const runAction = async (habitId?: string) => {
    if (!pre || !action) return;
    setSaving(true);
    try {
      if (action === "pomodoro") {
        const t = await startPomodoroNow(pre.minutes, pre.rest);
        onDone(`🍅 Focus started: ${Math.round(t.remaining / 60)} min${pre.rest ? ` · ${pre.rest}` : ""}`);
      } else if (action === "habit") {
        const id = habitId ?? habitMatches[0]?.id;
        const r = id ? await logHabitToday(id) : null;
        if (!r) return;
        onDone(r.moment ? `${momentText(r.moment).title} ${r.habit.name}${r.moment.earnedFreeze ? " · 🧊 streak freeze earned" : ""}` : `${r.done ? "✓ " : ""}${r.habit.name}: ${progressLabel(r.habit, getDayKey())}`);
      } else if (action === "ask") {
        onAsk?.(pre.rest || undefined);
        onDone(pre.rest ? `Asking ProdLi: ${pre.rest}` : "Opening Ask ProdLi");
      }
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (action) return runAction();
    if (!title.trim() && !text.trim()) return;
    setSaving(true);
    try {
      if (kind === "todo") {
        const t = await addTask({ title, text, url: initial?.url, planToday, smart: true });
        onDone(`Added to-do: ${t.title}`);
      } else if (kind === "later") {
        const item = await addReadLater(initial?.url, title);
        onDone(item ? `Saved to Read later: ${item.title}` : "Only web pages can be saved to Read later.");
      } else {
        const n = await addNote({ title, text, url: initial?.url });
        onDone(`Saved note: ${n.title}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <div role="radiogroup" aria-label="Add as" style={{ display: action ? "none" : "flex", gap: 6 }}>
        {(initial?.url ? (["todo", "note", "later"] as const) : (["todo", "note"] as const)).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            style={{ flex: 1, border: "var(--nb-border)", padding: "6px 10px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", background: kind === k ? "#FFD700" : "hsl(var(--card))", color: kind === k ? "#000" : "hsl(var(--foreground))", cursor: "pointer", fontFamily: "inherit" }}
          >
            {k === "todo" ? "✅ To-do" : k === "note" ? "✍️ Note" : "📚 Later"}
          </button>
        ))}
      </div>
      <input ref={titleRef} value={title} onChange={(e) => onTitle(e.target.value)} placeholder={kind === "todo" ? "What needs doing?" : "Note title"} aria-label="Title" maxLength={300} style={field} />
      {action ? (
        <div data-testid="quickadd-action" style={{ display: "grid", gap: 6 }}>
          {action === "pomodoro" && (
            <button type="submit" disabled={saving} style={{ ...btn(true, saving), textAlign: "left", textTransform: "none" }}>
              🍅 Start {pre!.minutes ? `a ${pre!.minutes}-min` : "a"} Pomodoro{pre!.rest ? `: ${pre!.rest}` : ""}
            </button>
          )}
          {action === "ask" && (
            <button type="submit" disabled={saving} style={{ ...btn(true, saving), textAlign: "left", textTransform: "none" }}>
              ✨ Ask ProdLi{pre!.rest ? `: “${pre!.rest}”` : "…"}
            </button>
          )}
          {action === "habit" &&
            (habitMatches.length ? (
              habitMatches.slice(0, 6).map((h, i) => (
                <button key={h.id} type="button" disabled={saving} onClick={() => void runAction(h.id)} style={{ ...btn(i === 0, saving), textAlign: "left", textTransform: "none", display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {h.emoji} {kindOf(h) === "check" ? (isDone(h, getDayKey()) ? "Unmark" : "Check off") : kindOf(h) === "timed" ? "+5 min" : "+1"}: {h.name}
                  </span>
                  <span style={{ opacity: 0.7, fontWeight: 600 }}>{progressLabel(h, getDayKey())}</span>
                </button>
              ))
            ) : (
              <div style={{ fontSize: 12, opacity: 0.75 }}>{habits.some((h) => !h.archived) ? "No habit due today matches." : "No habits yet: add them in Habits."}</div>
            ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} style={btn(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
      <>
      {kind === "todo" && !title.trim() && <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "Space Mono, monospace" }}>Type first: {prefixHelp(onAsk ? ["todo", "note", "habit", "pomodoro", "ask"] : ["todo", "note", "habit", "pomodoro"])}</div>}
      {kind === "todo" && title.trim() && (() => {
        const p = parseTask(title);
        return p.matched.length ? (
          <div aria-live="polite" data-testid="quickadd-preview" style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 700 }}>
            <span style={{ opacity: 0.8 }}>Will add “{p.title}”:</span>
            {p.matched.map((m) => (
              <span key={m} style={{ border: "var(--nb-border)", padding: "1px 6px", background: "hsl(var(--muted))" }}>{m}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, opacity: 0.75 }}>Try “tomorrow at 3pm”, “every monday”, “#Work”, “@errands”, “!high”.</div>
        );
      })()}
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "todo" ? "Details (optional)" : "Text (optional)"} aria-label="Details" rows={kind === "note" ? 5 : 2} style={{ ...field, resize: "vertical" }} />
      {initial?.url && (
        <div style={{ fontSize: 12, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={initial.url}>
          🔗 {initial.url}
        </div>
      )}
      {kind === "todo" && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={planToday} onChange={(e) => setPlanToday(e.target.checked)} /> ☀️ Plan for today
        </label>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={btn(false)}>
          Cancel
        </button>
        <button type="submit" disabled={saving || (!title.trim() && !text.trim())} style={btn(true, saving || (!title.trim() && !text.trim()))}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      </>
      )}
    </form>
  );
}

const btn = (primary: boolean, disabled = false): CSSProperties => ({
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

/** As a dialog inside the app. */
export function QuickAddModal({ initial, onClose, onSaved }: { initial?: CaptureInput; onClose: () => void; onSaved: (message: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Quick add" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700", padding: 18 }}>
        <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>➕ Quick add</div>
        <QuickAddForm
          initial={initial}
          onAsk={openAsk}
          onCancel={onClose}
          onDone={(m) => {
            onSaved(m);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

/**
 * 📸 in the Quick add window: the background screenshots the tab the shortcut
 * was pressed on (activeTab) and opens the annotator. Extension only: the
 * window's address carries that tab (index.html#quick-add?…&tab=ID).
 */
function ScreenshotButton() {
  const tabId = Number(new URLSearchParams(location.hash.slice(location.hash.indexOf("?") + 1)).get("tab"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!tabId || typeof chrome === "undefined" || !chrome.runtime?.id) return null;
  const take = async () => {
    setBusy(true);
    setError("");
    try {
      const r = (await chrome.runtime.sendMessage({ target: SCREENSHOT_MESSAGE, tabId })) as { ok: boolean; error?: string } | undefined;
      if (r?.ok) return window.close();
      setError(r?.error ?? "ProdLi couldn't take a screenshot of this page.");
    } catch {
      setError("ProdLi couldn't take a screenshot of this page.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void take()} disabled={busy} style={{ ...btn(false, busy), padding: "5px 10px", textTransform: "none" }}>
        {busy ? "Taking…" : "📸 Screenshot this page"}
      </button>
      {error && (
        <div role="alert" style={{ position: "fixed", left: 18, right: 18, bottom: 12, border: "var(--nb-border)", background: "hsl(var(--card))", padding: "8px 10px", fontSize: 12, fontWeight: 600 }}>
          {error}
        </div>
      )}
    </>
  );
}

/** The extension's Quick add window (Alt+Shift+A). */
export function QuickAddWindow({ initial }: { initial?: CaptureInput }) {
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Add to ProdLi";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && window.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <main style={{ padding: 18, minHeight: "100vh", boxSizing: "border-box", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "Space Grotesk, Inter, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>➕ Add to ProdLi</div>
        {!done && <ScreenshotButton />}
      </div>
      {done ? (
        <div role="status" style={{ fontWeight: 700 }}>✓ {done}</div>
      ) : (
        <QuickAddForm
          initial={initial}
          onAsk={isExtension() ? askInNewTab : undefined}
          onCancel={() => window.close()}
          onDone={(m) => {
            setDone(m);
            setTimeout(() => window.close(), 700);
          }}
        />
      )}
    </main>
  );
}
