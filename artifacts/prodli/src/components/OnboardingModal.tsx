import { useEffect } from "react";
import { storageSet } from "../lib/storage";
import { accountsEnabled } from "../lib/prodliAccount";
import { SECTIONS } from "../sections/registry";
import { Logo } from "./Logo";

const EXT = typeof chrome !== "undefined" && !!chrome.runtime?.id;
const INTRO = accountsEnabled()
  ? `Your personal assistant and productivity tools${EXT ? ", in every new tab" : " in one place"}. Works without an account and offline — sign in with Google (👤 at the top) for AI briefs and reviews, Ask ProdLi, and sync between the extension and app.prodli.com.`
  : `Your productivity tools${EXT ? " in every new tab" : " in one place"}. Everything stays on your device — no account needed.`;

interface OnboardingModalProps {
  onClose: () => void;
}

// New sections appear here automatically (sections/registry.ts).
const FEATURES = [
  ...(accountsEnabled() ? [{ emoji: "✨", title: "Ask ProdLi", accent: "#A78BFA", desc: "Ask anything about your tasks, notes and meetings — “What should I focus on now?” Press Ctrl/⌘+K anywhere." }] : []),
  ...SECTIONS.map((s) => ({ emoji: s.emoji, title: s.label, accent: s.accent, desc: s.pitch })),
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
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to ProdLi"
      tabIndex={-1}
      autoFocus
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
        maxWidth: 760,
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
      }}>

        {/* Header */}
        <div style={{
          background: "#000",
          padding: "22px 28px",
          borderBottom: "var(--nb-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Logo size={24} />
            <span style={{ color: "#aaa", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{EXT ? "New Tab Extension" : "Web app"}</span>
          </div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            Your productivity hub is ready.
          </div>
          <div style={{ color: "#888", fontSize: 12, fontWeight: 600, marginTop: 6 }}>
            {INTRO}
          </div>
        </div>

        {/* Feature cards */}
        <div style={{ padding: "22px 28px 0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {FEATURES.map(f => (
            <div
              key={f.title}
              style={{
                border: "var(--nb-border)",
                padding: "12px 14px",
                background: "hsl(var(--card))",
                position: "relative",
                overflow: "hidden",
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
