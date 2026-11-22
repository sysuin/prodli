// Nav and footer for prodli.com's content pages (meeting notes pages, goodbye).
// The footer links every meeting notes page, so search engines find them all.

import type { ReactNode } from "react";
import { Logo } from "./Logo";

export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

export const MEETING_LINKS: [string, string][] = [
  ["/ai-meeting-notes", "AI meeting notes"],
  ["/ai-meeting-notes/google-meet", "Google Meet notes"],
  ["/ai-meeting-notes/zoom", "Zoom notes"],
  ["/ai-meeting-notes/teams", "Teams notes"],
  ["/ai-meeting-notes/in-person", "In-person notes"],
];

const footLink = { color: "#888", fontSize: 12, fontWeight: 700 } as const;

export function SiteFooter() {
  return (
    <footer className="site-footer" style={{ borderTop: "var(--border)", background: "#000", padding: "28px 40px", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        {MEETING_LINKS.map(([href, label]) => (
          <a key={href} href={href} style={footLink}>
            {label}
          </a>
        ))}
        <a href="/download" style={footLink}>
          Mac &amp; Windows
        </a>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={20} />
          <span style={{ color: "#555", fontSize: 11, fontWeight: 700 }}>© 2026</span>
        </div>
        <div className="site-footer-links" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <a href="mailto:contact@prodli.com" style={footLink}>
            contact@prodli.com
          </a>
          <a href="/privacy" style={{ ...footLink, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Privacy Policy
          </a>
          <a href="/terms" style={{ ...footLink, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Terms
          </a>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--yellow)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Chrome Store →
          </a>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children, cta = true }: { children: ReactNode; cta?: boolean }) {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <nav style={{ borderBottom: "var(--border)", background: "#000", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, gap: 12 }}>
        <a href="/" aria-label="ProdLi home" style={{ display: "flex", alignItems: "center" }}>
          <Logo size={26} />
        </a>
        {cta && (
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 11, padding: "8px 18px" }}>
            Add to Chrome →
          </a>
        )}
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
      <SiteFooter />
    </div>
  );
}
