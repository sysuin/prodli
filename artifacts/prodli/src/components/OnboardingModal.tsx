import { useEffect } from "react";
import { storageSet } from "../lib/storage";

interface OnboardingModalProps {
  onClose: () => void;
}

const FEATURES = [
  {
    emoji: "✍️",
    title: "Editor",
    accent: "#FFD700",
    desc: "Rich-text notes with font picker, fullscreen focus mode, and full-text search across title and body.",
  },
  {
    emoji: "✅",
    title: "To-Dos",
    accent: "#4ade80",
    desc: "Tasks with priority levels, due dates, and subtasks. Drag to reorder. Filter by status or priority.",
  },
  {
    emoji: "🍅",
    title: "Pomodoro",
    accent: "#f87171",
    desc: "Focus timer that keeps running even when you switch tabs. Get browser notifications on completion.",
  },
  {
    emoji: "🎯",
    title: "Habits",
    accent: "#60a5fa",
    desc: "Daily habit check-ins with automatic streak tracking and a visual heatmap calendar.",
  },
  {
    emoji: "⏱",
    title: "Time Tracker",
    accent: "#a78bfa",
    desc: "Automatically tracks time on every site you visit. Review today's usage, explore all-time history with charts, and set daily time limits per site — limits fire a notification and can optionally redirect you away when you've hit your cap.",
    wide: true,
  },
];

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const dismiss = async () => {
    await storageSet("hasSeenOnboarding", true);
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10001,
        background: "rgba(0,0,0,0.93)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{
        background: "hsl(var(--background))",
        border: "var(--nb-border)",
        boxShadow: "8px 8px 0 #FFD700",
        width: "100%",
        maxWidth: 720,
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          background: "#000",
          padding: "22px 28px",
          borderBottom: "var(--nb-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              background: "#FFD700", color: "#000", fontWeight: 900,
              fontSize: 13, padding: "2px 10px", letterSpacing: "0.02em",
            }}>ProdLi</span>
            <span style={{ color: "#555", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>New Tab Extension</span>
          </div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            Your productivity hub is ready.
          </div>
          <div style={{ color: "#888", fontSize: 12, fontWeight: 600, marginTop: 6 }}>
            Five tools, one new tab. Everything stays on your device — no account needed.
          </div>
        </div>

        {/* Feature cards */}
        <div style={{ padding: "22px 28px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {FEATURES.map(f => (
            <div
              key={f.title}
              style={{
                border: "var(--nb-border)",
                padding: "14px 16px",
                background: "hsl(var(--card))",
                position: "relative",
                overflow: "hidden",
                ...("wide" in f && f.wide ? { gridColumn: "1 / -1" } : {}),
              }}
            >
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: 3, background: f.accent,
              }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7, marginTop: 4 }}>
                <span style={{ fontSize: 18 }}>{f.emoji}</span>
                <span style={{ fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{f.title}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "18px 28px 22px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16,
        }}>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 600, lineHeight: 1.5 }}>
            Press <span style={{ border: "var(--nb-border)", padding: "0 5px", fontSize: 10, fontWeight: 900, fontFamily: "Space Mono, monospace" }}>?</span> anytime to open the full guide with all keyboard shortcuts.
          </div>
          <button
            onClick={dismiss}
            style={{
              flexShrink: 0,
              background: "#FFD700", color: "#000",
              border: "var(--nb-border)", boxShadow: "3px 3px 0 #000",
              padding: "10px 26px", fontWeight: 900, fontSize: 13,
              cursor: "pointer", fontFamily: "inherit",
              textTransform: "uppercase", letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "1px 1px 0 #000")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "3px 3px 0 #000")}
          >
            Get started →
          </button>
        </div>

      </div>
    </div>
  );
}
