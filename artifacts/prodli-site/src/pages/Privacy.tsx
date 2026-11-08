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
            Last updated: November 2026
          </p>

          {[
            {
              title: "Overview",
              body: `ProdLi is a Chrome extension that replaces your new tab page with a productivity workspace. Your data is stored on your device (chrome.storage.local and the browser's IndexedDB). ProdLi has no servers of its own: it does not collect, sell, share or use your data for advertising. Data leaves your device only for the optional features described below, and only when you turn them on.`,
            },
            {
              title: "What data is stored on your device",
              body: `• Notes — content and metadata from the editor
• Tasks — to-dos, priorities, due dates and subtasks
• Habit records — daily check-ins and streaks
• Pomodoro — settings, the running timer and completed sessions
• Time-tracking data — the hostname (domain name) of websites you visit and the seconds spent on each, per day
• Tracker settings — idle threshold, notification time, Focus List rules and excluded domains
• Meetings (if you use them) — transcripts, AI summaries and optional audio recordings
• Settings — theme, fonts, your Claude API key (if you add one) and Google account name/email/picture (if you sign in)`,
            },
            {
              title: "Browsing history",
              body: `The Time Tracker uses the tabs permission to read the hostname of your active tab. Only the hostname (e.g. "github.com") is read or stored — never the full URL, page title or page content. It stays on your device (and in your Google Drive backup if you turn that on).`,
            },
            {
              title: "Meetings (optional)",
              body: `When you turn on the meeting recorder and start a recording on a Google Meet tab, ProdLi:
• records the tab's audio (and your microphone, if you allow it) and stores the recording on your device only;
• reads Google Meet's live captions on that tab to build a transcript, stored on your device;
• if you have added your own Claude API key, sends the transcript to Anthropic's API to generate a summary and action items. This request is made directly from your browser with your key and is subject to Anthropic's privacy policy. ProdLi never sees your key or transcripts.

No bot joins the call. You are responsible for informing participants and obtaining consent where the law requires it.`,
            },
            {
              title: "Google sign-in and Google Drive sync (optional)",
              body: `If you choose "Sign in with Google", ProdLi uses Chrome's identity API to get your name, email address and profile picture (shown in the extension) and permission to use ProdLi's own hidden app-data folder in your Google Drive (scope drive.appdata). ProdLi cannot see any other files in your Drive.

Sync stores one file with your notes, tasks, habits, Pomodoro data, time-tracking data, meeting notes and deletion markers (not audio, settings or your Claude API key) in that folder, and merges it with each computer where you sign in. Data goes directly between your browser and your own Google Drive; ProdLi has no copy. You can restore, sign out (which revokes access) or delete the backup from Google Drive settings → Manage apps at any time.

ProdLi's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.`,
            },
            {
              title: "Permissions",
              body: `• storage, unlimitedStorage — save your data on your device
• tabs, idle, alarms, notifications — time tracking, Pomodoro and reminders
• identity — optional Google sign-in
• Optional, requested only when you turn a feature on: tabCapture, offscreen and access to meet.google.com (meeting recorder); scripting and access to sites (Focus List auto-redirect). You can revoke these at any time in Chrome's extension settings.`,
            },
            {
              title: "No analytics or tracking",
              body: `ProdLi does not use analytics, crash reporting, remote logging or advertising SDKs. All code, styles and fonts are bundled in the extension; nothing is loaded from external servers at runtime except the optional Anthropic and Google requests described above (and Google profile pictures when signed in).`,
            },
            {
              title: "Data retention and deletion",
              body: `Data stays on your device until you delete it. You can delete notes, tasks, habits and meetings in the extension, and all time-tracking data from Time Tracker → Settings. Uninstalling the extension removes all data stored in your browser. Google Drive backups can be deleted from Google Drive settings → Manage apps → ProdLi → Delete hidden app data.`,
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
