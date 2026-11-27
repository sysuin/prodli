// prodli.com/compare/<name> — honest side-by-side pages for people searching
// "Granola alternative", "Otter alternative" and "Tactiq alternative".
//
// Every competitor fact below comes from that company's own website, checked on
// CHECKED (sources are listed on each page). Re-check them before changing a
// number, and when a competitor changes its pricing. Keep ProdLi's own claims
// true to STORE_SUBMISSION.md and docs/PRO-PLAN.md. Say where the other product
// is stronger: these pages only work if people trust them.

import type { CSSProperties } from "react";
import { CHROME_STORE_URL, Shell } from "../components/Shell";

export const CHECKED = "22 November 2026";

export type Competitor = "granola" | "otter" | "tactiq";

interface Comparison {
  name: string;
  h1: string;
  intro: string;
  /** [topic, ProdLi, them] */
  rows: [string, string, string][];
  different: [string, string][];
  stronger: string[];
  pickThem: string;
  faq: [string, string][];
  sources: [string, string][];
}

const PRODLI_PRICE = "Free plan; Pro $5 a month or $48 a year; Pro Plus $12 a month or $120 a year (plus tax where it applies)";

const COMPARISONS: Record<Competitor, Comparison> = {
  granola: {
    name: "Granola",
    h1: "ProdLi vs Granola",
    intro:
      "Granola and ProdLi both take AI meeting notes without a bot joining the call. Granola is a desktop and phone app focused on notes. ProdLi works in Chrome with nothing else to install, and turns your notes into your plan for the day.",
    rows: [
      ["Bot in the call", "No", "No"],
      ["Price", PRODLI_PRICE, "Basic free; Business $14 per user a month; Enterprise $35 per user a month"],
      ["Free plan", "20 AI meeting summaries and 300 minutes of AI audio transcription a month; all your meetings stay available", "Unlimited meeting notes; notes older than 30 days need an upgrade to view"],
      ["Where it records", "In Chrome: Google Meet, Zoom, Teams, Webex, Slack huddles and more in the browser, and in-person meetings (also on a phone at app.prodli.com). Mac and Windows app for calls in any app: coming soon", "Mac and Windows apps for calls in any app; iPhone and Android apps for in-person meetings and phone calls. The web app can't record"],
      ["Audio", "Google Meet: nothing recorded, notes come from Meet's captions. Other calls: saved on your computer, sent for transcription, not kept on ProdLi's servers", "Captured from your computer, cached during the meeting and deleted after transcription"],
      ["Ask questions across meetings", "Yes (Ask ProdLi: 100 questions a month free)", "Yes (AI chat across meetings, on every plan)"],
      ["Templates", "Built-in meeting types free; your own templates with Pro", "Custom note templates on every plan"],
      ["Notes into tasks and your day", "Action items go to your to-dos; a daily brief plans your day around them and your calendar; habits and focus tools in the same tab", "Action items in the notes; follow-up emails and pre-meeting briefs on Business"],
      ["Integrations", "Two-way Google Calendar; a read-only personal API and MCP server (for Claude, ChatGPT and other AI tools); imports from Notion, Evernote, Google Keep, Todoist, TickTick and Google Tasks; Markdown and PDF export, share links", "Slack on Basic; Notion, HubSpot, Attio, Affinity and Zapier on Business; API on Business"],
      ["Teams", "Personal accounts", "Workspaces with shared folders; SSO and admin controls on Enterprise"],
    ],
    different: [
      ["Nothing to install but Chrome", "ProdLi runs in the browser, so it works on computers where you can't install desktop apps."],
      ["Notes that run your day", "Action items become to-dos, and each morning's brief preps you for meetings you've had before and plans your day around what's open."],
      ["Lower price for one person", "Pro is $5 a month or $48 a year, compared with $14 per user a month for Granola Business."],
      ["Keep your full history free", "On the free plan, all your meetings stay available; the limit is on AI summaries per month instead."],
    ],
    stronger: [
      "Records calls in any desktop app today, including the Zoom and Teams apps. ProdLi's desktop app isn't out yet.",
      "Native iPhone and Android apps.",
      "No monthly limit on meetings, even on the free plan.",
      "Integrations (Slack, Notion, CRMs, Zapier) and team workspaces.",
    ],
    pickThem: "Choose Granola if you take most calls in desktop apps, want integrations with your CRM or Notion, or need a team workspace. Choose ProdLi if you live in Chrome, want your notes to become your plan for the day, or want a lower price as one person.",
    faq: [
      ["Is ProdLi a Granola alternative for Chrome?", "Yes. ProdLi takes AI notes for calls in your browser (Google Meet, Zoom, Teams and more) and for in-person meetings, without a bot and without a desktop app."],
      ["Can I use ProdLi with the Zoom or Teams desktop app?", "Not yet: in Chrome, ProdLi records calls in the browser. ProdLi for Mac and Windows, which records calls in any app, is coming soon (prodli.com/download)."],
      ["Does ProdLi keep my audio?", "On Google Meet, nothing is recorded: notes come from Meet's captions. For other calls, the recording stays on your computer and is sent for transcription; ProdLi's servers don't keep it."],
    ],
    sources: [
      ["Granola pricing", "https://www.granola.ai/pricing"],
      ["Granola home page", "https://www.granola.ai/"],
      ["Granola: subscriptions and billing", "https://docs.granola.ai/help-center/managing-your-account/subscriptions-and-billing"],
      ["Granola: transcription", "https://docs.granola.ai/help-center/taking-notes/transcription"],
      ["Granola: security, privacy and data FAQs", "https://docs.granola.ai/help-center/consent-security-privacy/security-privacy-data-faqs"],
    ],
  },
  otter: {
    name: "Otter",
    h1: "ProdLi vs Otter",
    intro:
      "Otter is a full meeting assistant: its AI agent can join your Zoom, Teams and Meet calls, or you can record without a bot from its desktop app or Chrome. ProdLi never sends a bot, costs less, and turns your notes into your plan for the day.",
    rows: [
      ["Bot in the call", "Never", "Its AI Meeting Agent can join Zoom, Teams and Meet calls; recording without a bot is also offered (desktop app, Chrome)"],
      ["Price", PRODLI_PRICE, "Basic free; Pro $16.99 a month, or $8.33 a month billed yearly; Business $30 a month, or $19.99 a month billed yearly (per user)"],
      ["Free plan", "20 AI meeting summaries and 300 minutes of AI audio transcription a month; Google Meet transcripts from captions don't use minutes; all your meetings stay available", "300 transcription minutes a month, up to 30 minutes per conversation, your 25 most recent conversations, 20 AI chat questions a month"],
      ["Where it records", "In Chrome: Google Meet, Zoom, Teams, Webex, Slack huddles and more in the browser, and in-person meetings (also on a phone at app.prodli.com). Mac and Windows app: coming soon", "Web, Chrome, Mac and Windows apps, iPhone and Android apps"],
      ["Ask questions across meetings", "Yes (Ask ProdLi: 100 questions a month free)", "Yes (AI Chat: 20 a month on Basic, 50 on Pro)"],
      ["Templates", "Built-in meeting types free; your own templates with Pro", "Advanced templates on Pro; AI meeting templates on Business"],
      ["Notes into tasks and your day", "Action items go to your to-dos; a daily brief plans your day around them and your calendar; habits and focus tools in the same tab", "Action items captured and assigned; pre-call briefings"],
      ["Integrations", "Two-way Google Calendar; a read-only personal API and MCP server (for Claude, ChatGPT and other AI tools); imports from Notion, Evernote, Google Keep, Todoist, TickTick and Google Tasks; Markdown and PDF export, share links", "Many, including Slack, Salesforce, HubSpot, Notion, Jira, Asana and Zapier"],
      ["Teams", "Personal accounts", "Workspaces; SSO and SCIM on Enterprise"],
    ],
    different: [
      ["No bot, ever", "Nothing joins your calls, so there's nothing for clients or interviewees to notice or block."],
      ["Lower price", "Pro is $5 a month or $48 a year. Otter Pro is $16.99 a month, or $8.33 a month billed yearly."],
      ["Longer meetings and full history on the free plan", "Google Meet notes come from captions, so there's no 30-minute cap or minute count for them, and all your meetings stay available."],
      ["Notes that run your day", "Action items become to-dos, and each morning's brief plans your day around them and your calendar."],
    ],
    stronger: [
      "Apps on every platform, including desktop and phone apps today.",
      "A live transcript and coaching during the call (ProdLi's coach works after the call, on Pro).",
      "A long list of integrations, from Slack to Salesforce.",
      "Team workspaces and enterprise features (SSO, SCIM, HIPAA add-on).",
    ],
    pickThem: "Choose Otter if your team needs a shared meeting assistant with CRM integrations and apps everywhere. Choose ProdLi if you don't want a bot in your calls, work mostly in Chrome, and want your notes to plan your day for less.",
    faq: [
      ["Is ProdLi an Otter alternative without a bot?", "Yes. ProdLi never joins your calls. It takes notes in your own browser, from Google Meet's captions or the call's sound on your computer."],
      ["Does ProdLi have a phone app like Otter?", "You can record in-person meetings on your phone in the browser at app.prodli.com. Native iPhone and Android apps aren't out yet."],
      ["Can ProdLi transcribe uploaded audio files?", "Yes. ⬆ Upload recording in Meetings takes an audio or video file (up to 500 MB or 3 hours) and makes a transcript, summary and action items. You can also bring in transcripts exported from Otter, Fireflies, Granola, Zoom or Teams (.vtt, .srt, .txt)."],
    ],
    sources: [
      ["Otter pricing", "https://otter.ai/pricing"],
      ["Otter home page", "https://otter.ai/"],
    ],
  },
  tactiq: {
    name: "Tactiq",
    h1: "ProdLi vs Tactiq",
    intro:
      "Tactiq and ProdLi are both Chrome extensions that take meeting notes without a bot. Tactiq focuses on live transcripts and AI workflows for teams. ProdLi gives you more AI summaries for free, records in-person meetings, and turns your notes into your plan for the day.",
    rows: [
      ["Bot in the call", "No", "No"],
      ["Price", PRODLI_PRICE, "Free; Pro $8, Team $16.67, Business $29.17 per user a month, billed yearly"],
      ["Free plan", "20 AI meeting summaries and 300 minutes of AI audio transcription a month; no monthly limit on Google Meet transcripts", "10 transcripts and 5 AI credits a month (one credit is one summary, action-item list or question)"],
      ["Where it records", "In Chrome: Google Meet, Zoom, Teams, Webex, Slack huddles and more in the browser, and in-person meetings (also on a phone at app.prodli.com). Mac and Windows app: coming soon", "Chrome and Edge extension for Google Meet, Zoom and Microsoft Teams"],
      ["Audio", "Google Meet: nothing recorded, notes come from Meet's captions. Other calls: saved on your computer, sent for transcription, not kept on ProdLi's servers", "Doesn't record or store audio; the transcript is saved as text"],
      ["Ask questions across meetings", "Yes (Ask ProdLi: 100 questions a month free)", "Ask AI custom questions (uses AI credits)"],
      ["Notes into tasks and your day", "Action items go to your to-dos; a daily brief plans your day around them and your calendar; habits and focus tools in the same tab", "Action items; AI workflows that send notes to other tools"],
      ["Integrations", "Two-way Google Calendar; a read-only personal API and MCP server (for Claude, ChatGPT and other AI tools); imports from Notion, Evernote, Google Keep, Todoist, TickTick and Google Tasks; Markdown and PDF export, share links", "Slack, Notion, Linear, HubSpot and more; AI workflows"],
      ["Teams", "Personal accounts", "Team, Business and Enterprise plans; SSO on Business"],
    ],
    different: [
      ["More AI for free", "20 meeting summaries and 100 Ask ProdLi questions a month on the free plan, compared with 5 AI credits."],
      ["In-person meetings", "Record a meeting in the room on your laptop, or on your phone at app.prodli.com."],
      ["Notes that run your day", "Action items become to-dos, and each morning's brief plans your day around them and your calendar."],
      ["Simple pricing", "Pro is $5 a month or $48 a year, and you can pay monthly."],
    ],
    stronger: [
      "Never records audio on any platform; ProdLi records the call's sound for Zoom, Teams and other non-Meet calls.",
      "Integrations and AI workflows (Slack, Notion, Linear, HubSpot).",
      "Team plans with shared transcripts and SSO.",
      "Works in Microsoft Edge as well as Chrome.",
    ],
    pickThem: "Choose Tactiq if your team wants live transcripts that flow into Slack, Notion or a CRM. Choose ProdLi if you want more AI summaries for free, notes for in-person meetings too, and a new tab that plans your day with them.",
    faq: [
      ["Is ProdLi a Tactiq alternative?", "Yes. Both are Chrome extensions with no bot. ProdLi adds in-person recording, more free AI summaries, and a daily planner built from your notes."],
      ["How does ProdLi take notes on Google Meet?", "From Meet's own live captions, in your browser. Nothing is recorded, and only the transcript text is sent to write the summary."],
      ["What about Zoom and Teams?", "ProdLi records the call's sound on your computer and transcribes it with AI after the call. The audio isn't kept on ProdLi's servers."],
    ],
    sources: [
      ["Tactiq pricing", "https://tactiq.io/pricing"],
      ["Tactiq home page", "https://tactiq.io/"],
      ["Tactiq: large language models and privacy", "https://help.tactiq.io/en/articles/7907775-large-language-models-gpt-openai-privacy-and-tactiq"],
    ],
  },
};

const wrap: CSSProperties = { maxWidth: 960, margin: "0 auto", padding: "0 24px" };
const h2: CSSProperties = { fontWeight: 900, fontSize: "clamp(22px, 3.5vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 20px" };
const body: CSSProperties = { fontSize: 15, lineHeight: 1.7, color: "#5a3e20" };
const cell: CSSProperties = { border: "2px solid #000", padding: "12px 14px", fontSize: 14, lineHeight: 1.55, verticalAlign: "top", textAlign: "left" };

export function ComparePage({ competitor }: { competitor: Competitor }) {
  const c = COMPARISONS[competitor];
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return (
    <Shell>
      <section className="site-hero" style={{ borderBottom: "var(--border)", padding: "56px 24px 48px", textAlign: "center" }}>
        <div style={{ border: "var(--border)", background: "var(--yellow)", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", padding: "4px 14px", display: "inline-block", boxShadow: "var(--shadow-sm)", marginBottom: 22 }}>
          Comparison · Prices checked {CHECKED}
        </div>
        <h1 style={{ fontWeight: 900, fontSize: "clamp(32px, 5.5vw, 56px)", lineHeight: 1.05, letterSpacing: "-0.03em", margin: "0 auto 18px" }}>{c.h1}</h1>
        <p style={{ ...body, fontSize: 17, maxWidth: 680, margin: "0 auto 28px" }}>{c.intro}</p>
        <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 14, padding: "16px 32px" }}>
          Try ProdLi free →
        </a>
      </section>

      <section className="site-section" style={{ padding: "48px 0", borderBottom: "var(--border)" }}>
        <div style={wrap}>
          <h2 style={h2}>Side by side</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, background: "#fff" }} data-testid="compare-table">
              <thead>
                <tr>
                  <th style={{ ...cell, width: "22%", background: "#000", color: "#fff" }} scope="col">
                    Compared
                  </th>
                  <th style={{ ...cell, background: "var(--yellow)", fontWeight: 900 }} scope="col">ProdLi</th>
                  <th style={{ ...cell, background: "#f3f0e8", fontWeight: 900 }} scope="col">{c.name}</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map(([topic, ours, theirs]) => (
                  <tr key={topic}>
                    <th scope="row" style={{ ...cell, fontWeight: 800, background: "#faf7f0" }}>{topic}</th>
                    <td style={cell}>{ours}</td>
                    <td style={cell}>{theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="site-section" style={{ padding: "48px 0", borderBottom: "var(--border)" }}>
        <div style={{ ...wrap, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
          <div>
            <h2 style={h2}>Where ProdLi is different</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {c.different.map(([title, desc]) => (
                <div key={title} className="nb-card" style={{ padding: "16px 18px", boxShadow: "var(--shadow-sm)" }}>
                  <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 6 }}>{title}</div>
                  <p style={{ ...body, fontSize: 14 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 style={h2}>Where {c.name} is stronger</h2>
            <ul style={{ ...body, fontSize: 14, paddingLeft: 20, margin: 0, display: "grid", gap: 10 }}>
              {c.stronger.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p style={{ ...body, fontSize: 14, marginTop: 20, fontWeight: 600 }}>{c.pickThem}</p>
          </div>
        </div>
      </section>

      <section className="site-section" style={{ padding: "48px 0", borderBottom: "var(--border)" }}>
        <div style={{ ...wrap, maxWidth: 760 }}>
          <h2 style={h2}>Questions</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {c.faq.map(([q, a]) => (
              <details key={q} className="nb-card" style={{ padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
                <summary style={{ fontWeight: 800, fontSize: 15, cursor: "pointer" }}>{q}</summary>
                <p style={{ ...body, fontSize: 14, marginTop: 10 }}>{a}</p>
              </details>
            ))}
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }} />
        </div>
      </section>

      <section className="site-section" style={{ padding: "40px 0 56px" }}>
        <div style={{ ...wrap, maxWidth: 760 }}>
          <h2 style={{ ...h2, fontSize: 18 }}>Sources</h2>
          <p style={{ ...body, fontSize: 13 }}>
            {c.name} details come from {c.name}'s own website, checked on {CHECKED}. Prices and plans change, so check their site for the latest. Spotted something out of date? Tell us at{" "}
            <a href="mailto:contact@prodli.com" style={{ textDecoration: "underline" }}>
              contact@prodli.com
            </a>{" "}
            and we'll fix it.
          </p>
          <ul style={{ ...body, fontSize: 13, paddingLeft: 20, marginTop: 10 }}>
            {c.sources.map(([label, url]) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: "underline" }}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p style={{ ...body, fontSize: 12, marginTop: 16, color: "var(--muted)" }}>
            {c.name} is a trademark of its owner. ProdLi isn't affiliated with or endorsed by {c.name}.
          </p>
        </div>
      </section>
    </Shell>
  );
}
