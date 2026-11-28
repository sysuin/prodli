import { useState } from "react";
import { Logo } from "../components/Logo";
import { CHROME_STORE_URL, SiteFooter } from "../components/Shell";

const ASK = {
  emoji: "✨",
  title: "Ask ProdLi",
  accent: "#A78BFA",
  desc: "Ask about your day, notes and meetings — “What should I focus on now?”, “What did we decide in Monday's call?” — and turn answers into to-dos with one click. Save prompts you use often, or have them run on a schedule. Ctrl/⌘ + K takes you anywhere. Works with Claude and ChatGPT too, through ProdLi's MCP server.",
};

// Dictation, writing check and the screen recorder reach extension users with
// 1.5.0 (live in the Chrome Web Store since 26 Nov 2026; 1.5.1 since 28 Nov).
const SHOW_EXTENSION_150 = true;

const ALL_FEATURES = [
  { emoji: "🎙️", title: "Meetings", accent: "#FF4FA3", group: "Meet", desc: "AI notes for Google Meet, Zoom, Teams and meetings in the room, with no bot in the call. Transcript, summary, decisions and action items. Upload a recording or an Otter or Zoom transcript too." },
  { emoji: "🎥", title: "Screen recorder", accent: "#F472B6", group: "Meet", needs150: true, desc: "Record your screen, a window or a tab with your camera in a bubble. Get a transcript and notes, and a link anyone can watch." },
  { emoji: "☀️", title: "Today", accent: "#F59E0B", group: "Plan", desc: "A daily brief that plans your day around your two-way Google Calendar, to-dos and habits. Block time for tasks between meetings, wrap up in the evening. Search, your quick links and Read later in every new tab." },
  { emoji: "📊", title: "Weekly review", accent: "#14B8A6", group: "Plan", desc: "What got done, what slipped, how habits and focus went — and three priorities for next week." },
  { emoji: "✅", title: "To-Dos", accent: "#00BCD4", group: "Plan", desc: "Priorities, due dates and subtasks. Type “Call Sam friday !high” and ProdLi fills in the rest." },
  { emoji: "🎯", title: "Habits", accent: "#66BB6A", group: "Plan", desc: "Daily check-ins with streaks and a heatmap calendar." },
  { emoji: "✍️", title: "Notes", accent: "#FFD700", group: "Create", desc: "Rich notes with checklists, tables and a “/” menu. Paste Markdown, pin, export or print." },
  { emoji: "📄", title: "Files", accent: "#FF9800", group: "Create", desc: "Drop a Markdown, CSV, JSON or code file anywhere in Chrome to read it nicely — then save it as a note." },
  { emoji: "🗣️", title: "Dictation", accent: "#38BDF8", group: "Write", needs150: true, desc: "Press Alt+Shift+D in any text box and talk. ProdLi removes the “um”s, fixes punctuation and writes it in the right tone for email or chat. Snippets, your own words, and edits by voice." },
  { emoji: "✔️", title: "Writing check", accent: "#4ADE80", group: "Write", needs150: true, desc: "Spelling, grammar and clearer wording as you type in Gmail, LinkedIn or any text box. Click for the fix, or rewrite shorter, clearer or friendlier." },
  { emoji: "🍅", title: "Pomodoro", accent: "#FF6B6B", group: "Focus", desc: "A focus timer that keeps running across tabs and tells you when to take a break." },
  { emoji: "⏱", title: "Time Tracker", accent: "#A78BFA", group: "Focus", desc: "See where your browsing time goes, set daily limits, and block distracting sites (and Shorts and Reels) during focus time." },
];

const FEATURES = ALL_FEATURES.filter((f) => SHOW_EXTENSION_150 || !("needs150" in f));

const STEPS = [
  { n: "01", title: "Add to Chrome", desc: "Free. ProdLi becomes your new tab, and the web app at app.prodli.com works on any device." },
  { n: "02", title: "Click the icon in a call", desc: "On Meet, Zoom, Teams and more. Nothing joins the call. You get a transcript, summary, decisions and action items." },
  { n: "03", title: "Wake up to a plan", desc: "Action items become to-dos, and each morning's brief plans your day around them and your calendar." },
];

// Keep in step with the server's limits (prodli-api: ai.ts, ask.ts, brief.ts, write.ts, transcribe.ts, dictate.ts, syncStore.ts).
const PRO_FEATURES = ["Your own meeting templates", "Talk-time insights", "Action items across meetings", "AI meeting prep", "Focus trends", "Your writing style", "Meeting series history", "Notes in your language", "Prep reminders", "Key moments in summaries", "Meeting insights", "AI meeting coach", "Summaries from your notes", "Decision log", "Meeting type rules", "Dictation Command Mode", "Shared links that never expire"];
type Period = "monthly" | "yearly";
const PLANS: { key: "free" | "pro" | "plus"; name: string; price: Record<Period, string>; billed: Record<Period, string>; note: string; rows: string[]; extra?: string }[] = [
  { key: "free", name: "Free", price: { monthly: "$0", yearly: "$0" }, billed: { monthly: "Forever", yearly: "Forever" }, note: "Everything in ProdLi, with monthly AI allowances.", rows: ["20 AI meeting summaries", "5 h of AI audio transcription", "100 Ask ProdLi questions", "62 AI daily briefs & weekly reviews", "200 writing-help uses", "Voice dictation in any text box (1,000 AI clean-ups)", "Writing check in any text box (300 AI checks; free and unlimited with Chrome's on-device AI)", "Screen recording with share links (25 videos, up to 5 min each)", "100 MB of synced data", "Share meeting notes by link (7 or 30 days)"] },
  { key: "pro", name: "Pro", price: { monthly: "$5", yearly: "$4" }, billed: { monthly: "Billed monthly", yearly: "$48 billed yearly" }, note: "For people with lots of meetings.", rows: ["300 AI meeting summaries", "25 h of AI audio transcription", "500 Ask ProdLi questions", "200 AI daily briefs & weekly reviews", "1,000 writing-help uses", "3,000 dictation AI clean-ups", "3,000 writing checks", "Unlimited shared videos, up to 45 min each", "2 GB of synced data"], extra: "Plus every Pro feature:" },
  { key: "plus", name: "Pro Plus", price: { monthly: "$12", yearly: "$10" }, billed: { monthly: "Billed monthly", yearly: "$120 billed yearly" }, note: "For meeting-heavy days and heavy AI use.", rows: ["900 AI meeting summaries", "75 h of AI audio transcription", "1,200 Ask ProdLi questions", "400 AI daily briefs & weekly reviews", "2,500 writing-help uses", "6,000 dictation AI clean-ups", "8,000 writing checks", "Unlimited shared videos, up to 2 h each", "10 GB of synced data"], extra: "Everything in Pro:" },
];

const FAQ = [
  { q: "Do I need an account?", a: "No. ProdLi works without an account and offline. Sign in with Google only if you want sync between devices and app.prodli.com, and the AI features (daily brief, weekly review, Ask ProdLi, meeting summaries)." },
  { q: "Does a bot join my meetings?", a: "No. ProdLi takes notes in your browser: from Google Meet's own captions, or from the call's audio on Zoom, Teams, Webex, Slack, Discord and other apps. Nobody else sees anything. Audio leaves your computer only to be transcribed with AI: when you choose it, or after a call or in-person recording while you're signed in (you can turn that off)." },
  { q: "Where is my data?", a: "On your device first. If you sign in, synced data is stored in your own private space on ProdLi's servers. You can download or delete it any time. We don't sell data or show ads." },
  { q: "Is there a desktop app?", a: "Coming very soon: ProdLi for Mac and Windows (prodli.com/download) adds AI notes for calls in any app (Zoom, Teams, Slack, FaceTime…), quick add from anywhere and a menu bar / tray icon. It syncs with the extension and app.prodli.com." },
  { q: "Can I bring my notes and tasks from other apps?", a: "Yes. Import notes from Notion, Evernote, Google Keep or Markdown files, and tasks from Todoist, TickTick, Google Tasks or a CSV, with a preview first. For meetings, upload a recording or a transcript from Otter, Fireflies, Granola, Zoom or Teams." },
  { q: "Does it work in Hindi and other languages?", a: "Yes. Dictation, 🎙 Speak tasks and the daily brief work in Hindi, Hinglish, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi and Urdu, as well as English (Settings → Language)." },
  { q: "Does it work on my phone?", a: "Yes — open app.prodli.com and add it to your home screen. The Chrome extension adds the new tab, meeting notes, quick add from any page and time tracking." },
];

const APP_URL = "https://app.prodli.com";

export function Landing() {
  const [period, setPeriod] = useState<Period>("yearly");
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
          <Logo size={26} />
          <span className="nav-subtitle">Personal assistant</span>
        </div>
        <div className="nav-links">
          <a href="/ai-meeting-notes" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Meeting notes
          </a>
          <a href="#features" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Features
          </a>
          <a href="#pricing" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Pricing
          </a>
          <a href="/download" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Mac &amp; Windows
          </a>
          <a href="/privacy" className="nav-text-link" style={{ color: "#888", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Privacy
          </a>
          <a href="https://app.prodli.com" className="nav-text-link" style={{ color: "#fff", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Log in
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
          Meet · Zoom · Teams · In person · Free
        </div>

        <h1 style={{
          fontWeight: 900, fontSize: "clamp(36px, 6vw, 68px)",
          lineHeight: 1.05, letterSpacing: "-0.03em",
          maxWidth: 780, marginBottom: 24,
        }}>
          Meeting notes,{" "}<span style={{ background: "var(--yellow)", padding: "0 10px" }}>without the bot.</span>
        </h1>

        <p style={{
          fontSize: "clamp(14px, 2vw, 18px)", fontWeight: 500,
          color: "#5a3e20", maxWidth: 560, lineHeight: 1.65, marginBottom: 40,
        }}>
          ProdLi writes the transcript, summary, decisions and action items for your calls and meetings, from your own computer. Nothing joins the call. Then it turns them into your plan for the day, in every new tab, with your to-dos, notes, habits and focus tools.
        </p>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 14, padding: "16px 36px" }}>
              Add to Chrome — it's free →
            </a>
            <a href="https://app.prodli.com" className="nb-btn nb-btn-ghost" style={{ fontSize: 14, padding: "16px 28px" }}>
              Open the web app ↗
            </a>
            <a href="/ai-meeting-notes" className="nb-btn nb-btn-ghost" style={{ fontSize: 14, padding: "16px 28px" }}>
              How meeting notes work
            </a>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
            Use it in Chrome or on any device at app.prodli.com — sign in once, synced everywhere
          </span>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 48, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            ["0", "Bots in your meetings"],
            ["20", "Free AI summaries a month"],
            ["1", "Tab for your whole day"],
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
          <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", marginBottom: 40, maxWidth: 560 }}>
            Notes from every meeting, and an assistant that plans your day with them.
          </h2>

          <div className="feature-grid">
            <div className="nb-card" style={{ padding: "22px 24px", boxShadow: "var(--shadow)", gridColumn: "1 / -1", background: "#1a1a1a", color: "#fff" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: ASK.accent }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginTop: 4 }}>
                <span style={{ fontSize: 22 }}>{ASK.emoji}</span>
                <span style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>{ASK.title}</span>
              </div>
              <p style={{ fontSize: 14, color: "#ddd", lineHeight: 1.65 }}>{ASK.desc}</p>
            </div>
            {FEATURES.map((f) => (
              <div key={f.title} className="nb-card" style={{ padding: "22px 24px", boxShadow: "var(--shadow)" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: f.accent }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 22 }}>{f.emoji}</span>
                  <span style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>{f.title}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{f.group}</span>
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
          <div className="section-label" style={{ marginBottom: 12, color: "#888" }}>How it works</div>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", marginBottom: 48, color: "#fff" }}>
            From new tab to a planned day in a minute.
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
            Your data, your control.
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: "#3a2a00", maxWidth: 560, margin: "0 auto 36px" }}>
            Everything is saved on your device first, and ProdLi works offline. Sign in only if you want sync: synced data goes to your own private space on ProdLi's servers, meeting audio is never synced, and you can download or delete everything at any time. No ads, and we never sell your data.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            {["No bot in your calls", "Works offline", "On Meet, no audio leaves your computer", "Download or delete anytime"].map((item) => (
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

      {/* ── PRICING ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="site-section" style={{ padding: "72px 40px", borderBottom: "var(--border)" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          <div className="section-label" style={{ marginBottom: 12 }}>Pricing</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
            <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", margin: 0 }}>Free to use. Pay when you need more AI.</h2>
            <div role="radiogroup" aria-label="Billing period" style={{ display: "inline-flex", border: "var(--border)", background: "#fff" }}>
              {(["monthly", "yearly"] as const).map((p) => (
                <button key={p} role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} style={{ border: "none", padding: "10px 16px", fontWeight: 900, fontSize: 13, cursor: "pointer", fontFamily: "inherit", background: period === p ? "#000" : "transparent", color: period === p ? "var(--yellow)" : "#000" }}>
                  {p === "monthly" ? "Monthly" : "Yearly"}
                  {p === "yearly" && <span style={{ marginLeft: 6, background: "var(--yellow)", color: "#000", padding: "1px 6px", fontSize: 11 }}>save up to 20%</span>}
                </button>
              ))}
            </div>
          </div>
          <p style={{ margin: "-16px 0 24px", fontSize: 15, fontWeight: 700 }} data-testid="trial-note">New accounts get 14 days of Pro free. No card needed; it goes back to Free on its own.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, alignItems: "start" }}>
            {PLANS.map((plan) => (
              <div key={plan.key} className="nb-card" style={{ padding: "26px 26px 24px", boxShadow: "var(--shadow)", background: plan.key === "pro" ? "var(--yellow)" : undefined, position: "relative" }}>
                {plan.key === "pro" && <span style={{ position: "absolute", top: -12, left: 20, background: "#000", color: "var(--yellow)", fontSize: 11, fontWeight: 900, padding: "3px 10px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Most popular</span>}
                <div style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>{plan.name}</div>
                <div style={{ fontWeight: 900, fontSize: 36, letterSpacing: "-0.02em", margin: "6px 0 0", color: "#000" }}>
                  {plan.price[period]}
                  <span style={{ fontSize: 14, fontWeight: 700 }}> / month</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#5a3e20", marginBottom: 8 }}>{plan.billed[period]}</div>
                <p style={{ fontSize: 13, color: "#5a3e20", marginBottom: 14 }}>{plan.note}</p>
                {plan.key === "free" ? (
                  <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 12, padding: "10px 20px", marginBottom: 18, display: "inline-block" }}>
                    Add to Chrome →
                  </a>
                ) : (
                  <a href={`${APP_URL}/?plan=${plan.key}&period=${period}`} className="nb-btn" style={{ fontSize: 12, padding: "10px 20px", marginBottom: 18, display: "inline-block", background: plan.key === "pro" ? "#000" : undefined, color: plan.key === "pro" ? "var(--yellow)" : undefined }}>
                    Get {plan.name} →
                  </a>
                )}
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 6 }}>Every month</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                  {plan.rows.map((r) => (
                    <li key={r} style={{ fontSize: 14, fontWeight: 600 }}>✓ {r}</li>
                  ))}
                </ul>
                {plan.extra && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{plan.extra} {PRO_FEATURES.length} features</summary>
                    <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
                      {PRO_FEATURES.map((r) => (
                        <li key={r} style={{ fontSize: 13 }}>✓ {r}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#5a3e20", marginTop: 20 }}>Prices in US dollars, plus tax where it applies; checkout shows your local price. Sign in with Google, pay on one page, and the plan turns on by itself on every device. Cancel any time. Payments by Dodo Payments (merchant of record).</p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="site-section" style={{ padding: "72px 40px", borderBottom: "var(--border)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="section-label" style={{ marginBottom: 12 }}>Questions</div>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(24px, 4vw, 40px)", letterSpacing: "-0.02em", marginBottom: 28 }}>Good to know</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {FAQ.map((f) => (
              <details key={f.q} className="nb-card" style={{ padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
                <summary style={{ fontWeight: 800, fontSize: 15, cursor: "pointer" }}>{f.q}</summary>
                <p style={{ fontSize: 14, color: "#5a3e20", lineHeight: 1.65, marginTop: 10 }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="site-section" style={{ padding: "80px 40px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontWeight: 900, fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.02em", marginBottom: 16 }}>
            Take notes in your next meeting, without the bot.
          </h2>
          <p style={{ fontSize: 15, color: "#5a3e20", marginBottom: 40, lineHeight: 1.65 }}>
            Add it to Chrome in seconds. Free, with 20 AI meeting summaries a month.
          </p>
          <a
            href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
            className="nb-btn" style={{ fontSize: 15, padding: "18px 44px" }}
          >
            Add to Chrome — it's free →
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
