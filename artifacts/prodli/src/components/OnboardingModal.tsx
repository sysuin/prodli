// Welcome: three steps to get going (plan your day, ask ProdLi, sync), instead
// of a grid of every section. Shown once (hasSeenOnboarding); everything else
// is one click away in Help & shortcuts.

import { useEffect, useRef, useState } from "react";
import { storageSet } from "../lib/storage";
import { accountsEnabled } from "../lib/prodliAccount";
import { SECTIONS, openSection } from "../sections/registry";
import { openAsk } from "../lib/ask";
import { Logo } from "./Logo";
import { openSettings } from "./Settings";

const EXT = typeof chrome !== "undefined" && !!chrome.runtime?.id;
const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

interface Step {
  emoji: string;
  accent: string;
  title: string;
  text: string;
  points: string[];
  action: { label: string; run: () => void };
}

function steps(): Step[] {
  const sync = accountsEnabled();
  return [
    {
      emoji: "☀️",
      accent: "#F59E0B",
      title: "Plan your day",
      text: "Today gives you a short daily brief from your to-dos, calendar and habits, and puts your tasks into the free time between meetings.",
      points: ["Pick one main focus", "Plan tasks for today and ⏱ block time for them", "Wrap up in the evening; a weekly review every Friday"],
      action: { label: "Open Today", run: () => openSection("today") },
    },
    {
      emoji: "✨",
      accent: "#A78BFA",
      title: "Ask ProdLi anything",
      text: `Ask about your day, notes and meetings — “What should I focus on now?”, “Summarize my last meeting”. Press ${mod}+K anywhere to go anywhere or add a to-do.`,
      points: [`${mod}+K: search & commands`, "Alt+Shift+A: add a to-do or note from any page" + (EXT ? "" : " (extension)"), "Alt+Shift+R: take notes in a Meet, Zoom or Teams call" + (EXT ? "" : " (extension)")],
      action: { label: "Ask ProdLi", run: () => openAsk() },
    },
    sync
      ? {
          emoji: "🔄",
          accent: "#00BCD4",
          title: "Sign in to sync (optional)",
          text: "ProdLi works offline and without an account. Sign in with Google to keep everything the same in the extension and at app.prodli.com — and for AI briefs, Ask ProdLi and meeting summaries.",
          points: ["What's on this device is added, nothing is overwritten", "Meeting audio stays on this device unless you transcribe it with AI", "Settings: your avatar, bottom left"],
          action: { label: "Sign in", run: () => openSettings("account") },
        }
      : {
          emoji: "🔒",
          accent: "#66BB6A",
          title: "Your data stays here",
          text: "Everything is saved in this browser. Back it up any time, or sync it through your own Google Drive.",
          points: ["Backups: your avatar → Backup & data", "Works offline", "Settings: your avatar, bottom left"],
          action: { label: "Open Settings", run: () => openSettings("account") },
        },
  ];
}

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const list = steps();
  const step = list[i];
  const last = i === list.length - 1;
  const primary = useRef<HTMLButtonElement>(null);

  const finish = async (then?: () => void) => {
    await storageSet("hasSeenOnboarding", true);
    onClose();
    then?.();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        void finish();
      } else if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, last]);

  useEffect(() => primary.current?.focus(), [i]);

  const btn = (kind: "primary" | "plain"): React.CSSProperties => ({
    background: kind === "primary" ? "#FFD700" : "hsl(var(--card))",
    color: kind === "primary" ? "#000" : "hsl(var(--foreground))",
    border: "var(--nb-border)",
    boxShadow: "3px 3px 0 #000",
    padding: "9px 18px",
    fontWeight: 900,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "8px 8px 0 #FFD700", width: "100%", maxWidth: 560, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>
        <div style={{ background: "#000", padding: "18px 24px", borderBottom: "var(--nb-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <Logo size={24} />
            <div id="welcome-title" style={{ color: "#fff", fontWeight: 900, fontSize: 20, marginTop: 10 }}>
              Welcome to ProdLi
            </div>
            <div style={{ color: "#bbb", fontSize: 12, fontWeight: 600, marginTop: 2 }}>Your personal assistant {EXT ? "in every new tab" : "and productivity tools in one place"}. Three things to know:</div>
          </div>
          <button onClick={() => void finish()} style={{ border: "2px solid #555", background: "transparent", color: "#ccc", padding: "4px 10px", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", alignSelf: "flex-start" }}>
            Skip
          </button>
        </div>

        <div style={{ padding: "22px 24px 8px" }} aria-live="polite" data-testid="welcome-step">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 30, width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: step.accent, border: "var(--nb-border)" }} aria-hidden>
              {step.emoji}
            </span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7 }}>
                Step {i + 1} of {list.length}
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{step.title}</h2>
            </div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 10px" }}>{step.text}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {step.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button style={{ ...btn("plain"), marginTop: 14, boxShadow: "none", textTransform: "none" }} onClick={() => void finish(step.action.run)}>
            {step.action.label} →
          </button>
        </div>

        <div style={{ padding: "16px 24px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }} role="tablist" aria-label="Steps">
            {list.map((s, n) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={n === i}
                aria-label={`Step ${n + 1}: ${s.title}`}
                onClick={() => setI(n)}
                style={{ width: n === i ? 26 : 12, height: 12, border: "2px solid hsl(var(--foreground))", background: n === i ? "#FFD700" : "transparent", cursor: "pointer", padding: 0, transition: "width 0.15s" }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {i > 0 && (
              <button style={btn("plain")} onClick={() => setI(i - 1)}>
                Back
              </button>
            )}
            <button ref={primary} style={btn("primary")} onClick={() => (last ? void finish() : setI(i + 1))}>
              {last ? "Get started →" : "Next →"}
            </button>
          </div>
        </div>
        <div style={{ padding: "0 24px 18px", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
          {SECTIONS.length} sections in the sidebar. Press <kbd style={{ border: "var(--nb-border)", padding: "0 5px", fontSize: 10, fontWeight: 900 }}>?</kbd> anytime for help and every shortcut.
        </div>
      </div>
    </div>
  );
}
