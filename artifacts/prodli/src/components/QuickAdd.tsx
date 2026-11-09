// Quick add: a to-do or a note in a couple of seconds. Opened by the Quick add
// shortcut (its own small window), the phone share sheet and the command palette.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { addNote, addTask, type CaptureInput } from "../lib/capture";

const field: CSSProperties = { border: "var(--nb-border)", padding: "8px 10px", fontFamily: "inherit", fontSize: 14, background: "hsl(var(--background))", color: "hsl(var(--foreground))", width: "100%", boxSizing: "border-box" };

export function QuickAddForm({ initial, onDone, onCancel }: { initial?: CaptureInput; onDone: (message: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"todo" | "note">(initial?.text && initial.text.length > 120 ? "note" : "todo");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [planToday, setPlanToday] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const save = async () => {
    if (!title.trim() && !text.trim()) return;
    setSaving(true);
    try {
      if (kind === "todo") {
        const t = await addTask({ title, text, url: initial?.url, planToday });
        onDone(`Added to-do: ${t.title}`);
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
      <div role="radiogroup" aria-label="Add as" style={{ display: "flex", gap: 6 }}>
        {(["todo", "note"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            style={{ flex: 1, border: "var(--nb-border)", padding: "6px 10px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", background: kind === k ? "#FFD700" : "hsl(var(--card))", color: kind === k ? "#000" : "hsl(var(--foreground))", cursor: "pointer", fontFamily: "inherit" }}
          >
            {k === "todo" ? "✅ To-do" : "✍️ Note"}
          </button>
        ))}
      </div>
      <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "todo" ? "What needs doing?" : "Note title"} aria-label="Title" maxLength={300} style={field} />
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
      <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>➕ Add to ProdLi</div>
      {done ? (
        <div role="status" style={{ fontWeight: 700 }}>✓ {done}</div>
      ) : (
        <QuickAddForm
          initial={initial}
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
