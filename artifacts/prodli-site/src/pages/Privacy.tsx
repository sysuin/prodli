import { Link } from "wouter";

const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

export function Privacy() {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh" }}>

      {/* Nav */}
      <nav style={{
        borderBottom: "var(--border)",
        background: "#000",
        padding: "0 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 56,
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            background: "var(--yellow)", color: "#000", fontWeight: 900,
            fontSize: 13, padding: "3px 12px", letterSpacing: "0.02em",
          }}>ProdLi</span>
        </Link>
        <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 11, padding: "8px 18px" }}>
          Add to Chrome →
        </a>
      </nav>

      {/* Content */}
      <div className="privacy-content" style={{ maxWidth: 720, margin: "0 auto", padding: "60px 32px 80px" }}>
        <div className="privacy-card" style={{
          border: "var(--border)", background: "var(--card)",
          padding: "40px 48px", boxShadow: "var(--shadow-lg)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--muted)", marginBottom: 12 }}>
            Legal
          </div>
          <h1 style={{ fontWeight: 900, fontSize: 32, letterSpacing: "-0.02em", marginBottom: 8 }}>
            Privacy Policy
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 40 }}>
            Last updated: June 2026
          </p>

          {[
            {
              title: "Overview",
              body: `ProdLi is a Chrome extension that replaces your new tab page with a local productivity workspace. All data created and collected by ProdLi is stored exclusively on your device using chrome.storage.local. No data is ever transmitted to any external server, sold, shared, or used for advertising.`,
            },
            {
              title: "What data is stored",
              body: `ProdLi stores the following data locally in your browser:

• Notes — content and metadata from the rich-text editor
• Tasks — to-do items, priorities, due dates, and subtasks
• Habit records — daily check-in history and streak counts
• Pomodoro settings — timer durations and session preferences
• Time-tracking data — the hostname (domain name) of websites you visit and the number of seconds spent on each, recorded per day under keys like tt_YYYY-MM-DD
• Tracker settings — idle threshold, notification time, Focus List rules, and blocked domains list

None of this data leaves your device.`,
            },
            {
              title: "Browsing history",
              body: `The Time Tracker feature uses the browser's tabs permission to read the hostname of your currently active tab. Only the hostname (e.g. "github.com") is ever read or stored — the full URL, page title, query parameters, and page content are never accessed. This data is stored locally and never transmitted.`,
            },
            {
              title: "Optional permissions",
              body: `If you choose to enable the auto-redirect feature in the Focus List, ProdLi will request the scripting and <all_urls> permissions. These are used solely to navigate the active tab away from a site when its daily time limit is reached. This feature is entirely opt-in and the permissions can be revoked at any time from Chrome's extension settings.`,
            },
            {
              title: "No external services",
              body: `ProdLi does not use analytics, crash reporting, remote logging, or any third-party services. The extension operates entirely offline. All JavaScript, CSS, and font files are bundled into the extension package — no resources are loaded from external CDNs or servers at runtime.`,
            },
            {
              title: "Data retention and deletion",
              body: `Your data persists in chrome.storage.local until you clear it. You can delete all time-tracking data at any time from the Time Tracker → Settings → Danger Zone section within the extension. Uninstalling the extension will remove all stored data from your browser.`,
            },
            {
              title: "Children's privacy",
              body: `ProdLi is a general-purpose productivity tool and is not directed at children under 13. We do not knowingly collect any personal information from children.`,
            },
            {
              title: "Changes to this policy",
              body: `If this policy is updated, the "Last updated" date above will change. Continued use of the extension after any update constitutes acceptance of the revised policy.`,
            },
            {
              title: "Contact",
              body: `For any privacy-related questions, contact us at contact@prodli.com.`,
            },
          ].map((section, i) => (
            <div key={i} style={{ marginBottom: 36 }}>
              <h2 style={{
                fontWeight: 900, fontSize: 14, textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 10,
                borderBottom: "2px solid #000", paddingBottom: 8,
              }}>
                {section.title}
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-line", color: "var(--fg)" }}>
                {section.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "var(--border)", background: "#000", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <span style={{ color: "#555", fontSize: 12, fontWeight: 700 }}>© 2026 ProdLi</span>
        <a href="mailto:contact@prodli.com" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>contact@prodli.com</a>
      </footer>
    </div>
  );
}
