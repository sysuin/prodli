const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

const FEATURES = [
  {
    emoji: "✍️",
    title: "Editor",
    accent: "#FFD700",
    desc: "Rich notes with checklists, tables and a “/” command menu. Paste Markdown, pin notes, export to .md or PDF.",
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
    desc: "Focus timer that keeps running across tabs — even with ProdLi closed — with a notification when time is up.",
  },
  {
    emoji: "🎯",
    title: "Habits",
    accent: "#60a5fa",
    desc: "Daily habit check-ins with automatic streak tracking and a visual heatmap calendar.",
  },
  {
    emoji: "🎙️",
    title: "Meetings",
    accent: "#FF4FA3",
    desc: "AI notes for Google Meet — no bot joins your call. Transcript, summary and action items that land in your to-dos.",
  },
  {
    emoji: "📄",
    title: "Files",
    accent: "#FF9800",
    desc: "Drop a .md, .json, .csv or text file to preview it beautifully, then save it as a note.",
  },
  {
    emoji: "⏱",
    title: "Time Tracker",
    accent: "#a78bfa",
    desc: "Automatically tracks time on every site you visit. Review usage, explore all-time history with charts, and set daily limits per site.",
    wide: true,
  },
];

const STEPS = [
  { n: "01", title: "Install the extension", desc: "Click 'Add to Chrome' — it takes under 5 seconds." },
  { n: "02", title: "Open a new tab", desc: "ProdLi replaces your new tab instantly. No setup screens." },
  { n: "03", title: "Start working", desc: "Write a note, add a task, start a timer — everything is one click away." },
];

export function Landing() {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── NAV ──────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        borderBottom: "var(--border)", background: "#000",
        padding: "0 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            background: "var(--yellow)", color: "#000", fontWeight: 900,
            fontSize: 14, padding: "3px 12px", letterSpacing: "0.02em",
          }}>ProdLi</span>
          <span className="nav-subtitle">New Tab Extension</span>
        </div>
        <div className="nav-links">
          <a href="#features" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Features
          </a>
          <a href="/privacy" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Privacy
          </a>
          <a
            href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
            className="nb-btn" style={{ fontSize: 11, padding: "8px 20px" }}
          >
            Add to Chrome →
          </a>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="site-hero" style={{
        borderBottom: "var(--border)",
        padding: "80px 40px 72px",
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center",
        background: "repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(0,0,0,0.018) 20px, rgba(0,0,0,0.018) 40px)",
      }}>
        <div style={{
          border: "var(--border)", background: "var(--yellow)", color: "#000",
          fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em",
          padding: "4px 14px", marginBottom: 32, display: "inline-block",
          boxShadow: "var(--shadow-sm)",
        }}>
          Free Chrome Extension
        </div>

        <h1 style={{
          fontWeight: 900, fontSize: "clamp(36px, 6vw, 68px)",
          lineHeight: 1.05, letterSpacing: "-0.03em",
          maxWidth: 780, marginBottom: 24,
        }}>
          Your browser's new tab,<br />finally doing something.
        </h1>

        <p style={{
          fontSize: "clamp(14px, 2vw, 18px)", fontWeight: 500,
          color: "#5a3e20", maxWidth: 560, lineHeight: 1.65, marginBottom: 40,
        }}>
          Seven productivity tools in one place — notes, to-dos, Pomodoro, habits, time tracking, AI meeting notes and a file previewer. No account needed. Your data stays on your device.
        </p>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 14, padding: "16px 36px" }}>
              Add to Chrome — it's free →
            </a>
            <a href="/extension" className="nb-btn nb-btn-ghost" style={{ fontSize: 14, padding: "16px 28px" }}>
              Try it live ↗
            </a>
            <a href="#features" className="nb-btn nb-btn-ghost" style={{ fontSize: 14, padding: "16px 28px" }}>
              See all features
            </a>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
            Try it live — no install required
          </span>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 48, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            ["100%", "Local storage"],
            ["0", "Accounts required"],
            ["7", "Tools in one tab"],
          ].map(([val, lbl]) => (
            <div key={lbl} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 28, color: "#000" }}>{val}</div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)", marginTop: 2 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section id="features" className="site-section" style={{ padding: "72px 40px", borderBottom: "var(--border)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div className="section-label" style={{ marginBottom: 12 }}>Everything you need</div>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", marginBottom: 40, maxWidth: 480 }}>
            Seven tools. One new tab.
          </h2>

          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="nb-card"
                style={{
                  padding: "22px 24px",
                  boxShadow: "var(--shadow)",
                  ...("wide" in f && f.wide ? { gridColumn: "1 / -1" } : {}),
                }}
              >
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  height: 4, background: f.accent,
                }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 22 }}>{f.emoji}</span>
                  <span style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>{f.title}</span>
                </div>
                <p style={{ fontSize: 13, color: "#5a3e20", lineHeight: 1.65 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="site-section" style={{ padding: "72px 40px", borderBottom: "var(--border)", background: "#000" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div className="section-label" style={{ marginBottom: 12, color: "#555" }}>Zero friction</div>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", marginBottom: 48, color: "#fff" }}>
            Up and running in 10 seconds.
          </h2>

          <div className="steps-grid">
            {STEPS.map((step) => (
              <div key={step.n} style={{
                border: "2px solid #333",
                padding: "28px 24px",
                background: "#111",
                position: "relative",
              }}>
                <div style={{
                  fontFamily: "var(--mono)", fontWeight: 700, fontSize: 40,
                  color: "var(--yellow)", lineHeight: 1, marginBottom: 16,
                }}>
                  {step.n}
                </div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {step.title}
                </div>
                <p style={{ fontSize: 13, color: "#888", lineHeight: 1.65 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRIVACY STRIP ────────────────────────────────────────────────── */}
      <section className="site-section" style={{
        padding: "72px 40px", borderBottom: "var(--border)",
        background: "var(--yellow)",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontFamily: "var(--mono)", fontWeight: 700, fontSize: 11,
            textTransform: "uppercase", letterSpacing: "0.15em",
            color: "#5a3e00", marginBottom: 16,
          }}>
            Privacy first
          </div>
          <h2 style={{
            fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)",
            letterSpacing: "-0.02em", marginBottom: 20, color: "#000",
          }}>
            Everything stays on your device.
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: "#3a2a00", maxWidth: 560, margin: "0 auto 36px" }}>
            Your notes, tasks, habits and browsing history stay in your browser. No ProdLi servers, no analytics, no tracking. Optional extras are yours to control: AI meeting summaries use your own Claude API key, and Google Drive backup goes to your own Drive.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            {["No account needed", "No ProdLi servers", "No analytics", "Works offline"].map((item) => (
              <span key={item} style={{
                border: "2px solid #000", padding: "6px 16px",
                fontWeight: 800, fontSize: 11, textTransform: "uppercase",
                letterSpacing: "0.08em", background: "#000", color: "var(--yellow)",
              }}>
                ✓ {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="site-section" style={{ padding: "80px 40px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.02em", marginBottom: 16 }}>
            Ready to reclaim your new tab?
          </h2>
          <p style={{ fontSize: 15, color: "#5a3e20", marginBottom: 40, lineHeight: 1.65 }}>
            Install ProdLi in seconds. Free forever.
          </p>
          <a
            href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
            className="nb-btn" style={{ fontSize: 15, padding: "18px 44px" }}
          >
            Add to Chrome — it's free →
          </a>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="site-footer" style={{
        borderTop: "var(--border)", background: "#000",
        padding: "24px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "var(--yellow)", color: "#000", fontWeight: 900, fontSize: 12, padding: "2px 10px" }}>ProdLi</span>
          <span style={{ color: "#555", fontSize: 11, fontWeight: 700 }}>© 2026</span>
        </div>
        <div className="site-footer-links" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <a href="mailto:contact@prodli.com" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>contact@prodli.com</a>
          <a href="/privacy" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Privacy Policy</a>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--yellow)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Chrome Store →</a>
        </div>
      </footer>
    </div>
  );
}
