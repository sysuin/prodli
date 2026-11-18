// Repeat picker and the inline "✎" editor for a task: due date, time (reminder),
// repeat and priority.

import { useId, useState } from "react";
import { firstOccurrence, repeatLabel } from "../../lib/recurrence";
import { getDayKey } from "../../lib/utils";
import type { Repeat, Todo } from "../../types";

type Preset = "" | "day" | "weekdays" | "week" | "week2" | "month" | "year" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "", label: "Doesn't repeat" },
  { id: "day", label: "Every day" },
  { id: "weekdays", label: "Every weekday (Mon–Fri)" },
  { id: "week", label: "Every week" },
  { id: "week2", label: "Every 2 weeks" },
  { id: "month", label: "Every month" },
  { id: "year", label: "Every year" },
  { id: "custom", label: "Custom…" },
];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function presetOf(r: Repeat | undefined): Preset {
  if (!r) return "";
  const days = r.weekdays ?? [];
  if (r.unit === "week" && r.every === 1 && days.join(",") === "1,2,3,4,5") return "weekdays";
  if (days.length) return "custom";
  if (r.every === 1) return r.unit === "day" ? "day" : r.unit;
  if (r.unit === "week" && r.every === 2) return "week2";
  return "custom";
}

export function repeatFromPreset(p: Preset, current?: Repeat): Repeat | undefined {
  switch (p) {
    case "":
      return undefined;
    case "day":
      return { unit: "day", every: 1 };
    case "weekdays":
      return { unit: "week", every: 1, weekdays: [1, 2, 3, 4, 5] };
    case "week":
      return { unit: "week", every: 1 };
    case "week2":
      return { unit: "week", every: 2 };
    case "month":
      return { unit: "month", every: 1 };
    case "year":
      return { unit: "year", every: 1 };
    case "custom":
      return current ?? { unit: "week", every: 1 };
  }
}

/** Applies a new repeat rule: a date is needed to repeat from, and months/years remember their day. */
export function withRepeat<T extends Pick<Todo, "dueDate" | "repeat">>(t: T, repeat: Repeat | undefined, today = getDayKey()): T {
  if (!repeat) return { ...t, repeat: undefined };
  // On chosen weekdays: start on the first of those days (on or after the current date).
  const dueDate = t.dueDate ? (repeat.unit === "week" && repeat.weekdays?.length ? firstOccurrence(repeat, t.dueDate) : t.dueDate) : firstOccurrence(repeat, today);
  const r = repeat.unit === "month" || repeat.unit === "year" ? { ...repeat, monthDay: +dueDate.slice(8, 10) } : { ...repeat, monthDay: undefined };
  return { ...t, dueDate, repeat: r };
}

const field: React.CSSProperties = { border: "var(--nb-border)", padding: "0 8px", height: 32, boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };

export function RepeatPicker({ value, onChange, compact = false }: { value: Repeat | undefined; onChange: (r: Repeat | undefined) => void; compact?: boolean }) {
  const id = useId();
  // "Custom…" stays open even when the rule happens to match a preset (e.g. every 1 month).
  const [customOpen, setCustomOpen] = useState(false);
  const preset = value && customOpen ? "custom" : presetOf(value);
  const custom = preset === "custom" && value;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select
        aria-label="Repeat"
        title={value ? repeatLabel(value) : "Repeat"}
        value={preset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          setCustomOpen(p === "custom");
          onChange(repeatFromPreset(p, value));
        }}
        style={{ ...field, height: compact ? 38 : 32, boxShadow: compact ? "var(--nb-shadow-sm)" : undefined, maxWidth: compact ? 130 : undefined }}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.id === "" && compact ? "🔁 Repeat" : p.label}</option>
        ))}
      </select>
      {custom && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12, fontWeight: 700 }}>
          <label htmlFor={`${id}-n`}>Every</label>
          <input
            id={`${id}-n`}
            type="number"
            min={1}
            max={99}
            value={custom.every}
            onChange={(e) => onChange({ ...custom, every: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
            style={{ ...field, width: 56 }}
          />
          <select aria-label="Repeat unit" value={custom.unit} onChange={(e) => onChange({ ...custom, unit: e.target.value as Repeat["unit"], weekdays: e.target.value === "week" ? custom.weekdays : undefined })} style={field}>
            <option value="day">{custom.every === 1 ? "day" : "days"}</option>
            <option value="week">{custom.every === 1 ? "week" : "weeks"}</option>
            <option value="month">{custom.every === 1 ? "month" : "months"}</option>
            <option value="year">{custom.every === 1 ? "year" : "years"}</option>
          </select>
          {custom.unit === "week" && (
            <span role="group" aria-label="On these days" style={{ display: "inline-flex" }}>
              {DAY_LETTERS.map((l, d) => {
                const on = custom.weekdays?.includes(d) ?? false;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAMES[d]}
                    onClick={() => {
                      const next = on ? (custom.weekdays ?? []).filter((x) => x !== d) : [...(custom.weekdays ?? []), d].sort();
                      onChange({ ...custom, weekdays: next.length ? next : undefined });
                    }}
                    style={{ width: 26, height: 26, border: "var(--nb-border)", marginLeft: d ? -2 : 0, background: on ? "hsl(var(--foreground))" : "hsl(var(--card))", color: on ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {l}
                  </button>
                );
              })}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

const PRIORITIES: { id: "" | "high" | "medium" | "low"; label: string }[] = [
  { id: "", label: "No priority" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

/** Inline editor under a task: date, time, repeat, priority. Changes save as they're made. */
export function TaskDetails({ todo, onChange }: { todo: Todo; onChange: (patch: Partial<Todo>) => void }) {
  const id = useId();
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 3 };
  return (
    <div data-testid="task-details" style={{ borderTop: "var(--nb-border)", padding: "10px 12px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", background: "hsl(var(--muted))" }}>
      <div>
        <label style={label} htmlFor={`${id}-due`}>Due</label>
        <input id={`${id}-due`} type="date" value={todo.dueDate ?? ""} onChange={(e) => onChange({ dueDate: e.target.value || undefined, ...(e.target.value ? {} : { dueTime: undefined, repeat: undefined }) })} style={field} />
      </div>
      <div>
        <label style={label} htmlFor={`${id}-time`}>Time · reminder</label>
        <input
          id={`${id}-time`}
          type="time"
          value={todo.dueTime ?? ""}
          onChange={(e) => onChange({ dueTime: e.target.value || undefined, ...(e.target.value && !todo.dueDate ? { dueDate: getDayKey() } : {}) })}
          style={field}
        />
      </div>
      <div>
        <span style={label}>Repeat</span>
        <RepeatPicker value={todo.repeat} onChange={(r) => onChange(withRepeat(todo, r))} />
      </div>
      <div>
        <label style={label} htmlFor={`${id}-pri`}>Priority</label>
        <select id={`${id}-pri`} value={todo.priority ?? ""} onChange={(e) => onChange({ priority: (e.target.value || undefined) as Todo["priority"] })} style={field}>
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
