import { Link } from "wouter";

/*
 * DRAFT for review before launch (see docs/LAUNCH-CHECKLIST.md). Have a lawyer
 * check it against India's DPDP Act 2023 and the GDPR before publishing the
 * Google consent screen. It describes ProdLi as built: local-first app,
 * optional ProdLi account (Google sign-in), sync on Cloudflare, optional AI
 * summaries through Anthropic.
 */
export const PRIVACY_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Overview",
    body: `ProdLi is a productivity workspace — notes, to-dos, habits, Pomodoro, meeting notes, a time tracker and a file viewer — available as a Chrome extension and as a web app at app.prodli.com. It works without an account: your data is then stored only on your device. If you create a free ProdLi account, your data is also stored on ProdLi's servers so it stays the same on every device you use.

We don't sell your data, use it for advertising, or let anyone else use it for their own purposes. This policy explains what we store, why, where, and the choices you have.`,
  },
  {
    title: "Who we are",
    body: `ProdLi ("we", "us") is the data controller for personal data processed through the ProdLi account and sync service. Contact: contact@prodli.com.`,
  },
  {
    title: "Data on your device",
    body: `Whether or not you have an account, ProdLi stores your data in your browser (chrome.storage, localStorage and IndexedDB):
• Notes, to-dos (with priorities, due dates and subtasks), habits and check-ins
• Pomodoro settings, timer and completed sessions
• Time Tracker: the hostname (e.g. "github.com") of the active tab and seconds per day — never full URLs, page titles or page content
• Meetings (if you use the recorder): transcripts, summaries and optional audio recordings
• Settings such as theme and fonts, and your own Claude API key if you add one`,
  },
  {
    title: "Your ProdLi account (optional)",
    body: `When you sign in with Google, we receive your Google account ID, name, email address and profile picture, and we store them with your plan (Free or Pro) and when you joined. For each signed-in device we store a session (a random token kept only as a one-way hash), the kind of device ("Extension" or "Web"), the browser and operating system name, and when it was last used. We use this to keep you signed in, show you your devices and protect your account.

We ask Google only for basic profile information (openid, email, profile). The extension may also ask for access to ProdLi's private app-data folder in your Google Drive, used only to bring in a backup made with ProdLi's older Drive sync.`,
  },
  {
    title: "Sync",
    body: `With an account, these are stored on ProdLi's servers and kept in sync across your devices: notes, to-dos, habits, meeting transcripts and summaries (text only — never audio), Pomodoro history, and Time Tracker history (hostnames and seconds per day). Each account's data is kept in its own separate database. Settings and your Claude API key are never uploaded.

You can stop uploading meetings recorded on a computer (account window → Sync). Meeting transcripts contain what other participants said: you are responsible for telling participants that you take notes and for getting consent where the law requires it.`,
  },
  {
    title: "AI meeting summaries",
    body: `There are two ways to summarize a meeting:
• Through your ProdLi account (free monthly allowance): the transcript, meeting name and date are sent from ProdLi's servers to Anthropic's Claude API to write the summary. ProdLi doesn't keep a separate copy of what was sent; the resulting summary is saved with the meeting. We count how many summaries you use each month.
• With your own Claude API key (extension only): your browser sends the transcript directly to Anthropic with your key. ProdLi never sees the key or the request.
Anthropic processes this data under its commercial API terms, which by default don't allow it to be used to train models.`,
  },
  {
    title: "Where data is stored and who processes it",
    body: `• Cloudflare (hosting, databases, backups) — data is encrypted in transit and at rest, and may be processed in Cloudflare's global network, including outside your country
• Google (sign-in)
• Anthropic (AI summaries, only when you ask for one through your account)
We share data with these providers only to run ProdLi, under contracts that restrict their use of it. We don't share it with anyone else unless the law requires us to.`,
  },
  {
    title: "Security",
    body: `Connections use HTTPS. Sessions are random tokens stored only as hashes; the web app's session cookie can't be read by scripts. Each account's synced data is in its own database that only that account's sessions can reach. ProdLi staff have no tool for browsing users' data, and our logs don't contain note or meeting content.`,
  },
  {
    title: "Retention and deletion",
    body: `• Data on your device stays until you delete it or uninstall the extension / clear the site's data.
• Signing out keeps the data on that device.
• "Delete account" (account window) immediately deletes your account, sessions, AI usage counts and all synced data from our live systems. Encrypted backups that may contain it are deleted automatically within 30 days.`,
  },
  {
    title: "Your rights",
    body: `You can see and download all synced data at any time (account window → Download my data), correct it in the app, and delete it (Delete account). Depending on where you live (for example under India's Digital Personal Data Protection Act 2023 or the EU/UK GDPR) you may also have rights to object, restrict processing, data portability, withdraw consent, nominate someone to exercise your rights, and complain to a data protection authority. Contact contact@prodli.com to exercise any of them; we reply within 30 days.

Legal bases (GDPR): providing the service you signed up for (contract); keeping it secure and preventing abuse (legitimate interests); AI summaries and meeting uploads (your request / consent, which you can withdraw).`,
  },
  {
    title: "Browser permissions (extension)",
    body: `• storage, unlimitedStorage — save your data on your device
• tabs, idle, alarms, notifications — time tracking, Pomodoro, reminders and background sync
• identity — Google sign-in
• Optional, requested only when you turn a feature on: tabCapture, offscreen and access to meet.google.com (meeting recorder); scripting and access to sites (Focus List auto-redirect).`,
  },
  {
    title: "No ads, analytics or tracking",
    body: `ProdLi doesn't use advertising, analytics or third-party tracking SDKs. The web app loads Google's sign-in script and fonts from Google; the extension bundles its code and fonts.

ProdLi's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.`,
  },
  {
    title: "Children",
    body: `ProdLi isn't directed at children under 13 (or under 18 where the law requires parental consent, as in India), and we don't knowingly collect their personal data. If you believe a child has created an account, contact us and we'll delete it.`,
  },
  {
    title: "Changes",
    body: `If we change this policy we'll update the date above, and for significant changes we'll tell signed-in users in the app or by email before the change takes effect.`,
  },
  {
    title: "Contact",
    body: `Questions or requests: contact@prodli.com.`,
  },
];

const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "The service",
    body: `ProdLi provides a productivity workspace as a Chrome extension and a web app, with an optional free account that syncs your data between devices and optional AI meeting summaries. By using ProdLi you agree to these terms and to the Privacy Policy.`,
  },
  {
    title: "Your account",
    body: `You sign in with a Google account and must be old enough to agree to these terms where you live. Keep your devices secure; you're responsible for activity on your account. You can sign out of any device and delete your account at any time from the account window.`,
  },
  {
    title: "Your content",
    body: `Your notes, tasks, meetings and other content belong to you. You give ProdLi only the permission needed to store, sync, back up and (when you ask) summarize it for you. You're responsible for your content and for having the right to record and process meetings — including telling participants and getting consent where the law requires it.`,
  },
  {
    title: "Acceptable use",
    body: `Don't use ProdLi to break the law, infringe others' rights, store malware, or attack, overload or try to get around the limits or security of the service, and don't access other people's accounts.`,
  },
  {
    title: "Free plan and limits",
    body: `The free plan includes fair limits — currently 100 MB of synced data and 20 AI summaries per month — which we may change with notice. A paid plan may be offered later; its price and terms will be shown before you buy.`,
  },
  {
    title: "AI summaries",
    body: `Summaries are generated by Anthropic's Claude models and can be incomplete or wrong. Check important details against the transcript before relying on them.`,
  },
  {
    title: "Availability and changes",
    body: `We work to keep ProdLi available and your data safe, with backups, but the service is provided "as is" without guarantees of uninterrupted availability. Keep your own copies of important data (Download my data, or Backup in the app). We may change or discontinue features; if we shut down the sync service we'll give at least 30 days' notice so you can export your data.`,
  },
  {
    title: "Liability",
    body: `To the extent the law allows, ProdLi isn't liable for indirect or consequential losses, or for loss of data beyond restoring from our backups where possible. Nothing in these terms limits rights you have under consumer protection laws that can't be excluded.`,
  },
  {
    title: "Ending",
    body: `You can stop using ProdLi and delete your account at any time. We may suspend accounts that break these terms, telling you why unless the law prevents it.`,
  },
  {
    title: "Law and contact",
    body: `These terms are governed by the laws of India, without affecting mandatory protections where you live. Questions: contact@prodli.com.`,
  },
];

export function Privacy() {
  return <LegalPage title="Privacy Policy" sections={PRIVACY_SECTIONS} />;
}

export function Terms() {
  return <LegalPage title="Terms of Service" sections={TERMS_SECTIONS} />;
}

function LegalPage({ title, sections }: { title: string; sections: { title: string; body: string }[] }) {
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
            {title}
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 40 }}>
            Last updated: November 2026
          </p>

          {sections.map((section, i) => (
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
        <Link to="/privacy" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>Privacy</Link>
        <Link to="/terms" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>Terms</Link>
      </footer>
    </div>
  );
}
