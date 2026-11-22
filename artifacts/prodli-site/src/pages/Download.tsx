// prodli.com/download — ProdLi for Mac and Windows. The installers come from
// /download/desktop/latest.json (published by .github/workflows/desktop.yml);
// until the first release it says "coming soon" and points to the web app and
// the Chrome extension.

import { useEffect, useState, type CSSProperties } from "react";
import { Logo } from "../components/Logo";

const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

interface Latest {
  version: string;
  mac: string;
  windowsX64: string;
  windowsArm64: string;
  signed?: boolean;
  publishedAt?: string;
}

type Os = "mac" | "windows" | "other";

export function detectOs(ua: string, platform = ""): Os {
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) return /iPhone|iPad/.test(ua) ? "other" : "mac";
  if (/Win/i.test(platform) || /Windows/.test(ua)) return "windows";
  return "other";
}

const card: CSSProperties = { border: "var(--border)", background: "#fff", boxShadow: "var(--shadow)", padding: 28, display: "grid", gap: 14, alignContent: "start" };
const small: CSSProperties = { fontSize: 12, color: "var(--muted)", lineHeight: 1.6 };

const FEATURES = [
  ["🖥", "Record any call", "Zoom, Teams, Slack, Google Meet, FaceTime — your computer's sound and your microphone. No bot joins. Transcript, summary and action items."],
  ["⌨️", "Quick add anywhere", "Option/Alt + Shift + A in any app adds a to-do or note without switching windows."],
  ["🔔", "Always there", "Lives in the menu bar or tray: Pomodoro, reminders and your daily brief keep going when the window is closed."],
  ["📄", "Open your files", "Markdown, CSV, JSON and code files open nicely with “Open With → ProdLi”."],
  ["🔄", "Synced everywhere", "The same notes, to-dos, habits and meetings as the Chrome extension, app.prodli.com and the phone app."],
  ["📴", "Works offline", "Everything is saved on your computer first and syncs when you're back online."],
];

export function Download() {
  const [latest, setLatest] = useState<Latest | null | undefined>(undefined);
  // Detected after the first render, so the pre-rendered HTML (scripts/prerender.mjs) matches.
  const [os, setOs] = useState<Os>("other");

  useEffect(() => {
    setOs(detectOs(navigator.userAgent, (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform));
    document.title = "ProdLi for Mac and Windows";
    fetch("/download/desktop/latest.json", { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Latest>) : null))
      .then((l) => setLatest(l && typeof l.version === "string" ? l : null))
      .catch(() => setLatest(null));
  }, []);

  const mac = (
    <div style={card} data-testid="download-mac">
      <div style={{ fontSize: 34 }} aria-hidden="true">💻</div>
      <h2 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Mac</h2>
      <div style={small}>macOS 12 or later · Apple silicon and Intel. Recording other apps' sound needs macOS 13.</div>
      {latest ? (
        <a className="nb-btn" href="/download/mac" style={{ fontSize: 14, padding: "14px 24px", textAlign: "center" }}>
          Download for Mac (.dmg)
        </a>
      ) : (
        <span className="nb-btn nb-btn-ghost" style={{ fontSize: 13, padding: "14px 24px", textAlign: "center", cursor: "default" }}>{latest === undefined ? "…" : "Coming soon"}</span>
      )}
    </div>
  );
  const windows = (
    <div style={card} data-testid="download-windows">
      <div style={{ fontSize: 34 }} aria-hidden="true">🪟</div>
      <h2 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Windows</h2>
      <div style={small}>Windows 10 or 11 · 64-bit (Intel / AMD) or Arm.</div>
      {latest ? (
        <>
          <a className="nb-btn" href="/download/windows" style={{ fontSize: 14, padding: "14px 24px", textAlign: "center" }}>
            Download for Windows
          </a>
          <a href="/download/windows-arm64" style={{ ...small, textDecoration: "underline" }}>
            Windows on Arm (Surface Pro X, Snapdragon)
          </a>
        </>
      ) : (
        <span className="nb-btn nb-btn-ghost" style={{ fontSize: 13, padding: "14px 24px", textAlign: "center", cursor: "default" }}>{latest === undefined ? "…" : "Coming soon"}</span>
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh" }}>
      <nav style={{ borderBottom: "var(--border)", background: "#000", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <a href="/" aria-label="ProdLi home" style={{ display: "flex", alignItems: "center" }}>
          <Logo size={26} />
        </a>
        <a href="https://app.prodli.com" style={{ color: "#fff", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Open the web app ↗
        </a>
      </nav>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "64px 24px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ border: "var(--border)", background: "var(--yellow)", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", padding: "4px 14px", display: "inline-block", boxShadow: "var(--shadow-sm)", marginBottom: 24 }}>
            Desktop app · Free
          </div>
          <h1 style={{ fontWeight: 900, fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.05, letterSpacing: "-0.03em", margin: "0 0 18px" }}>
            ProdLi for <span style={{ background: "var(--yellow)", padding: "0 10px" }}>Mac and Windows</span>
          </h1>
          <p style={{ fontSize: 17, color: "#5a3e20", maxWidth: 620, margin: "0 auto", lineHeight: 1.65 }}>
            Your daily brief, notes, to-dos, habits and focus tools in their own app — plus AI notes for calls in any app, without a bot joining.
          </p>
          {latest && (
            <p style={{ ...small, marginTop: 14 }} data-testid="download-version">
              Version {latest.version}
              {latest.publishedAt ? ` · ${new Date(latest.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>{os === "windows" ? [windows, mac] : [mac, windows]}</div>

        {latest === null && (
          <div style={{ ...card, marginTop: 24, boxShadow: "var(--shadow-sm)" }} data-testid="download-soon">
            <strong>The desktop app is almost ready.</strong>
            <span style={{ fontSize: 14, lineHeight: 1.6 }}>
              Until then, everything works in the{" "}
              <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                Chrome extension
              </a>{" "}
              and at{" "}
              <a href="https://app.prodli.com" style={{ textDecoration: "underline" }}>
                app.prodli.com
              </a>
              . Sign in once and the desktop app picks up all your data when it arrives.
            </span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 56 }}>
          {FEATURES.map(([emoji, title, desc]) => (
            <div key={title} style={{ border: "var(--border)", background: "var(--bg)", padding: 20 }}>
              <div style={{ fontSize: 26 }} aria-hidden="true">
                {emoji}
              </div>
              <div style={{ fontWeight: 900, fontSize: 16, margin: "8px 0 6px" }}>{title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "#5a3e20" }}>{desc}</div>
            </div>
          ))}
        </div>

        <p style={{ ...small, textAlign: "center", marginTop: 48 }}>
          Free to use. Your data stays on your computer and syncs with your ProdLi account if you sign in. <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy policy</a>
        </p>
      </main>
    </div>
  );
}
