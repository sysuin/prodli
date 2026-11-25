// Today → "Now" (gentle day mode): the task whose time block is on, a big
// countdown, its steps, and calm buttons: ✓ Done, +5 min, ✨ Break it down.
// Between blocks it shows what's next and when. Hidden when today has no blocks.

import { useEffect, useState, type CSSProperties } from "react";
import type { Todo } from "../../types";
import { countdown, currentBlock, nextBlock } from "../../lib/nowBlock";
import { breakDown } from "../../lib/breakDown";
import { toHM } from "../../lib/timeBlocks";
import { generateId } from "../../lib/utils";
import { toggleTodo as toggleCompletion } from "../../lib/recurrence";

const card: CSSProperties = { border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", padding: 16, display: "grid", gap: 10 };
const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  background: primary ? "#14B8A6" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "7px 12px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});

const nowMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function NowCard({ todos, setTodos, day, signedIn }: { todos: Todo[]; setTodos: (fn: (list: Todo[]) => Todo[]) => void; day: string; signedIn: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [steps, setSteps] = useState<{ forId: string; items: { text: string; on: boolean }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const min = nowMinutes(now);
  const cur = currentBlock(todos, day, min);
  const next = nextBlock(todos, day, min);
  if (!cur && !next) return null;

  const update = (id: string, patch: (t: Todo) => Partial<Todo>) => setTodos((list) => list.map((t) => (t.id === id ? { ...t, ...patch(t), updatedAt: new Date().toISOString() } : t)));

  if (!cur) {
    const inMin = next!.slot.start - min;
    if (inMin > 120) return null;
    return (
      <section style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderLeft: "6px solid #14B8A6" }} data-testid="now-card" aria-label="Up next">
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 200 }}>
          🌿 Nothing planned right now. Up next at {toHM(next!.slot.start)}: <strong>{next!.todo.title}</strong> ({inMin < 60 ? `in ${inMin} min` : `in ${Math.floor(inMin / 60)} h ${inMin % 60} min`}).
        </span>
      </section>
    );
  }

  const t = cur.todo;
  const endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, cur.slot.end).getTime();
  const total = (cur.slot.end - cur.slot.start) * 60_000;
  const left = Math.max(0, endMs - now.getTime());
  const done = Math.min(1, 1 - left / total);
  const subtasks = t.subtasks ?? [];

  const askSteps = async () => {
    setBusy(true);
    setError("");
    try {
      const items = await breakDown(t.title, subtasks.map((s) => s.title).join("\n"));
      setSteps({ forId: t.id, items: items.map((text) => ({ text, on: true })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't break it down. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const addSteps = () => {
    if (!steps) return;
    const chosen = steps.items.filter((s) => s.on && s.text.trim());
    update(t.id, (x) => ({ subtasks: [...(x.subtasks ?? []), ...chosen.map((s) => ({ id: generateId(), title: s.text.trim(), completed: false }))] }));
    setSteps(null);
  };

  return (
    <section style={{ ...card, borderLeft: "6px solid #14B8A6" }} data-testid="now-card" aria-label="Now">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7 }}>Now · until {toHM(cur.slot.end)}</div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>{t.title}</div>
        </div>
        <div data-testid="now-countdown" aria-label="Time left" style={{ fontSize: 40, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {countdown(left)}
        </div>
      </div>
      <div aria-hidden="true" style={{ height: 8, border: "var(--nb-border)", background: "hsl(var(--background))" }}>
        <div style={{ height: "100%", width: `${Math.round(done * 100)}%`, background: "#14B8A6", transition: "width 1s linear" }} />
      </div>
      {subtasks.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {subtasks.map((s) => (
            <li key={s.id}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer", textDecoration: s.completed ? "line-through" : undefined, opacity: s.completed ? 0.6 : 1 }}>
                <input type="checkbox" checked={s.completed} onChange={() => update(t.id, (x) => ({ subtasks: (x.subtasks ?? []).map((y) => (y.id === s.id ? { ...y, completed: !y.completed } : y)) }))} />
                {s.title}
              </label>
            </li>
          ))}
        </ul>
      )}
      {steps?.forId === t.id && (
        <div data-testid="now-steps" style={{ border: "var(--nb-border)", padding: 10, display: "grid", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>Suggested steps — untick any you don't want</div>
          {steps.items.map((s, i) => (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={s.on} onChange={(e) => setSteps({ ...steps, items: steps.items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
              {s.text}
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button style={btn(true)} onClick={addSteps}>Add steps</button>
            <button style={btn()} onClick={() => setSteps(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: "#B91C1C", fontWeight: 700 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn(true)} onClick={() => setTodos((list) => toggleCompletion(list, t.id))} data-testid="now-done">✓ Done</button>
        <button style={btn()} onClick={() => update(t.id, (x) => ({ estimateMin: (x.estimateMin ?? cur.slot.end - cur.slot.start) + 5 }))}>+5 min</button>
        {signedIn && (
          <button style={btn(false, busy)} disabled={busy} onClick={() => void askSteps()} title="ProdLi suggests a few small steps (a writing-help use)" data-testid="now-breakdown">
            {busy ? "Thinking…" : "✨ Break it down"}
          </button>
        )}
        {next && <span style={{ fontSize: 12, opacity: 0.75, marginLeft: "auto" }}>Next at {toHM(next.slot.start)}: {next.todo.title}</span>}
      </div>
    </section>
  );
}
