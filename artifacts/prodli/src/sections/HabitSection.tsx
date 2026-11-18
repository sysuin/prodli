import { useState, useEffect } from "react";
import { storageSet } from "../lib/storage";
import { useSyncedList } from "../lib/syncedList";
import { generateId, getDayKey } from "../lib/utils";
import type { Habit } from "../types";
import { addAmount, amountOn, bestStreak, currentStreak, dayLevel, isDone, isScheduled, kindOf, progressLabel, setAmount, targetOf, toggleCheck, toggleSkip } from "../lib/habits";

const EMOJI_OPTIONS = ["💪", "📚", "🧘", "🏃", "💧", "🥦", "✍️", "🎯", "🎨", "🎵", "🧹", "💊", "😴", "🌅", "🧠"];
const COLOR_OPTIONS = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FF8C94", "#A8E6CF", "#FFD3B6", "#D4A5A5", "#9B5DE5"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type HeatmapView = "week" | "month" | "year";

/** The last 53 weeks, one square per day, shaded by how much of the target was reached. */
function YearHeatmap({ habit }: { habit: Habit }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 364 - start.getDay()); // a Sunday, 53 weeks back
  const weeks: Date[][] = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(new Date(d));
  }
  const done = weeks.flat().filter((d) => isDone(habit, getDayKey(d)) && isScheduled(habit, getDayKey(d))).length;
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>Past year · {done} days</div>
      <div role="img" aria-label={`${habit.name}: done on ${done} days in the past year`} style={{ display: "flex", gap: 2, overflowX: "auto" }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ display: "grid", gridTemplateRows: "repeat(7, 9px)", gap: 2 }}>
            {w.map((d) => {
              const key = getDayKey(d);
              const level = isScheduled(habit, key) ? dayLevel(habit, key) : 0;
              return <div key={key} title={`${key}: ${progressLabel(habit, key)}`} style={{ width: 9, height: 9, background: level ? habit.color : "hsl(var(--muted))", opacity: level ? 0.35 + 0.65 * level : 1, border: "1px solid var(--nb-section-border)" }} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyHeatmap({ completedDays, color }: { completedDays: string[]; color: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = MONTHS[month];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = getDayKey();

  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>
        {monthName} {year}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{ fontSize: 9, fontWeight: 800, textAlign: "center", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />;
          const dayKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const done = completedDays.includes(dayKey);
          const isToday = dayKey === todayStr;
          const isFuture = new Date(year, month, day) > now;
          return (
            <div
              key={dayKey}
              title={dayKey}
              style={{
                height: 20,
                background: done ? color : "hsl(var(--muted))",
                border: isToday ? "var(--nb-border)" : "1px solid transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: done ? 800 : 400,
                color: done ? "#000" : "hsl(var(--muted-foreground))",
                opacity: isFuture ? 0.3 : 1,
              }}
            >{day}</div>
          );
        })}
      </div>
    </div>
  );
}

function WeekStrip({ completedDays }: { completedDays: string[] }) {
  const days = Array.from({ length: 35 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (34 - i));
    return getDayKey(d);
  });
  const todayStr = getDayKey();

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(35, 1fr)", gap: 2 }}>
        {days.map(day => (
          <div
            key={day}
            title={day}
            style={{
              height: 14,
              border: day === todayStr ? "var(--nb-border)" : "1px solid var(--nb-section-border)",
              background: completedDays.includes(day) ? "hsl(var(--foreground))" : "transparent",
              opacity: completedDays.includes(day) ? 1 : 0.3,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>5 weeks ago</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>today</span>
      </div>
    </div>
  );
}

/** Text for screen readers only. */
const SR_ONLY: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

/** The last 7 days as buttons, so a forgotten check-in can be added (or removed) later. */
function LastWeek({ habit, onToggle, onSetAmount }: { habit: Habit; onToggle: (id: string, day: string) => void; onSetAmount: (id: string, day: string, amount: number) => void }) {
  const k = kindOf(habit);
  const pick = (key: string, label: string) => {
    if (k === "check") return onToggle(habit.id, key);
    const what = k === "timed" ? "minutes" : k === "quit" ? "slips" : habit.unit || "times";
    const v = window.prompt(`${habit.name} on ${label}: how many ${what}?`, String(amountOn(habit, key)));
    if (v !== null && v.trim() !== "" && !Number.isNaN(Number(v))) onSetAmount(habit.id, key, Number(v));
  };
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const today = getDayKey();
  return (
    <div role="group" aria-label={`Last 7 days of ${habit.name}`} style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {days.map((d) => {
        const key = getDayKey(d);
        const done = isDone(habit, key) && isScheduled(habit, key);
        const off = !isScheduled(habit, key);
        const name = d.toLocaleDateString("en-US", { weekday: "short" });
        return (
          <button
            key={key}
            onClick={() => pick(key, d.toLocaleDateString([], { weekday: "long" }))}
            aria-pressed={k === "check" ? done : undefined}
            title={key === today ? "Today" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
            style={{ flex: 1, minWidth: 0, border: key === today ? "var(--nb-border)" : "1px solid var(--nb-section-border)", background: done ? habit.color : "transparent", color: done ? "#000" : "hsl(var(--foreground))", cursor: "pointer", padding: "3px 0", fontFamily: "inherit", lineHeight: 1.2 }}
          >
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", opacity: 0.8 }}>{name.slice(0, 2)}</div>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: off ? 0.4 : 1 }}>{off ? "–" : k === "check" ? (done ? "✓" : d.getDate()) : k === "quit" ? (done ? "✓" : "✗") : amountOn(habit, key) || d.getDate()}</div>
            <span style={SR_ONLY}> {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, {habit.name}: {off ? "not scheduled" : progressLabel(habit, key)}</span>
          </button>
        );
      })}
    </div>
  );
}

function HabitCard({ habit, onToggle, onDelete, onEdit, onAmount, onSetAmount, onSkip }: {
  habit: Habit;
  onToggle: (id: string, day?: string) => void;
  onDelete: (id: string) => void;
  onEdit: (habit: Habit) => void;
  onAmount: (id: string, delta: number) => void;
  onSetAmount: (id: string, day: string, amount: number) => void;
  onSkip: (id: string) => void;
}) {
  const today = getDayKey();
  const kind = kindOf(habit);
  const scheduledToday = isScheduled(habit, today);
  const skippedToday = !!habit.skipped?.includes(today);
  const completedToday = scheduledToday && isDone(habit, today);
  const streak = currentStreak(habit, today);
  const best = bestStreak(habit, today);
  const [heatmapView, setHeatmapView] = useState<HeatmapView>("week");

  const weekProgress = (() => {
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return getDayKey(d);
    }).filter((d) => isScheduled(habit, d));
    const done = last7.filter((d) => isDone(habit, d)).length;
    return { done, total: last7.length };
  })();
  const smallBtn: React.CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", minWidth: 30, height: 30, cursor: "pointer", fontSize: 13, fontWeight: 900, fontFamily: "inherit", padding: "0 6px" };

  if (habit.archived) return null;

  return (
    <div style={{
      border: "var(--nb-border)",
      boxShadow: "var(--nb-shadow)",
      background: completedToday ? `${habit.color}33` : "hsl(var(--card))",
      marginBottom: 12,
      transition: "background 0.2s",
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "var(--nb-border)" }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>{habit.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {habit.name}
            {streak > 1 && (
              <span style={{ border: "2px solid #C62828", background: "#C62828", color: "white", fontSize: 10, fontWeight: 900, padding: "1px 6px", flexShrink: 0 }}>
                {kind === "quit" ? `🛡 ${streak} days kept` : `🔥 ${streak}`}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))" }}>
              {weekProgress.done}/{weekProgress.total} this week
            </span>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>·</span>
            <span data-testid="habit-progress" style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
              {!scheduledToday ? (skippedToday ? "skipped today" : "not due today") : kind === "check" ? `${habit.completedDays.length} total check-ins` : `today: ${progressLabel(habit, today)}`}
            </span>
            {best > 1 && (
              <>
                <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>·</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>best streak {best}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onEdit(habit)}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", width: 26, height: 26, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Edit" aria-label={`Edit habit: ${habit.name}`}
          >✎</button>
          <button
            onClick={() => onDelete(habit.id)}
            style={{ border: "1px solid hsl(var(--muted-foreground))", background: "hsl(var(--muted))", width: 26, height: 26, cursor: "pointer", fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", color: "#C62828" }}
            title="Archive" aria-label={`Archive habit: ${habit.name}`}
          >⊘</button>
          {scheduledToday && kind !== "check" && (
            <span role="group" aria-label={`Log ${habit.name}`} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {kind === "quit" ? (
                <>
                  {amountOn(habit, today) > 0 && <button style={smallBtn} onClick={() => onAmount(habit.id, -1)} aria-label={`− Undo a slip: ${habit.name}`} title="Undo a slip">−</button>}
                  <button style={{ ...smallBtn, background: amountOn(habit, today) > targetOf(habit) ? "#C62828" : "hsl(var(--card))", color: amountOn(habit, today) > targetOf(habit) ? "#fff" : "hsl(var(--foreground))" }} onClick={() => onAmount(habit.id, 1)} aria-label={`${targetOf(habit) === 0 ? "Slipped" : "+1"}: ${habit.name}`}>
                    {targetOf(habit) === 0 ? "Slipped" : "+1"}
                  </button>
                </>
              ) : (
                <>
                  <button style={smallBtn} onClick={() => onAmount(habit.id, kind === "timed" ? -5 : -1)} disabled={!amountOn(habit, today)} aria-label={`− ${kind === "timed" ? "5 minutes" : "1"}: ${habit.name}`}>−</button>
                  <button style={{ ...smallBtn, background: completedToday ? habit.color : "hsl(var(--card))", color: completedToday ? "#000" : "hsl(var(--foreground))" }} onClick={() => onAmount(habit.id, kind === "timed" ? 5 : 1)} aria-label={`${kind === "timed" ? "+5m" : "+1"}: ${habit.name}`}>
                    {kind === "timed" ? "+5m" : "+1"}
                  </button>
                </>
              )}
            </span>
          )}
          {(scheduledToday || skippedToday) && !completedToday && kind !== "quit" && (
            <button style={{ ...smallBtn, fontSize: 10, textTransform: "uppercase" }} onClick={() => onSkip(habit.id)} aria-pressed={skippedToday} aria-label={`${skippedToday ? "Unskip" : "Skip"} today: ${habit.name}`} title="Skip today without breaking the streak">
              {skippedToday ? "Unskip" : "Skip"}
            </button>
          )}
          {kind === "check" && scheduledToday && (
          <button
            onClick={() => onToggle(habit.id)}
            aria-pressed={completedToday}
            aria-label={`${completedToday ? "Unmark" : "Mark"} today: ${habit.name}`}
            style={{
              border: "var(--nb-border)",
              boxShadow: completedToday ? "none" : "var(--nb-shadow-sm)",
              width: 42,
              height: 42,
              cursor: "pointer",
              background: completedToday ? habit.color : "hsl(var(--card))",
              color: completedToday ? "#000" : "hsl(var(--foreground))",
              fontSize: completedToday ? 20 : 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: completedToday ? "translate(2px, 2px)" : "none",
              transition: "all 0.15s",
              fontWeight: 900,
            }}
            title={completedToday ? "Unmark today" : "Mark today done"}
          >
            {completedToday ? "✓" : "○"}
          </button>
          )}
        </div>
      </div>

      {/* Heatmap area */}
      <div style={{ padding: "10px 14px" }}>
        <LastWeek habit={habit} onToggle={onToggle} onSetAmount={onSetAmount} />
        {/* View toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 10, border: "var(--nb-border)", width: "fit-content" }}>
          {(["week", "month", "year"] as HeatmapView[]).map(v => (
            <button
              key={v}
              onClick={() => setHeatmapView(v)}
              style={{
                border: "none", borderRight: v !== "year" ? "var(--nb-border)" : "none",
                padding: "3px 10px", fontWeight: 800, fontSize: 9, textTransform: "uppercase",
                background: heatmapView === v ? "#000" : "hsl(var(--card))",
                color: heatmapView === v ? "#FFD700" : "hsl(var(--foreground))",
                cursor: "pointer", letterSpacing: "0.06em", fontFamily: "inherit",
              }}
            >{v === "week" ? "5-Week" : v === "month" ? "Monthly" : "Year"}</button>
          ))}
        </div>

        {heatmapView === "week" ? (
          <WeekStrip completedDays={doneDays(habit)} />
        ) : heatmapView === "month" ? (
          <MonthlyHeatmap completedDays={doneDays(habit)} color={habit.color} />
        ) : (
          <YearHeatmap habit={habit} />
        )}
      </div>
    </div>
  );
}

/** Days done (or kept) in the last year, for the week and month views. */
function doneDays(h: Habit): string[] {
  if (kindOf(h) === "check") return h.completedDays;
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 400; i++, d.setDate(d.getDate() - 1)) {
    const key = getDayKey(d);
    if (isScheduled(h, key) && isDone(h, key)) out.push(key);
  }
  return out;
}

/** Longest run of consecutive days ever. */
export function calculateBestStreak(completedDays: string[]): number {
  const days = [...new Set(completedDays)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function calculateStreak(completedDays: string[]): number {
  if (!completedDays.length) return 0;
  const sorted = [...completedDays].sort().reverse();
  let streak = 0;
  let current = new Date();
  for (let i = 0; i < 365; i++) {
    const key = getDayKey(current);
    if (sorted.includes(key)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else if (i === 0 && key !== sorted[0]) {
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export type HabitFields = Pick<Habit, "name" | "emoji" | "color" | "kind" | "target" | "unit" | "days">;
interface HabitFormProps {
  initial?: Partial<Habit>;
  onSave: (fields: HabitFields) => void;
  onCancel: () => void;
}
const KINDS: { id: NonNullable<Habit["kind"]>; label: string; hint: string }[] = [
  { id: "check", label: "Check off", hint: "Done or not, once a day" },
  { id: "count", label: "Count", hint: "e.g. 8 glasses of water" },
  { id: "timed", label: "Timed", hint: "e.g. 20 minutes of reading" },
  { id: "quit", label: "Quit / limit", hint: "e.g. no smoking, or at most 2 coffees" },
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function HabitForm({ initial, onSave, onCancel }: HabitFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "💪");
  const [color, setColor] = useState(initial?.color ?? COLOR_OPTIONS[0]);
  const [kind, setKind] = useState<NonNullable<Habit["kind"]>>(initial?.kind ?? "check");
  const [target, setTarget] = useState<number>(initial?.target ?? 1);
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [days, setDays] = useState<number[]>(initial?.days?.length ? initial.days : [0, 1, 2, 3, 4, 5, 6]);
  const submit = () => {
    if (!name.trim()) return;
    const t = kind === "check" ? undefined : kind === "quit" ? Math.max(0, Math.round(target)) : Math.max(1, Math.round(target));
    onSave({ name: name.trim(), emoji, color, kind: kind === "check" ? undefined : kind, target: t, unit: kind === "count" && unit.trim() ? unit.trim().slice(0, 20) : undefined, days: days.length && days.length < 7 ? days : undefined });
  };
  const pickKind = (k: NonNullable<Habit["kind"]>) => {
    setKind(k);
    setTarget(k === "count" ? Math.max(target, 2) : k === "timed" ? Math.max(target, 15) : k === "quit" ? 0 : 1);
  };
  const fieldStyle: React.CSSProperties = { border: "var(--nb-border)", padding: "6px 8px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };

  return (
    <div style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 16, background: "hsl(var(--muted))", marginBottom: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.06em" }}>
        {initial?.id ? "Edit Habit" : "New Habit"}
      </div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Habit name..."
        style={{ border: "var(--nb-border)", padding: "8px 12px", width: "100%", marginBottom: 10, fontFamily: "inherit", fontSize: 14, fontWeight: 600, boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
      />
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>Type</div>
        <div role="radiogroup" aria-label="Habit type" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={kind === k.id} title={k.hint} onClick={() => pickKind(k.id)} style={{ ...fieldStyle, fontWeight: 800, fontSize: 12, cursor: "pointer", background: kind === k.id ? "#FFD700" : "hsl(var(--card))", color: kind === k.id ? "#000" : "hsl(var(--foreground))" }}>
              {k.label}
            </button>
          ))}
        </div>
        {kind !== "check" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap", fontSize: 13, fontWeight: 600 }}>
            <label htmlFor="habit-target">{kind === "count" ? "Times a day" : kind === "timed" ? "Minutes a day" : "At most, per day"}</label>
            <input id="habit-target" type="number" min={kind === "quit" ? 0 : 1} max={1440} value={target} onChange={(e) => setTarget(Number(e.target.value))} style={{ ...fieldStyle, width: 70 }} />
            {kind === "count" && <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit, e.g. glasses" aria-label="Unit" style={{ ...fieldStyle, width: 140 }} />}
            {kind === "quit" && <span style={{ fontSize: 12, opacity: 0.8 }}>{target === 0 ? "None allowed. Log a slip if it happens." : `Up to ${target} a day is fine.`}</span>}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>Days</div>
        <div role="group" aria-label="Days" style={{ display: "inline-flex" }}>
          {DAYS.map((d, i) => {
            const on = days.includes(i);
            return (
              <button key={d} aria-pressed={on} aria-label={DAY_NAMES[i]} onClick={() => setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort()))} style={{ width: 32, height: 28, border: "var(--nb-border)", marginLeft: i ? -2 : 0, background: on ? "hsl(var(--foreground))" : "hsl(var(--card))", color: on ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                {d}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>Days off never break your streak.</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>Icon</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              style={{
                border: emoji === e ? "var(--nb-border)" : "1px solid var(--nb-section-border)",
                background: emoji === e ? "#FFD700" : "hsl(var(--card))",
                boxShadow: emoji === e ? "var(--nb-shadow-sm)" : "none",
                width: 34, height: 34, cursor: "pointer", fontSize: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >{e}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>Color</div>
        <div style={{ display: "flex", gap: 6 }}>
          {COLOR_OPTIONS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 28, height: 28, background: c, border: color === c ? "3px solid var(--nb-section-border)" : "1px solid var(--nb-section-border)",
                boxShadow: color === c ? "var(--nb-shadow-sm)" : "none", cursor: "pointer",
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={submit}
          style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "8px 20px", background: "#FFD700", fontWeight: 800, cursor: "pointer", fontSize: 12, textTransform: "uppercase", fontFamily: "inherit", color: "#000" }}
        >Save</button>
        <button
          onClick={onCancel}
          style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "8px 20px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 800, cursor: "pointer", fontSize: 12, textTransform: "uppercase", fontFamily: "inherit" }}
        >Cancel</button>
      </div>
    </div>
  );
}

export function HabitSection() {
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Synced across ProdLi tabs: edits in one tab never overwrite another's.
  const { items: habits, setItems: save, loaded } = useSyncedList<Habit>("habits");

  const addHabit = (f: HabitFields) => {
    const habit: Habit = {
      id: generateId(),
      ...f,
      completedDays: [],
      createdAt: new Date().toISOString(),
      archived: false,
    };
    save([...habits, habit]);
    setShowForm(false);
  };

  const editHabit = (f: HabitFields) => {
    if (!editingHabit) return;
    save(habits.map(h => h.id === editingHabit.id ? { ...h, ...f } : h));
    setEditingHabit(null);
  };

  const update = (id: string, fn: (h: Habit) => Habit) => save(habits.map((h) => (h.id === id ? fn(h) : h)));
  const toggle = (id: string, day = getDayKey()) => update(id, (h) => toggleCheck(h, day));
  const amount = (id: string, delta: number) => update(id, (h) => addAmount(h, getDayKey(), delta));
  const setDayAmount = (id: string, day: string, value: number) => update(id, (h) => setAmount(h, day, value));
  const skip = (id: string) => update(id, (h) => toggleSkip(h, getDayKey()));

  const archive = (id: string) => {
    save(habits.map(h => h.id === id ? { ...h, archived: true } : h));
  };

  const unarchive = (id: string) => {
    save(habits.map(h => h.id === id ? { ...h, archived: false } : h));
  };

  const today = getDayKey();
  const activeHabits = habits.filter(h => !h.archived);
  const archivedHabits = habits.filter(h => h.archived);
  const dueToday = activeHabits.filter((h) => isScheduled(h, today));
  const completedToday = dueToday.filter((h) => isDone(h, today)).length;
  const completionPct = dueToday.length > 0 ? Math.round((completedToday / dueToday.length) * 100) : 0;

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
            Habit Tracker
          </div>
          {activeHabits.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: "hsl(var(--muted-foreground))" }}>
              {completedToday}/{dueToday.length} done today
              <span style={{
                display: "inline-block", marginLeft: 10, background: "#000", color: "#FFD700",
                padding: "1px 8px", fontSize: 11, fontWeight: 900,
              }}>{completionPct}%</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingHabit(null); }}
          style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "8px 18px", background: "#FFD700", fontWeight: 900, cursor: "pointer", fontSize: 13, textTransform: "uppercase", fontFamily: "inherit", letterSpacing: "0.06em", color: "#000" }}
        >+ New Habit</button>
      </div>

      {/* Progress bar */}
      {activeHabits.length > 0 && (
        <div style={{ padding: "0 24px", borderBottom: "var(--nb-border)" }}>
          <div style={{ height: 8, border: "var(--nb-border)", background: "hsl(var(--muted))", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, width: `${completionPct}%`, background: "#FFD700", transition: "width 0.5s ease" }} />
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
        {(showForm && !editingHabit) && (
          <HabitForm onSave={addHabit} onCancel={() => setShowForm(false)} />
        )}
        {editingHabit && (
          <HabitForm initial={editingHabit} onSave={editHabit} onCancel={() => setEditingHabit(null)} />
        )}

        {activeHabits.length === 0 && !showForm ? (
          <div style={{ textAlign: "center", padding: 48, color: "hsl(var(--muted-foreground))" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
            <div style={{ fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              No habits yet. Create your first one!
            </div>
          </div>
        ) : (
          activeHabits.map(habit => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggle={toggle}
              onDelete={archive}
              onEdit={h => { setEditingHabit(h); setShowForm(false); }}
              onAmount={amount}
              onSetAmount={setDayAmount}
              onSkip={skip}
            />
          ))
        )}

        {archivedHabits.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{ border: "var(--nb-border)", padding: "6px 14px", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", fontWeight: 700, cursor: "pointer", fontSize: 11, textTransform: "uppercase", fontFamily: "inherit", marginBottom: 8 }}
            >{showArchived ? "▲ Hide" : "▼ Show"} Archived ({archivedHabits.length})</button>
            {showArchived && archivedHabits.map(habit => (
              <div key={habit.id} style={{ border: "var(--nb-border)", padding: "8px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", background: "hsl(var(--muted))" }}>
                <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.6, textDecoration: "line-through" }}>{habit.emoji} {habit.name}</span>
                <button
                  onClick={() => unarchive(habit.id)}
                  style={{ border: "var(--nb-border)", padding: "3px 10px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 700, cursor: "pointer", fontSize: 10, textTransform: "uppercase", fontFamily: "inherit" }}
                >Restore</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
