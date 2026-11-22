// prodli.com/ai-meeting-notes and one page per kind of meeting (Google Meet,
// Zoom, Teams, in person). They answer what people search for ("google meet
// transcript", "zoom notes without bot") with how ProdLi actually works there.
// Keep every claim true to the product: check the extension's store
// description (STORE_SUBMISSION.md) when the recorder changes.

import type { CSSProperties } from "react";
import { CHROME_STORE_URL, MEETING_LINKS, Shell } from "../components/Shell";

type Kind = "google-meet" | "zoom" | "teams" | "in-person";

interface Topic {
  badge: string;
  h1: [string, string];
  intro: string;
  steps: [string, string][];
  privacy: string;
  faq: [string, string][];
  primary: { label: string; href: string };
}

const COMMON_OUTPUT: [string, string][] = [
  ["📝", "The full transcript, with timestamps"],
  ["✨", "A summary, decisions, action items and open questions"],
  ["🧩", "Shaped by the meeting type: 1:1, interview, sales call, stand-up, or your own template"],
  ["✅", "Action items go to your to-dos in one click"],
  ["✉️", "A follow-up email drafted from the summary"],
  ["🔗", "Share the notes as a read-only link with people who weren't there"],
];

const FREE_FAQ: [string, string] = [
  "Is it free?",
  "Yes. The free plan includes 20 AI meeting summaries and 300 minutes of AI audio transcription a month. ProdLi Pro raises the limits and adds your own templates, action items and decisions across all your meetings, meeting prep and more.",
];
const CONSENT_FAQ: [string, string] = [
  "Do I have to tell people I'm taking notes?",
  "Often, yes: many places require everyone's consent to record or transcribe a call. ProdLi's 📋 Copy heads-up button copies a short message saying you're taking AI notes, ready to paste in the meeting chat.",
];

const TOPICS: Record<Kind, Topic> = {
  "google-meet": {
    badge: "Google Meet · Chrome extension · Free",
    h1: ["Google Meet transcripts and AI notes,", "with no bot"],
    intro:
      "ProdLi reads Google Meet's own live captions in your browser and turns them into a full transcript, summary and action items when the call ends. Nobody else sees anything, no bot joins, and no audio is uploaded.",
    steps: [
      ["Add ProdLi to Chrome", "Free. Turn on the recorder in Meetings › Setup."],
      ["Join the Meet call and click the ProdLi icon", "Turn on captions (CC) in Meet. ProdLi captures them as people speak, in any Meet language."],
      ["Get your notes", "When the call ends: transcript, summary, decisions and action items, ready in your new tab."],
    ],
    privacy:
      "On Google Meet, ProdLi works from the captions already on your screen, so no audio leaves your computer. Only the transcript text is sent to write the summary. If captions are off for part of a call, ProdLi can fill the gaps with Chrome's on-device speech recognition.",
    faq: [
      ["Does a bot join my Google Meet call?", "No. ProdLi runs in your own Chrome tab and reads the captions Meet shows you. The other people in the call see nothing."],
      ["Does it work without a Google Workspace plan?", "Yes. It works on any Google Meet call you join in Chrome, including with a free Gmail account."],
      ["What if captions are off?", "Turn on CC in Meet for a transcript. With on-device transcription on, ProdLi fills gaps while captions are off, marked “on device”."],
      FREE_FAQ,
      CONSENT_FAQ,
    ],
    primary: { label: "Add to Chrome, it's free →", href: CHROME_STORE_URL },
  },
  zoom: {
    badge: "Zoom · No bot · Free to start",
    h1: ["Zoom meeting notes", "without a bot"],
    intro:
      "Skip the notetaker bot. ProdLi records the Zoom call's sound on your own computer and writes the transcript, summary and action items when it ends: in Chrome for Zoom in the browser, or in the Zoom app with ProdLi for Mac and Windows.",
    steps: [
      ["Add ProdLi to Chrome", "Free. Turn on the recorder in Meetings › Setup, and “Include my microphone” so your side is in the transcript too."],
      ["Join the Zoom call in your browser and click the ProdLi icon", "Using the Zoom app instead? ProdLi for Mac and Windows records calls in any app."],
      ["Get your notes", "After the call, the audio is transcribed with AI (including calls where people switch languages) and summarized."],
    ],
    privacy:
      "The recording is saved on your computer. It's sent for transcription by an open speech model when the call ends (you can turn that off and transcribe only when you choose), and the audio isn't kept on ProdLi's servers.",
    faq: [
      ["Does a bot join my Zoom meeting?", "No. Nothing joins the call. ProdLi records the sound of the call on your own computer, like a voice memo."],
      ["Does it work with the Zoom desktop app?", "In Chrome, ProdLi records Zoom in the browser. For the Zoom app, use ProdLi for Mac and Windows (prodli.com/download), which records calls in any app."],
      ["Can it spell names and jargon correctly?", "Yes. Add names and terms to your word list and ProdLi uses them when it transcribes and summarizes."],
      FREE_FAQ,
      CONSENT_FAQ,
    ],
    primary: { label: "Add to Chrome, it's free →", href: CHROME_STORE_URL },
  },
  teams: {
    badge: "Microsoft Teams · No bot · Free to start",
    h1: ["Microsoft Teams meeting notes,", "no bot needed"],
    intro:
      "Get AI notes for Teams calls without inviting a bot or waiting for an admin. ProdLi records the call on your own computer and writes the transcript, summary, decisions and action items: in Chrome for Teams on the web, or in the Teams app with ProdLi for Mac and Windows.",
    steps: [
      ["Add ProdLi to Chrome", "Free. Turn on the recorder in Meetings › Setup, and “Include my microphone”."],
      ["Join the Teams call in your browser and click the ProdLi icon", "Using the Teams app? ProdLi for Mac and Windows records calls in any app."],
      ["Get your notes", "After the call: transcript, summary, decisions and action items, sorted by meeting type."],
    ],
    privacy:
      "The recording is saved on your computer and sent for transcription by an open speech model when the call ends (or only when you choose). The audio isn't kept on ProdLi's servers.",
    faq: [
      ["Does it need a Teams admin or a Copilot licence?", "No. ProdLi works on your own computer, for your own notes, without anything installed in Teams."],
      ["Does a bot join the Teams meeting?", "No. Nothing joins the call and nobody else sees ProdLi."],
      ["Does it work with Webex, Slack huddles and Discord too?", "Yes, in the browser: Webex, Slack huddles, Discord, Jitsi and Whereby (or any website, if you turn that on)."],
      FREE_FAQ,
      CONSENT_FAQ,
    ],
    primary: { label: "Add to Chrome, it's free →", href: CHROME_STORE_URL },
  },
  "in-person": {
    badge: "In the room · Laptop or phone · Free to start",
    h1: ["AI notes for", "in-person meetings"],
    intro:
      "Put your laptop or phone on the table and press Record. ProdLi writes the transcript, summary, decisions and action items when you stop. On a phone it works in the browser at app.prodli.com, with no app to install.",
    steps: [
      ["Open Meetings", "In the Chrome extension, or at app.prodli.com on your phone (add it to your home screen)."],
      ["Press 🎙 Record in person", "Keep the device somewhere it can hear everyone."],
      ["Stop and get your notes", "The recording is transcribed with AI and summarized, and the action items can go straight to your to-dos."],
    ],
    privacy:
      "The recording is sent for transcription by an open speech model when you stop, and the audio isn't kept on ProdLi's servers. Your notes sync to your own private space if you sign in.",
    faq: [
      ["Does it work on my phone?", "Yes. Open app.prodli.com, sign in, and use 🎙 Record in person on the Meetings page."],
      ["What languages does it understand?", "The speech model detects the language, and handles meetings where people switch between languages."],
      FREE_FAQ,
      CONSENT_FAQ,
    ],
    primary: { label: "Add to Chrome, it's free →", href: CHROME_STORE_URL },
  },
};

const wrap: CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "0 24px" };
const h2: CSSProperties = { fontWeight: 900, fontSize: "clamp(22px, 3.5vw, 32px)", letterSpacing: "-0.02em", margin: "0 0 24px" };
const body: CSSProperties = { fontSize: 15, lineHeight: 1.7, color: "#5a3e20" };

function FaqJsonLd({ faq }: { faq: [string, string][] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

function Hero({ badge, h1, intro, primary }: Pick<Topic, "badge" | "h1" | "intro" | "primary">) {
  return (
    <section className="site-hero" style={{ borderBottom: "var(--border)", padding: "64px 24px 56px", textAlign: "center" }}>
      <div style={{ border: "var(--border)", background: "var(--yellow)", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", padding: "4px 14px", display: "inline-block", boxShadow: "var(--shadow-sm)", marginBottom: 24 }}>{badge}</div>
      <h1 style={{ fontWeight: 900, fontSize: "clamp(32px, 5.5vw, 58px)", lineHeight: 1.05, letterSpacing: "-0.03em", maxWidth: 820, margin: "0 auto 20px" }}>
        {h1[0]} <span style={{ background: "var(--yellow)", padding: "0 10px" }}>{h1[1]}</span>
      </h1>
      <p style={{ ...body, fontSize: 17, maxWidth: 640, margin: "0 auto 32px" }}>{intro}</p>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
        <a href={primary.href} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 14, padding: "16px 32px" }}>
          {primary.label}
        </a>
        <a href="/download" className="nb-btn nb-btn-ghost" style={{ fontSize: 14, padding: "16px 24px" }}>
          Mac &amp; Windows app
        </a>
      </div>
    </section>
  );
}

function Faq({ faq }: { faq: [string, string][] }) {
  return (
    <section className="site-section" style={{ padding: "56px 0", borderBottom: "var(--border)" }}>
      <div style={wrap}>
        <h2 style={h2}>Questions</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {faq.map(([q, a]) => (
            <details key={q} className="nb-card" style={{ padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
              <summary style={{ fontWeight: 800, fontSize: 15, cursor: "pointer" }}>{q}</summary>
              <p style={{ ...body, fontSize: 14, marginTop: 10 }}>{a}</p>
            </details>
          ))}
        </div>
        <FaqJsonLd faq={faq} />
      </div>
    </section>
  );
}

function MoreLinks({ current }: { current: string }) {
  return (
    <section className="site-section" style={{ padding: "48px 0 64px" }}>
      <div style={wrap}>
        <h2 style={{ ...h2, fontSize: 20 }}>Notes for every meeting</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {MEETING_LINKS.filter(([href]) => href !== current).map(([href, label]) => (
            <a key={href} href={href} className="nb-btn nb-btn-ghost" style={{ fontSize: 12, padding: "10px 18px" }}>
              {label} →
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MeetingNotesTopic({ kind }: { kind: Kind }) {
  const t = TOPICS[kind];
  return (
    <Shell>
      <Hero badge={t.badge} h1={t.h1} intro={t.intro} primary={t.primary} />

      <section className="site-section" style={{ padding: "56px 0", borderBottom: "var(--border)", background: "#000" }}>
        <div style={wrap}>
          <h2 style={{ ...h2, color: "#fff" }}>How it works</h2>
          <div className="steps-grid">
            {t.steps.map(([title, desc], i) => (
              <div key={title} style={{ border: "2px solid #333", padding: "24px 22px", background: "#111" }}>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 34, color: "var(--yellow)", lineHeight: 1, marginBottom: 14 }}>0{i + 1}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", marginBottom: 8 }}>{title}</div>
                <p style={{ fontSize: 13, color: "#999", lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section" style={{ padding: "56px 0", borderBottom: "var(--border)" }}>
        <div style={wrap}>
          <h2 style={h2}>What you get after every call</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {COMMON_OUTPUT.map(([emoji, text]) => (
              <li key={text} className="nb-card" style={{ padding: "16px 18px", boxShadow: "var(--shadow-sm)", fontSize: 14, fontWeight: 600, display: "flex", gap: 10 }}>
                <span aria-hidden="true">{emoji}</span>
                {text}
              </li>
            ))}
          </ul>
          <p style={{ ...body, marginTop: 24 }}>
            Then the notes keep working: your daily brief in every new tab preps you for meetings you've had before (what you covered last time and what's still open), and Ask ProdLi answers questions like “What did we decide on Monday?”
          </p>
        </div>
      </section>

      <section className="site-section" style={{ padding: "56px 0", borderBottom: "var(--border)", background: "var(--yellow)" }}>
        <div style={{ ...wrap, maxWidth: 720 }}>
          <h2 style={{ ...h2, color: "#000" }}>Private by design</h2>
          <p style={{ ...body, color: "#3a2a00" }}>{t.privacy}</p>
          <p style={{ ...body, color: "#3a2a00", marginTop: 12 }}>
            No ads, and your data is never sold. Download or delete everything any time. <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy policy</a>
          </p>
        </div>
      </section>

      <Faq faq={t.faq} />
      <MoreLinks current={`/ai-meeting-notes/${kind}`} />
    </Shell>
  );
}

const HUB_CARDS: { kind: Kind; title: string; desc: string }[] = [
  { kind: "google-meet", title: "Google Meet", desc: "From Meet's own captions, in your browser. No audio uploaded." },
  { kind: "zoom", title: "Zoom", desc: "Records the call on your computer: Zoom in Chrome, or the Zoom app with the desktop app." },
  { kind: "teams", title: "Microsoft Teams", desc: "No admin, no Copilot licence, no bot. Plus Webex, Slack huddles and Discord." },
  { kind: "in-person", title: "In person", desc: "Record on your laptop or phone, at app.prodli.com." },
];

const HUB_FAQ: [string, string][] = [
  ["How is this different from a meeting bot?", "A bot joins the call as a participant, so everyone sees it and some companies block it. ProdLi works on your own computer, like taking notes yourself, so there's nothing to admit and nothing for others to see."],
  ["Where do my notes go?", "Into ProdLi's Meetings page, and into your day: action items can become to-dos, tomorrow's brief lists what's still open, and you can ask questions across all your meetings with Ask ProdLi."],
  FREE_FAQ,
  CONSENT_FAQ,
];

export function MeetingNotesHub() {
  return (
    <Shell>
      <Hero
        badge="Meet · Zoom · Teams · In person"
        h1={["AI meeting notes,", "without the bot"]}
        intro="ProdLi writes the transcript, summary, decisions and action items for your calls and meetings from your own computer. Nothing joins the call. Then it turns the notes into your plan for the day, in every new tab."
        primary={{ label: "Add to Chrome, it's free →", href: CHROME_STORE_URL }}
      />
      <section className="site-section" style={{ padding: "56px 0", borderBottom: "var(--border)" }}>
        <div style={wrap}>
          <h2 style={h2}>Pick your meeting</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
            {HUB_CARDS.map((c) => (
              <a key={c.kind} href={`/ai-meeting-notes/${c.kind}`} className="nb-card" style={{ padding: "22px 22px", boxShadow: "var(--shadow)", display: "block" }}>
                <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>{c.title} →</div>
                <p style={{ ...body, fontSize: 14 }}>{c.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </section>
      <Faq faq={HUB_FAQ} />
    </Shell>
  );
}
