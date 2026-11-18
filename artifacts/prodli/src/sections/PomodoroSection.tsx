import { useEffect, useState } from "react";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import { formatTime, getDayKey } from "../lib/utils";
import type { Todo } from "../types";
import type { Phase, PomodoroSettings, PomodoroSession } from "../lib/usePomodoroTimer";
import { openSettings } from "../components/Settings";
import { FocusBlockPanel } from "./focus/FocusBlockPanel";

const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;

const PHASE_COLORS: Record<Phase, string> = {
  work: "#FFD700",
  "short-break": "#00BCD4",
  "long-break": "#66BB6A",
};

const PHASE_LABELS: Record<Phase, string> = {
  work: "FOCUS",
  "short-break": "SHORT BREAK",
  "long-break": "LONG BREAK",
};

function ProgressRing({ seconds, total, color }: { seconds: number; total: number; color: string }) {
  const radius = 120;
  const stroke = 8;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const progress = 1 - seconds / total;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <svg height={radius * 2} width={radius * 2} style={{ position: "absolute", top: 0, left: 0 }}>
      <circle
        stroke="hsl(var(--muted-foreground))"
        fill="transparent"
        strokeWidth={stroke}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
        opacity={0.3}
      />
      <circle
        className="ring-progress"
        stroke={color}
        fill="transparent"
        strokeWidth={stroke}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="square"
        r={normalizedRadius}
        cx={radius}
        cy={radius}
        style={{ transition: "stroke-dashoffset 1s linear", transform: "rotate(-90deg)", transformOrigin: `${radius}px ${radius}px` }}
      />
    </svg>
  );
}

export interface PomodoroSectionProps {
  settings: PomodoroSettings;
  sessions: PomodoroSession[];
  setSessions: (s: PomodoroSession[]) => void;
  phase: Phase;
  completedPomodoros: number;
  running: boolean;
  setRunning: (r: boolean) => void;
  taskLabel: string;
  setTaskLabel: (l: string) => void;
  loaded: boolean;
  secondsLeft: number;
  totalRef: React.MutableRefObject<number>;
  reset: () => void;
  skip: () => void;
  saveSettings: (s: PomodoroSettings) => Promise<void>;
  changePhase: (p: Phase) => void;
}

export function PomodoroSection({
  settings,
  sessions,
  setSessions,
  phase,
  completedPomodoros,
  running,
  setRunning,
  taskLabel,
  setTaskLabel,
  loaded,
  secondsLeft,
  totalRef,
  reset,
  skip,
  saveSettings,
  changePhase,
}: PomodoroSectionProps) {
  const [editingTask, setEditingTask] = useState(false);
  // Open to-dos, so the focus label can be one of them (today's first).
  const [todos, setTodos] = useState<Todo[]>([]);
  useEffect(() => {
    void storageGet<Todo[]>("todos", []).then(setTodos);
    return onStorageChange<Todo[]>("todos", (v) => setTodos(v ?? []));
  }, []);
  const today = getDayKey();
  const isToday = (t: Todo) => (!!t.plannedFor && t.plannedFor <= today) || (!!t.dueDate && t.dueDate <= today);
  const openTasks = todos.filter((t) => !t.completed).sort((a, b) => Number(isToday(b)) - Number(isToday(a)));
  const todaysTasks = openTasks.filter(isToday);

  const requestNotifications = () => {
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  };


  const phaseColor = PHASE_COLORS[phase];
  const total = totalRef.current;
  const sessionCount = sessions.length;

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>Pomodoro</div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* The extension notifies from the background; the web preview needs browser permission. */}
          {!(typeof chrome !== "undefined" && chrome.runtime?.id) && (
            <button
              onClick={requestNotifications}
              style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "4px 12px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 700, cursor: "pointer", fontSize: 11, textTransform: "uppercase", fontFamily: "inherit" }}
            >🔔 Notify</button>
          )}
          <button
            onClick={() => openSettings("pomodoro")}
            title="Focus and break lengths"
            style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "4px 12px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 700, cursor: "pointer", fontSize: 11, textTransform: "uppercase", fontFamily: "inherit" }}
          >⚙ Settings</button>
        </div>
      </div>

      {/* Main timer */}
      <div style={{ display: "flex", flex: 1, gap: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "safe center", padding: 32, gap: 24, overflowY: "auto", minHeight: 0 }}>
          {/* Phase tabs */}
          <div style={{ display: "flex", border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)" }}>
            {(["work", "short-break", "long-break"] as Phase[]).map(p => (
              <button
                key={p}
                onClick={() => changePhase(p)}
                style={{
                  border: "none", borderRight: p !== "long-break" ? "var(--nb-border)" : "none",
                  padding: "8px 16px", fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em",
                  background: phase === p ? PHASE_COLORS[p] : "hsl(var(--card))",
                  color: phase === p ? "#000" : "hsl(var(--foreground))", cursor: "pointer", fontFamily: "inherit",
                }}
              >{PHASE_LABELS[p]}</button>
            ))}
          </div>

          {/* Timer ring */}
          <div style={{ position: "relative", width: 240, height: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ProgressRing seconds={secondsLeft} total={Math.max(total, 1)} color={phaseColor} />
            <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: "-0.04em", fontFamily: "Space Mono, monospace" }}>
                {formatTime(secondsLeft)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--muted-foreground))" }}>
                {PHASE_LABELS[phase]}
              </div>
            </div>
          </div>

          {/* Task label: type, or pick one of today's to-dos */}
          <div style={{ width: "100%", maxWidth: 360, display: "flex", alignItems: "center", gap: 8 }}>
            <datalist id="pomodoro-tasks">
              {openTasks.slice(0, 50).map((t) => <option key={t.id} value={t.title} />)}
            </datalist>
            {editingTask ? (
              <input
                autoFocus
                value={taskLabel}
                onChange={e => setTaskLabel(e.target.value)}
                onBlur={() => setEditingTask(false)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingTask(false); }}
                placeholder="What are you working on?"
                list="pomodoro-tasks"
                aria-label="What are you working on?"
                style={{ flex: 1, border: "var(--nb-border)", padding: "8px 12px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
              />
            ) : (
              <div
                onClick={() => setEditingTask(true)}
                style={{
                  flex: 1, border: "2px dashed var(--nb-section-border)", padding: "8px 12px", cursor: "text",
                  fontSize: 13, fontWeight: 600, color: taskLabel ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                  minHeight: 38, display: "flex", alignItems: "center",
                }}
              >
                {taskLabel || "Click to set task label..."}
              </div>
            )}
          </div>
          {!taskLabel && todaysTasks.length > 0 && (
            <div role="group" aria-label="Today's tasks" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 420 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", alignSelf: "center" }}>Focus on:</span>
              {todaysTasks.slice(0, 3).map((t) => (
                <button key={t.id} onClick={() => setTaskLabel(t.title)} style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  ☀️ {t.title}
                </button>
              ))}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => setRunning(!running)}
              style={{
                border: "var(--nb-border)", boxShadow: "var(--nb-shadow)",
                padding: "12px 36px", background: running ? "hsl(var(--foreground))" : phaseColor,
                color: running ? phaseColor : "#000",
                fontWeight: 900, cursor: "pointer", fontSize: 16, textTransform: "uppercase",
                letterSpacing: "0.06em", fontFamily: "inherit", transition: "all 0.1s",
              }}
            >{running ? "⏸ PAUSE" : "▶ START"}</button>
            <button onClick={reset} style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "12px 20px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 800, cursor: "pointer", fontSize: 13, textTransform: "uppercase", fontFamily: "inherit" }}>↺ RESET</button>
            <button onClick={skip} style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "12px 20px", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 800, cursor: "pointer", fontSize: 13, textTransform: "uppercase", fontFamily: "inherit" }}>⏭ SKIP</button>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 16 }}>
            {[
              { label: "Today's Sessions", value: sessions.filter(s => new Date(s.completedAt).toDateString() === new Date().toDateString()).length },
              { label: "Total Sessions", value: sessionCount },
              { label: "Session #", value: (completedPomodoros % settings.longBreakAfter) + 1 + "/" + settings.longBreakAfter },
            ].map(stat => (
              <div key={stat.label} style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "8px 16px", background: "hsl(var(--card))", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{stat.value}</div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))" }}>{stat.label}</div>
              </div>
            ))}
          </div>
          {isExtension && <FocusBlockPanel focusRunning={running && phase === "work"} />}
        </div>

        {/* Session log */}
        <div style={{ width: 260, borderLeft: "var(--nb-border)", display: "flex", flexDirection: "column", background: "hsl(var(--muted))", flexShrink: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: "var(--nb-border)", fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Session Log
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {sessions.length === 0 ? (
              <div style={{ padding: 16, color: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 700 }}>No sessions yet. Start the timer!</div>
            ) : (
              sessions.map(s => (
                <div key={s.id} style={{ padding: "8px 16px", borderBottom: "1px solid var(--nb-section-border)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>{s.duration}m</span>
                    <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{new Date(s.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          {sessions.length > 0 && (
            <div style={{ borderTop: "var(--nb-border)", padding: "8px 16px" }}>
              <button
                onClick={() => { setSessions([]); storageSet("pomodoroSessions", []); }}
                style={{ border: "1px solid #C62828", background: "#C62828", color: "white", padding: "4px 12px", fontWeight: 700, cursor: "pointer", fontSize: 10, textTransform: "uppercase", fontFamily: "inherit" }}
              >Clear Log</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
