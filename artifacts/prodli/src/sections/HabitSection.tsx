import { useState, useEffect } from "react";
import { storageGet, storageSet } from "../lib/storage";
import { generateId, getDayKey } from "../lib/utils";
import type { Habit } from "../types";

const EMOJI_OPTIONS = ["💪", "📚", "🧘", "🏃", "💧", "🥦", "✍️", "🎯", "🎨", "🎵", "🧹", "💊", "😴", "🌅", "🧠"];
const COLOR_OPTIONS = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FF8C94", "#A8E6CF", "#FFD3B6", "#D4A5A5", "#9B5DE5"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type HeatmapView = "week" | "month";

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

function HabitCard({ habit, onToggle, onDelete, onEdit }: {
  habit: Habit;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (habit: Habit) => void;
}) {
  const today = getDayKey();
  const completedToday = habit.completedDays.includes(today);
  const streak = calculateStreak(habit.completedDays);
  const [heatmapView, setHeatmapView] = useState<HeatmapView>("week");

  const weekProgress = (() => {
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return getDayKey(d);
    });
    const done = last7.filter(d => habit.completedDays.includes(d)).length;
    return { done, total: 7 };
  })();

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
              <span style={{ border: "2px solid #FF6B6B", background: "#FF6B6B", color: "white", fontSize: 10, fontWeight: 900, padding: "1px 6px", flexShrink: 0 }}>
                🔥 {streak}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))" }}>
              {weekProgress.done}/{weekProgress.total} this week
            </span>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>·</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
              {habit.completedDays.length} total check-ins
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onEdit(habit)}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", width: 26, height: 26, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Edit"
          >✎</button>
          <button
            onClick={() => onDelete(habit.id)}
            style={{ border: "1px solid hsl(var(--muted-foreground))", background: "hsl(var(--muted))", width: 26, height: 26, cursor: "pointer", fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff4444" }}
            title="Archive"
          >⊘</button>
          <button
            onClick={() => onToggle(habit.id)}
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
        </div>
      </div>

      {/* Heatmap area */}
      <div style={{ padding: "10px 14px" }}>
        {/* View toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 10, border: "var(--nb-border)", width: "fit-content" }}>
          {(["week", "month"] as HeatmapView[]).map(v => (
            <button
              key={v}
              onClick={() => setHeatmapView(v)}
              style={{
                border: "none", borderRight: v === "week" ? "var(--nb-border)" : "none",
                padding: "3px 10px", fontWeight: 800, fontSize: 9, textTransform: "uppercase",
                background: heatmapView === v ? "hsl(var(--foreground))" : "hsl(var(--card))",
                color: heatmapView === v ? "#FFD700" : "hsl(var(--foreground))",
                cursor: "pointer", letterSpacing: "0.06em", fontFamily: "inherit",
              }}
            >{v === "week" ? "5-Week" : "Monthly"}</button>
          ))}
        </div>

        {heatmapView === "week" ? (
          <WeekStrip completedDays={habit.completedDays} />
        ) : (
          <MonthlyHeatmap completedDays={habit.completedDays} color={habit.color} />
        )}
      </div>
    </div>
  );
}

function calculateStreak(completedDays: string[]): number {
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

interface HabitFormProps {
  initial?: Partial<Habit>;
  onSave: (name: string, emoji: string, color: string) => void;
  onCancel: () => void;
}
function HabitForm({ initial, onSave, onCancel }: HabitFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "💪");
  const [color, setColor] = useState(initial?.color ?? COLOR_OPTIONS[0]);

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
        onKeyDown={e => { if (e.key === "Enter" && name.trim()) onSave(name.trim(), emoji, color); }}
      />
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
          onClick={() => name.trim() && onSave(name.trim(), emoji, color)}
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
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    storageGet<Habit[]>("habits", []).then(h => { setHabits(h); setLoaded(true); });
  }, []);

  const save = (updated: Habit[]) => { setHabits(updated); storageSet("habits", updated); };

  const addHabit = (name: string, emoji: string, color: string) => {
    const habit: Habit = {
      id: generateId(),
      name,
      emoji,
      color,
      completedDays: [],
      createdAt: new Date().toISOString(),
      archived: false,
    };
    save([...habits, habit]);
    setShowForm(false);
  };

  const editHabit = (name: string, emoji: string, color: string) => {
    if (!editingHabit) return;
    save(habits.map(h => h.id === editingHabit.id ? { ...h, name, emoji, color } : h));
    setEditingHabit(null);
  };

  const toggle = (id: string) => {
    const today = getDayKey();
    save(habits.map(h => {
      if (h.id !== id) return h;
      const done = h.completedDays.includes(today);
      return { ...h, completedDays: done ? h.completedDays.filter(d => d !== today) : [...h.completedDays, today] };
    }));
  };

  const archive = (id: string) => {
    save(habits.map(h => h.id === id ? { ...h, archived: true } : h));
  };

  const unarchive = (id: string) => {
    save(habits.map(h => h.id === id ? { ...h, archived: false } : h));
  };

  const today = getDayKey();
  const activeHabits = habits.filter(h => !h.archived);
  const archivedHabits = habits.filter(h => h.archived);
  const completedToday = activeHabits.filter(h => h.completedDays.includes(today)).length;
  const completionPct = activeHabits.length > 0 ? Math.round((completedToday / activeHabits.length) * 100) : 0;

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
              {completedToday}/{activeHabits.length} done today
              <span style={{
                display: "inline-block", marginLeft: 10, background: "hsl(var(--foreground))", color: "#FFD700",
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
