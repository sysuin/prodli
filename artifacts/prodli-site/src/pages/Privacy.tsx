import { Link } from "wouter";

/*
 * DRAFT for legal review (see docs/legal/REVIEW-NOTES.md). Every factual
 * statement here was checked against the code on 2026-11-09; if the product
 * changes, update this text and the review notes together. Items in
 * [square brackets] must be filled in before publishing.
 */
export const LAST_UPDATED = "9 November 2026";

export const PRIVACY_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Summary",
    body: `• ProdLi works without an account. Without one, your data stays in your browser on your device.
• With a free ProdLi account (Google sign-in), we also store your data on our servers so it's the same on every device.
• We use your data only to provide ProdLi. We don't sell it, use it for advertising, or let others use it for their own purposes.
• You can download or delete everything at any time from the account window.`,
  },
  {
    title: "Who we are",
    body: `ProdLi is operated by [legal name of the person or company], [postal address] ("ProdLi", "we", "us"). We are responsible for (the "controller" of) the personal data described in this policy. Contact: contact@prodli.com.

Grievance officer (India): [name], contact@prodli.com.`,
  },
  {
    title: "What this policy covers",
    body: `The ProdLi Chrome extension, the web app at app.prodli.com, the website prodli.com, and the ProdLi account and sync service.`,
  },
  {
    title: "Data stored only on your device",
    body: `ProdLi stores your workspace in your browser (extension storage, localStorage and IndexedDB):
• notes, to-dos (priorities, due dates, subtasks), habits and check-ins
• Pomodoro settings, timer and completed sessions
• Time Tracker (extension): the hostname of the website in your active tab (for example "github.com") and the seconds spent per day. Never full web addresses, page titles or page content.
• Meetings (extension, only if you use the recorder): transcripts, summaries and optional audio recordings
• settings such as theme and fonts

Without an account, none of this is sent to ProdLi. Uninstalling the extension or clearing the website's data deletes it.`,
  },
  {
    title: "Your ProdLi account (optional)",
    body: `When you sign in with Google we receive your Google account ID, name, email address and profile picture. We ask Google only for basic profile information (openid, email and profile). We store this with your plan (Free or Pro) and when you created and last used your account.

For each signed-in device we keep a session: a random sign-in token (we store only a one-way hash of it), whether it's the extension or the web app, the browser and operating system name (for example "Chrome on macOS"), and when it was created and last used. Sessions end after 180 days (extension) or 30 days (web app) without use, or when you sign out. We use this to keep you signed in, show your signed-in devices and protect your account.`,
  },
  {
    title: "Sync: data stored on our servers",
    body: `With an account, the following are stored on our servers and kept the same on all your devices:
• notes, to-dos and habits
• meetings: titles, transcripts and summaries (text only; audio recordings are never uploaded)
• Pomodoro history and your completed-session count
• Time Tracker history (hostnames and seconds per day)
• your Today page: each day's focus, reflection and daily brief, and your weekly reviews and notes on each week
Settings are never uploaded. Each account's data is kept in its own separate database.

You can stop a computer from uploading the meetings it records (account window → Sync). Meeting transcripts contain what other participants said. You are responsible for telling them that you take notes and for getting their consent where the law requires it.

If you used ProdLi's earlier Google Drive sync, the copy in your Drive is merged into your account once, the first time you sign in, and Drive sync then turns off.`,
  },
  {
    title: "AI features: daily brief, weekly review, Ask ProdLi and meeting summaries (optional)",
    body: `Ask ProdLi (chat): with an account, you can ask questions about your day. Our server sends Anthropic's Claude API your question, the last few messages of the conversation, the same day information as the daily brief, and short excerpts from the notes and meetings that match your question (chosen on your device). The conversation isn't stored on our servers or synced; it stays in the open page. Actions it suggests (such as adding a to-do) happen only when you click them.

Daily brief: with an account, ProdLi can write a short plan for your day. To do this, our server sends Anthropic's Claude API the parts of your day the brief needs: your open tasks (titles, priorities, due dates, estimates), habit names and streaks, today's calendar events (titles and times, if you connected Google Calendar), recent meeting action items, yesterday's top websites and focus sessions, and your focus and reflection notes. The brief is saved with that day and synced to your devices; we don't keep a separate copy of what was sent. We count how many briefs you use each month. Without an account, a basic brief is made on your device without AI and nothing is sent.

Weekly review: with an account, ProdLi can write a short review of your week. Our server sends Anthropic's Claude API a summary of that week made on your device: titles of tasks you finished and tasks that slipped (with priorities and dates), counts per day, habit names and how many days you kept them, focus-session totals, total browsing time and your top five websites, meeting titles and open action items, how many notes you created or edited, your daily focus and reflection notes, and your own notes on the week. The review is saved with that week and synced; we don't keep a separate copy of what was sent. Reviews count toward your monthly briefs. Without an account, a basic review is made on your device without AI and nothing is sent.

Meeting summaries: with an account, our server sends the meeting's transcript, name and date to Anthropic's Claude API and saves the summary with the meeting (a free monthly allowance). We don't keep a separate copy of what was sent, and meeting audio is never sent. We count how many summaries you use each month.
Anthropic processes this data as our service provider under its commercial terms, which don't allow it to train its models on this data. It keeps requests only for a limited period under its data retention policy.`,
  },
  {
    title: "Google Calendar (optional)",
    body: `If you connect Google Calendar on the Today page, ProdLi asks Google for read-only access to your calendar (scope calendar.readonly) and reads today's events in your browser to show your agenda. Events are not stored on ProdLi's servers. Their titles and times are included in your daily brief only if you have an account and use the AI brief. You can disconnect at any time on the Today page, and remove ProdLi's access in your Google Account settings.`,
  },
  {
    title: "Technical data and logs",
    body: `Like any online service, our hosting provider processes technical information about each request: IP address, browser type, the address requested, time and response status. We use it to deliver ProdLi, keep it secure and prevent abuse (for example, limiting sign-in attempts per IP address). Request logs are kept for up to 7 days. They never contain the content of your notes, tasks or meetings.`,
  },
  {
    title: "Cookies and similar technologies",
    body: `The web app sets one cookie: a strictly necessary sign-in cookie that scripts can't read. It lasts up to 30 days and is removed when you sign out. ProdLi also uses your browser's storage to keep your data on your device and to work offline.

ProdLi doesn't use advertising or analytics cookies. When you use the web app, Google's sign-in service and Google Fonts are loaded from Google, which receives your IP address and may set its own cookies under Google's privacy policy. The extension bundles its own fonts.`,
  },
  {
    title: "Why we use your data (legal bases)",
    body: `• To provide ProdLi: your account, sync, backups and summaries you ask for. This is necessary to perform our contract with you.
• To keep ProdLi secure, prevent abuse, fix problems and enforce limits. This is our legitimate interest in running a safe service.
• To upload meeting transcripts, create AI summaries, daily briefs and weekly reviews, and read your calendar: your choice to use these features. You can stop at any time.
• To comply with the law where required.
Under India's Digital Personal Data Protection Act, 2023, we process your personal data on the basis of the consent you give when you sign in, and for the purposes described here.`,
  },
  {
    title: "Who processes data for us",
    body: `• Cloudflare, Inc.: hosting, databases, sync, backups and request logs
• Dodo Payments: if you buy ProdLi Pro. Dodo Payments is our reseller and the merchant of record: it sells you the subscription, takes payment and handles tax and invoices under its own terms and privacy policy. You give your payment details to Dodo Payments, not to us. We give Dodo Payments your name, email address and ProdLi account ID to set up your checkout, and it tells us your subscription's status, plan, renewal date and its customer and subscription IDs; we never receive your card details.
• Google LLC: sign-in
• Anthropic, PBC: AI daily briefs, weekly reviews, Ask ProdLi answers and meeting summaries, only when you use them with your account
These providers process data only to provide their services to us, under data processing terms. We don't share your data with anyone else, except where the law requires us to or to protect people's safety. If ProdLi is ever transferred to a new owner, we'll tell you first.`,
  },
  {
    title: "International transfers",
    body: `Our providers operate worldwide, so your data may be stored or processed outside your country, including in the United States and the European Union. Where the law requires it (for example, for transfers out of the EU or UK), these transfers are covered by safeguards such as the European Commission's standard contractual clauses in our providers' data processing terms.`,
  },
  {
    title: "How long we keep data",
    body: `• Synced data and your account: until you delete them.
• Request logs: up to 7 days.
• Backups: we back up synced data nightly. Each copy is deleted automatically after 30 days. Our hosting provider's automatic recovery points also expire within 30 days.
• "Delete account" (account window) immediately deletes your account, sessions, AI usage counts, all synced data and our backup copies of it. Data may remain in our provider's automatic recovery points for up to 30 days, after which it's gone.
• Subscription records (ProdLi Pro): while you have the account. Dodo Payments keeps payment and tax records as the law requires; deleting your ProdLi account cancels your subscription.
• Signing out keeps your data on that device. Data stored only in your browser stays until you delete it.`,
  },
  {
    title: "Security",
    body: `• All connections use HTTPS, and our provider encrypts stored data.
• Sign-in tokens are stored only as one-way hashes, and the web app's sign-in cookie can't be read by scripts.
• Each account's synced data is in its own database that only that account's sessions can reach.
• Access to our systems is limited to the people who operate ProdLi and is protected by two-factor authentication.
• We have no tool for viewing users' data, and our logs don't contain your content.
• If a personal data breach affects you, we'll tell you and the relevant authorities as the law requires.`,
  },
  {
    title: "Your rights and choices",
    body: `• Access and portability: download everything synced at any time (account window → Download my data).
• Correction: edit your content in the app. Your name, email and picture come from your Google account.
• Deletion: delete your account and synced data at any time (account window → Delete account).
• Withdrawing consent: sign out, turn off meeting uploads, or stop using AI summaries.

Depending on where you live (for example under the EU/UK GDPR or India's DPDP Act), you may also have the right to object to or restrict processing, to nominate someone to exercise your rights, and to complain to your data protection authority (in India, the Data Protection Board). Contact contact@prodli.com; we'll reply within 30 days.`,
  },
  {
    title: "Browser permissions (extension)",
    body: `• storage, unlimitedStorage: save your data on your device
• tabs, idle, alarms, notifications: Time Tracker, Pomodoro, reminders and background sync
• identity: Google sign-in
• contextMenus: the right-click "Add to ProdLi" menu (it reads the page title, address and any text you selected only when you click it)
• webNavigation: to notice when a Markdown, CSV, JSON or text file from your computer is opened in Chrome, so ProdLi can show it in its Files viewer (only if you turn this on; the file is read on your device and never uploaded)
• Requested only if you turn on "Open files from anywhere in Chrome": access to local files (file:///), plus Chrome's "Allow access to file URLs" switch, which you control in Chrome's extension settings
• Requested only when you turn a feature on: tabCapture, offscreen and meet.google.com (meeting recorder); scripting and access to websites (Focus List auto-redirect). You can remove them at any time in Chrome's extension settings.`,
  },
  {
    title: "Google API data",
    body: `ProdLi's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. We use your Google profile information only to sign you in and show your account, and your calendar events (if you connect your calendar) only to show your agenda and plan your day. We don't transfer Google data to others except our service providers as described above, and never use it for advertising.`,
  },
  {
    title: "Children",
    body: `ProdLi accounts are for people aged 18 or over. We don't knowingly collect personal data from children. If you believe a child has created an account, contact us and we'll delete it.`,
  },
  {
    title: "Changes to this policy",
    body: `We'll update the date at the top when this policy changes. For significant changes, we'll tell signed-in users in the app or by email before the changes take effect.`,
  },
  {
    title: "Contact",
    body: `Questions, requests or complaints: contact@prodli.com.`,
  },
];

const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Agreement",
    body: `These terms are an agreement between you and [legal name] ("ProdLi", "we", "us") for your use of the ProdLi Chrome extension, the web app at app.prodli.com and the ProdLi account and sync service ("ProdLi"). By using ProdLi you accept these terms. Our Privacy Policy explains how we handle personal data.`,
  },
  {
    title: "Using ProdLi",
    body: `You can use ProdLi without an account. Your data then stays in your browser. A free account, created by signing in with Google, adds sync between your devices, backups and AI meeting summaries. You must be at least 18 to create an account.`,
  },
  {
    title: "Your account",
    body: `Keep your Google account and devices secure. You're responsible for what happens in your ProdLi account. You can sign out any device, or delete your account, at any time from the account window. Tell us at contact@prodli.com if you think someone else has used your account.`,
  },
  {
    title: "Your content",
    body: `Your notes, tasks, meetings and other content belong to you. You give us permission to store, copy, sync, back up and process your content only as needed to provide ProdLi to you. This includes sending meeting transcripts to our AI provider when you ask for a summary. This permission ends when you delete the content or your account, except for backup copies that expire as described in the Privacy Policy.

You're responsible for your content. In particular, if you record or transcribe meetings, you must tell participants and get their consent where the law requires it.`,
  },
  {
    title: "ProdLi Pro (paid plan)",
    body: `ProdLi Pro raises the limits shown in the app (currently 2 GB of synced data, 300 AI meeting summaries, 200 AI daily briefs or weekly reviews and 1,000 Ask ProdLi questions per month). Orders are processed by our online reseller Dodo Payments, the merchant of record for all ProdLi Pro orders: it charges you, issues invoices and handles payment questions and refunds.

Pro is a subscription, billed monthly or yearly in advance at the price shown at checkout (including any tax), and renews automatically until you cancel. You can cancel any time in Account → Manage subscription; Pro then stays on until the end of the period you've paid for, and you won't be charged again. Refunds follow Dodo Payments' terms and the law where you live. If we change the price, we'll tell you before your next renewal, and you can cancel before it applies. If a payment fails, Pro may stop until it's paid. Deleting your account cancels your subscription.`,
  },
  {
    title: "Acceptable use",
    body: `Don't use ProdLi to break the law or to infringe other people's rights. Don't upload malware. Don't try to access other people's accounts or data, or to disrupt, overload or get around the security or limits of ProdLi. Don't use AI summaries in ways that break Anthropic's Usage Policy.`,
  },
  {
    title: "Free plan and limits",
    body: `The free plan currently includes 100 MB of synced data, 20 AI meeting summaries, 62 AI daily briefs or weekly reviews and 100 Ask ProdLi questions per month. Limits are shown in the app and may change; we'll give notice before reducing them. More is available with ProdLi Pro (see “ProdLi Pro (paid plan)” above).`,
  },
  {
    title: "AI summaries, briefs, reviews and answers",
    body: `Summaries, daily briefs, weekly reviews and Ask ProdLi answers are generated automatically by Anthropic's Claude models. They can be incomplete or wrong. Check important details against the transcript before you rely on them.`,
  },
  {
    title: "Our software",
    body: `ProdLi's software, design and name belong to us. We give you a personal, non-exclusive, non-transferable licence to use ProdLi under these terms. If you send us feedback, we may use it without obligation to you.`,
  },
  {
    title: "Availability, changes and backups",
    body: `We work to keep ProdLi available and your data safe, including with nightly backups. But ProdLi is provided "as is", without a guarantee that it will always be available or error-free. Keep your own copies of important data (account window → Download my data, or 💾 Backup in the app).

We may change or remove features. If we decide to shut down the sync service, we'll give you at least 30 days' notice so you can download your data.`,
  },
  {
    title: "Ending",
    body: `You can stop using ProdLi and delete your account at any time. We may suspend or close an account that seriously or repeatedly breaks these terms, or where the law requires it. Unless the law prevents it, we'll tell you why and give you a chance to download your data.`,
  },
  {
    title: "Liability",
    body: `To the extent the law allows, we aren't liable for indirect or consequential losses, or for loss of data beyond restoring it from our backups where possible. Our total liability to you for any claim is limited to the amount you paid us in the 12 months before the claim (or ₹1,000 / US$15 if you use the free plan). Nothing in these terms limits liability that the law doesn't allow us to limit, or your rights as a consumer.`,
  },
  {
    title: "Changes to these terms",
    body: `We may update these terms. For significant changes, we'll tell signed-in users in the app or by email at least 15 days before the changes take effect. If you keep using ProdLi after that, the new terms apply. If you don't agree, you can delete your account.`,
  },
  {
    title: "Law and disputes",
    body: `These terms are governed by the laws of India, and the courts of [city], India, have jurisdiction. This doesn't take away any mandatory consumer protection you have under the law of the country where you live, including the right to bring claims in your local courts.`,
  },
  {
    title: "Contact",
    body: `contact@prodli.com`,
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
            Last updated: {LAST_UPDATED}
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
