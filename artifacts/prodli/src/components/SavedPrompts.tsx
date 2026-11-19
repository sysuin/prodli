// Ask ProdLi → "★ Saved prompts": run a saved question, schedule it (days and
// time; the answer arrives as a notification), or remove it.

import { useEffect, useState, type CSSProperties } from "react";
import { getPrompts, PROMPTS_KEY, savePrompts, scheduleLabel, type SavedPrompt } from "../lib/askPrompts";
import { onStorageChange } from "../lib/storage";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const icon: CSSProperties = { border: "none", background: "none", cursor: "pointer", fontWeight: 900, fontSize: 13, padding: "0 4px", color: "hsl(var(--foreground))", fontFamily: "inherit" };
const isExtension = () => typeof chrome !== "undefined" && !!chrome.alarms;

export function SavedPrompts({ onRun, disabled }: { onRun: (text: string) => void; disabled: boolean }) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void getPrompts().then(setPrompts);
    return onStorageChange<SavedPrompt[]>(PROMPTS_KEY, (v) => setPrompts(v ?? []));
  }, []);

  const update = (next: SavedPrompt[]) => {
    setPrompts(next);
    void savePrompts(next);
  };
  const patch = (id: string, p: Partial<SavedPrompt>) => update(prompts.map((x) => (x.id === id ? { ...x, ...p } : x)));

  if (!prompts.length) return null;
  return (
    <div data-testid="saved-prompts" style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>★ Saved prompts</div>
      {prompts.map((p) => (
        <div key={p.id} style={{ border: "1px solid var(--nb-section-border)", padding: "4px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => onRun(p.text)} disabled={disabled} style={{ ...icon, flex: 1, textAlign: "left", fontWeight: 700, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: disabled ? 0.6 : 1 }} title="Ask now">
              {p.text}
            </button>
            {isExtension() && (
              <button style={icon} onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id} aria-label={`Schedule: ${p.text}`} title={p.schedule ? scheduleLabel(p.schedule) : "Run on a schedule"}>
                {p.schedule ? "⏰" : "🕒"}
              </button>
            )}
            <button style={{ ...icon, color: "var(--danger-text)" }} onClick={() => update(prompts.filter((x) => x.id !== p.id))} aria-label={`Remove saved prompt: ${p.text}`}>×</button>
          </div>
          {p.schedule && editing !== p.id && <div style={{ fontSize: 11, opacity: 0.8, paddingLeft: 4 }}>⏰ {scheduleLabel(p.schedule)}, as a notification</div>}
          {editing === p.id && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4, fontSize: 12 }}>
              <span role="group" aria-label="Days" style={{ display: "inline-flex" }}>
                {DAY_LETTERS.map((l, d) => {
                  const days = p.schedule?.days ?? [];
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      aria-pressed={on}
                      aria-label={DAY_NAMES[d]}
                      onClick={() => {
                        const next = on ? days.filter((x) => x !== d) : [...days, d].sort();
                        patch(p.id, { schedule: next.length ? { time: p.schedule?.time ?? "08:30", days: next } : undefined });
                      }}
                      style={{ width: 22, height: 22, border: "var(--nb-border)", marginLeft: d ? -2 : 0, background: on ? "hsl(var(--foreground))" : "hsl(var(--card))", color: on ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {l}
                    </button>
                  );
                })}
              </span>
              <input
                type="time"
                aria-label="Time"
                value={p.schedule?.time ?? "08:30"}
                onChange={(e) => e.target.value && patch(p.id, { schedule: { time: e.target.value, days: p.schedule?.days?.length ? p.schedule.days : [1, 2, 3, 4, 5] } })}
                style={{ border: "var(--nb-border)", fontFamily: "inherit", fontSize: 12, padding: "1px 4px", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
              />
              <span style={{ opacity: 0.8 }}>{p.schedule ? "Each run uses one question." : "Pick days to schedule it."}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
