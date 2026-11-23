import { useEffect } from "react";
import { Logo } from "./Logo";
import { accountsEnabled } from "../lib/prodliAccount";
import { SECTIONS } from "../sections/registry";

/** The extension's version (or the web app's, which ships with the same code). */
export const version = () => (typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "1.4.0");

interface HelpModalProps {
  /** Inside Settings: just the content, no window around it. */
  embedded?: boolean;
  onClose?: () => void;
}


function Section({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
        borderBottom: "var(--nb-border)", paddingBottom: 8,
      }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <span style={{ fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, desc }: { label: React.ReactNode; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 7, alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, minWidth: 140 }}>{label}</div>
      <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-block", border: "var(--nb-border)", background: "hsl(var(--card))",
      padding: "1px 7px", fontSize: 11, fontWeight: 700, fontFamily: "Space Mono, monospace",
      marginRight: 3, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function ShortcutRow({ keys, action }: { keys: string[]; action: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 0", borderBottom: "1px solid var(--nb-section-border)" }}>
      <div style={{ minWidth: 190 }}>
        {keys.map(k => <Tag key={k}>{k}</Tag>)}
      </div>
      <div style={{ fontSize: 12, color: "hsl(var(--foreground))", fontWeight: 600 }}>{action}</div>
    </div>
  );
}

export function HelpModal({ onClose = () => {}, embedded = false }: HelpModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !embedded) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, embedded]);

  const content = (
    <>
        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "28px 32px" }}>

          {/* Welcome */}
          <div style={{
            border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)",
            background: "#FFD700", color: "#000",
            padding: "14px 20px", marginBottom: 28,
          }}>
            <div style={{ fontWeight: 900, fontSize: 16, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Welcome to ProdLi</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, lineHeight: 1.5 }}>
              Your personal assistant and productivity tools in one place: {SECTIONS.map((x) => x.label).join(", ")}. Press <strong>Ctrl/⌘ + K</strong> to go anywhere or do anything, and <strong>✨ Ask ProdLi</strong> about your day.
              {accountsEnabled() ? " Works offline and without an account; sign in to sync between devices and app.prodli.com." : " Your data stays in this browser."}
            </div>
          </div>

          {/* Editor */}
          <Section emoji="✨" title="Ask ProdLi">
            <Row label={<Tag>Sources</Tag>} desc="Answers list the notes and meetings they used; click one to open it." />
            <Row label={<Tag>☆ Save prompt</Tag>} desc="Save a question to ask again from ★ Saved prompts. With 🕒 you can run it on chosen days at a time; the answer arrives as a notification (each run uses one question; extension)." />
          </Section>

          <Section emoji="🗓" title="Day view (timeboxing)">
            <Row label={<Tag>📅 Blocks in Google Calendar</Tag>} desc="Today → Agenda → Show blocks in Google Calendar: ProdLi puts your time blocks (today and the next 7 days) in its own “ProdLi” calendar. Move or resize one in Google Calendar and ProdLi follows; delete it there and the task is unblocked. ProdLi can only change the calendar it creates." />
            <Row label={<Tag>🌿 Now</Tag>} desc="While a time block is on, Today shows it at the top with a big countdown, its steps and ✓ Done / +5 min. ✨ Break it down asks ProdLi's AI for a few small steps you can add (signed in; a writing-help use). Between blocks it shows what's next." />
            <Row label={<Tag>Day / List</Tag>} desc="Today → Agenda shows your day as a timeline. Drag a task from To place onto it to block time, drag a block to move it, drag its bottom edge to change its length, or drag it back to To place to unblock it. Times snap to 15 minutes." />
            <Row label={<Tag>Keyboard</Tag>} desc="Enter on a task places it in the next free time. On a block: ↑/↓ move it 15 minutes, Shift + ↑/↓ change its length, Delete unblocks it." />
          </Section>

          <Section emoji="🗒" title="Meeting prep">
            <Row label={<Tag>Prep reminders · Pro</Tag>} desc="10 minutes before a meeting that has prep on Today, a notification with its open items and when you last met; click it to open Today. Turn off in Settings → Today & planning (extension)." />
            <Row label={<Tag>✨ Prep with AI · Pro</Tag>} desc="On a meeting prep card: a short AI brief for that meeting (goal, where things stand, what to follow up on, questions to ask, a suggested agenda) from your earlier meetings with those people. Uses your monthly AI briefs." />
            <Row label={<Tag>Today</Tag>} desc="With Google Calendar connected, Today shows prep for your upcoming meetings: what you covered last time, open action items (+ To-do adds one) and your to-dos that mention the people. ProdLi matches earlier recorded meetings by the same Meet link, title or people, on this device. The daily brief adds a line for each." />
          </Section>

          <Section emoji="📊" title="Focus score & site categories">
            <Row label={<Tag>Focus trends · Pro</Tag>} desc="Time Tracker → Today: your focus score over the last 30 or 90 days, the average, the change from the period before, and your biggest distraction." />
            <Row label={<Tag>Focus score</Tag>} desc="Time Tracker → Today: productive time out of productive + distracting browsing (0–100), once there are 10 minutes of either. Email and chat count as neutral." />
            <Row label={<Tag>Categories</Tag>} desc="Well-known sites get a category (Work & tools, Learning, AI tools, Email & chat, News, Social media, Video & games, Shopping). Change any site's category with the picker next to it. Categories stay on this device." />
            <Row label={<Tag>Brief & review</Tag>} desc="The daily brief uses yesterday's score; the weekly review shows the week's score and time per category, AI tools included." />
          </Section>

          <Section emoji="🔎" title="Search & quick links">
            <Row label={<Tag>Search</Tag>} desc="The box at the top of Today searches with your default search engine (or opens an address you type)." />
            <Row label={<Tag>+ Link / Edit</Tag>} desc="Add up to 16 links as tiles. In Edit, click a tile to rename it or × to remove it. Links sync with your account." />
          </Section>

          <Section emoji="📚" title="Read later & page summaries">
            <Row label={<Tag>Read later</Tag>} desc="Right-click a page or link → Read later in ProdLi (or pick 📚 Later in Quick add, or paste a link on Today). Opening it marks it read." />
            <Row label={<Tag>Summarize page</Tag>} desc="Right-click a page → Summarize page to ProdLi notes: a note with the source, a short summary and key points (uses writing help; signed out, you get an excerpt). ProdLi reads only that page, only when you click." />
            <Row label={<Tag>Save highlight</Tag>} desc="Select text on a page, right-click → Save highlight to ProdLi. It's added as a quote with a link to that page's note (its summary note, or a new Highlights note)." />
            <Row label={<Tag>+ To-do</Tag>} desc="On a Read later item, + To-do adds “Read: page title” with the link to your to-dos." />
            <Row label={<Tag>Listen</Tag>} desc="▶ on a Read later item with a saved note, or ⋯ → Listen in any note, reads it aloud with your browser's voices. Pick the voice and speed (0.75–2×); it stops when you leave the note." />
          </Section>

          <Section emoji="🗂" title="Saved tabs">
            <Row label={<Tag>Save this window</Tag>} desc="On Today: saves this window's web pages (and closes them if you like). Open all brings them back in a new window; ▸ lists them to open one. Also in ⌘K: “Save open tabs and close them”. Synced and backed up with your account." />
          </Section>

          <Section emoji="🎙" title="Voice dictation">
            <Row label={<Tag>Alt+Shift+D</Tag>} desc="In any text box on any website (or in ProdLi): hold the shortcut and talk, then let go — or tap it to start and tap again (or ✓) to finish. Esc cancels. ProdLi writes what you said where your cursor is, cleaned up: no “um”s or false starts, your corrections applied (“Tuesday — no, Wednesday”), punctuation and lists added. Turn it on in Settings → Dictation." />
            <Row label={<Tag>Styles</Tag>} desc="Each kind of website gets its own tone: formal for email, casual for work chat, very casual for personal messages (Settings → Dictation)." />
            <Row label={<Tag>Command Mode · Pro</Tag>} desc="Select text, press the shortcut and say what to do: “make this more formal”, “turn this into bullet points”, “translate to Spanish”. ProdLi replaces the selection." />
            <Row label={<Tag>Dictionary & snippets</Tag>} desc="Names and terms are spelled as in your word list (shared with meeting notes). Snippets: say a cue like “my calendar link” to type saved text." />
            <Row label={<Tag>History</Tag>} desc="Settings → Dictation keeps your last 50 dictations on this device (copy any of them) and shows words this week, your speaking speed and time saved." />
          </Section>

          <Section emoji="✍️" title="Editor">
            <Row label={<Tag>⋮⋮ Blocks</Tag>} desc="Hover any block: + adds a block below (with the / menu), ⋮⋮ drags it to a new place, or click ⋮⋮ for Turn into, Colour, Duplicate, Move up/down and Delete. Keyboard: Alt+Shift+↑/↓ moves the block, Ctrl/⌘+D duplicates it." />
            <Row label={<Tag>Callouts & toggles</Tag>} desc="/ → Callout for a tinted box with an icon (click the icon to change it and its colour). / → Toggle list hides details under a line; click ▸ to open or close it." />
            <Row label={<Tag>[[ Link a note</Tag>} desc="Type [[ and a note's name (or / → Link to note) to link another note; click the link to open it. If no note matches, pick New note to make one. Links follow renames." />
            <Row label={<Tag>Colours</Tag>} desc="Select text, then A in the bubble for a text or background colour. Colours adjust for dark mode." />
            <Row label={<Tag>Icon & cover</Tag>} desc="Hover the top of a note: Add icon (click it to pick another) and Add cover. The icon also shows in the notes list." />
            <Row label={<Tag>▾ Templates</Tag>} desc="New note from a template: Meeting notes, Daily note, Weekly plan, Project brief, 1:1, Decision record, or your own (⋯ → Save as template). Templates can use {{date}}, {{weekday}} and {{time}}." />
            <Row label={<Tag>📅 Daily note</Tag>} desc="Opens today's note, created once a day with your main focus and planned tasks. Make your own template called “Daily note” to change its layout. Also in ⌘K." />
            <Row label={<Tag>/ commands</Tag>} desc="Type / anywhere to insert headings, checklists, bullet or numbered lists, tables, quotes, code blocks, dividers, highlights, today's date or the time. Use ↑ ↓ and Enter, or keep typing to filter." />
            <Row label={<Tag>Select text</Tag>} desc="A small menu appears over selected text for bold, italic, underline, strikethrough, highlight, code and links." />
            <Row label={<Tag>✨ Improve</Tag>} desc="Select text, then click ✨ Improve (or press Ctrl/⌘+J) to fix spelling and grammar, make it shorter or clearer, or change the tone. You see the suggestion first; Replace is one undo step. Needs a ProdLi account (free)." />
            <Row label={<Tag>✍️ Writing style · Pro</Tag>} desc="Settings → Writing style: describe how you like to write (e.g. British English, friendly, short sentences). ✨ Improve (except Fix spelling) and follow-up emails follow it." />
            <Row label={<Tag>Checklists</Tag>} desc="Tick items off right in the note. Checklists survive Markdown import/export." />
            <Row label={<Tag>Tables</Tag>} desc="Insert with / or ▦. While the cursor is in a table, a Table bar lets you add or delete rows and columns, toggle the header row, or delete the table. Drag column edges to resize." />
            <Row label={<Tag>🔗 Links</Tag>} desc="Ctrl/⌘+K adds or edits a link (leave empty to remove). Plain click edits; Ctrl/⌘+click — or Open ↗ in the link menu — opens it." />
            <Row label={<Tag>Paste Markdown</Tag>} desc="Pasting Markdown text (headings, lists, checklists, bold, links) turns it into formatting automatically." />
            <Row label={<Tag>+ / Alt+N</Tag>} desc="New note. Untitled notes are named after their first line until you rename them." />
            <Row label={<Tag>⋯ menu</Tag>} desc="Pin to top, rename (or double-click the title), duplicate, or delete — with Undo." />
            <Row label={<Tag>Sort & search</Tag>} desc="Sort by recently edited, newest, or A–Z. Search matches titles and text, with an excerpt." />
            <Row label={<Tag>☰ Outline</Tag>} desc="Shows the note's headings; click one to jump there." />
            <Row label={<Tag>⋯ More</Tag>} desc="Copy as Markdown, import a .md file as a note, export the note as .md, or print / save as PDF." />
            <Row label={<Tag>⛶ Fullscreen</Tag>} desc="Hides the sidebar for distraction-free writing. Press Escape to exit." />
            <Row label={<Tag>Saving</Tag>} desc="Notes save automatically (the status bar shows Saving… / Saved). Edits in several ProdLi tabs are merged — nothing gets overwritten." />
          </Section>

          {/* To-Dos */}
          <Section emoji="✅" title="To-Dos">
            <Row label={<Tag>Add task</Tag>} desc="Type a task and press Enter. Words set the details: “tomorrow”, “next month”, “at 3pm”, “tonight”, “in 2 hours”, “every monday”, “every weekday”, “monthly”, “!high”, “#Work” (list) and “@errands” (label). The preview shows how it was read. Works in ⌘K and Quick add (Alt+Shift+A) too." />
            <Row label={<Tag>🎙 Speak tasks</Tag>} desc="Talk or paste a brain dump (“call mom tomorrow at 5, buy milk, the report's due Friday, urgent”). ProdLi finds the separate tasks; you check them before they're added, and can tick Plan these for today. Also in ⌘K, or press the dictation shortcut (Alt+Shift+D) in ProdLi when no text box is selected. Uses writing help when signed in; otherwise it splits sentences on this device." />
            <Row label={<Tag>⇩ Import</Tag>} desc="Bring to-dos from Todoist (project CSV or backup .zip), TickTick (backup CSV), Google Tasks (Takeout Tasks.json), any CSV (you pick the columns) or a Markdown checklist. Open it from ⇩ Import in To-Dos, Settings → Backup & data, or ⌘K. You see a preview first; lists come across as lists, and Undo removes everything the import added. Importing the same file again skips tasks already here. The file is read on this device." />
            <Row label={<Tag>▦ Board · ⊞ Matrix</Tag>} desc="Board: columns No date, Upcoming, Today and Done. Matrix: important (high priority) × urgent (overdue, due by tomorrow, or planned today). Drag a card, or use its Move to menu: moving changes the task's plan, date or priority, and Done completes it." />
            <Row label={<Tag>Lists & labels</Tag>} desc="The side panel has All, Inbox, Today, your lists, labels and saved filters. Add a list with +; ⋯ renames or deletes it. ☆ Save view keeps the current list, filter and search as a saved filter." />
            <Row label={<Tag>✎ Details</Tag>} desc="Edit a task's date, time (reminder), repeat, list, labels and priority. Completing a repeating task moves it to its next date." />
            <Row label={<Tag>⏰ Reminders</Tag>} desc="A task with a time gets a notification then, with Mark done and Snooze 10 min (extension). Turn off in Settings → Today & planning." />
            <Row label={<Tag>Double-click</Tag>} desc="Double-click any task title to edit it inline. Press Enter or click away to save." />
            <Row label={<Tag>⠿ Drag handle</Tag>} desc="Drag tasks to reorder them (available in All filter mode)." />
            <Row label={<Tag>Priority badge</Tag>} desc="HIGH (red), MEDIUM (orange), LOW (green). Shown inline on each task." />
            <Row label={<Tag>📅 Due date</Tag>} desc="Overdue dates are highlighted in red." />
            <Row label={<Tag>+ Subtask</Tag>} desc="Click the + button on a task row to add a subtask via prompt. Expand/collapse with ▼ / ▲." />
            <Row label={<Tag>Filter bar</Tag>} desc="Filter by All, Active, Completed, or by priority level (High / Medium / Low)." />
            <Row label={<Tag>Clear Completed</Tag>} desc="Removes all completed tasks in one click." />
          </Section>

          {/* Pomodoro */}
          <Section emoji="🍅" title="Pomodoro">
            <Row label={<Tag>Phase tabs</Tag>} desc="Choose FOCUS (default 25 min), SHORT BREAK (5 min), or LONG BREAK (15 min). Switching resets the timer." />
            <Row label={<Tag>▶ START / ⏸ PAUSE</Tag>} desc="Start or pause the current timer. It keeps running when you switch sections, open other tabs, or close ProdLi — every ProdLi tab shows the same timer." />
            <Row label={<Tag>↺ RESET</Tag>} desc="Reset the current phase timer back to its full duration." />
            <Row label={<Tag>⏭ SKIP</Tag>} desc="Skip the current phase and move to the next one automatically." />
            <Row label={<Tag>Task label</Tag>} desc="Click the dashed area to type what you're working on. Saved with each completed focus session in the Session Log." />
            <Row label={<Tag>🔥 Auto-advance</Tag>} desc={`After ${4} focus sessions, the timer suggests a long break automatically. A chime plays at the end of each phase.`} />
            <Row label={<Tag>🔔 Notify</Tag>} desc="In the Chrome extension you always get a desktop alert when a phase ends, even with ProdLi closed. In the web preview, click to allow browser notifications." />
            <Row label={<Tag>⚙ Settings</Tag>} desc="Customize Focus, Short Break, Long Break durations (in minutes), and how many focus sessions trigger a long break." />
            <Row label={<Tag>Session Log</Tag>} desc="Right panel shows your completed focus sessions with label, duration, and time. Limited to the 20 most recent." />
            <Row label={<Tag>🔴 Nav indicator</Tag>} desc="A blinking dot appears on the Pomodoro tab when the timer is running and you're viewing another section." />
            <Row label={<Tag>🚫 Block sites</Tag>} desc="Under the timer: block distracting sites while a focus session runs and during focus hours you set. A blocked site shows a pause screen with Close tab; Continue anyway waits 10 seconds, then allows 5 minutes (extension)." />
            <Row label={<Tag>🔒 Strict mode</Tag>} desc="In the block panel: no “Continue anyway”, and blocking can't be loosened while it's on (disabling the extension still gets around it)." />
          </Section>

          {/* Habits */}
          <Section emoji="🎯" title="Habits">
            <Row label={<Tag>Types</Tag>} desc="Check off (done or not), Count (e.g. 8 glasses: tap +1), Timed (e.g. 20 minutes: +5m) or Quit / limit (log a slip; the streak is days kept)." />
            <Row label={<Tag>Days & Skip</Tag>} desc="Pick the days a habit is due (gym on Mon/Wed/Fri). Days off, and days you Skip, never break the streak. Year shows the past year as a heatmap." />
            <Row label={<Tag>+ New Habit</Tag>} desc="Create a habit with a name, emoji icon, and color." />
            <Row label={<Tag>○ / ✓ button</Tag>} desc="Click to mark today as done (fills with the habit color). Click again to undo." />
            <Row label={<Tag>🔥 Streak</Tag>} desc="Counts consecutive days with a check-in. The streak badge appears once it reaches 2+ days." />
            <Row label={<Tag>5-Week strip</Tag>} desc="Shows the last 35 days as a horizontal bar — filled squares are days you checked in." />
            <Row label={<Tag>Monthly heatmap</Tag>} desc="Shows the current calendar month with filled cells for completed days. Today is highlighted." />
            <Row label={<Tag>✎ Edit</Tag>} desc="Change a habit's name, emoji, or color without losing its history." />
            <Row label={<Tag>⊘ Archive</Tag>} desc="Hides a habit without deleting its data. Restore from the Archived section at the bottom." />
          </Section>

          {/* Meetings */}
          <Section emoji="🎙️" title="Meetings">
            <Row label={<Tag>⚙ Setup</Tag>} desc="Turn on the recorder (Chrome asks for permission) and optionally include your microphone." />
            <Row label={<Tag>Record</Tag>} desc="On a Google Meet tab, click the ProdLi toolbar icon or press Alt+Shift+R. No bot joins the call. The transcript comes from Meet's captions (CC), which ProdLi turns on for you and only you can see — if captions are off, only audio is recorded and the icon shows an amber CC." />
            <Row label={<Tag>🎙 Record in person</Tag>} desc="For a meeting in the room (or a voice note): Meetings → 🎙 Record in person records from your microphone, in the extension or at app.prodli.com on your phone. Keep the tab open; you can switch sections. On Stop it's transcribed with AI (signed in) or by on-device transcription, then summarized. If the tab closes mid-recording, the audio up to then is kept." />
            <Row label={<Tag>⬆ Upload recording</Tag>} desc="Have a recording already (a voice memo, a recorder's export, a Zoom recording, a video)? Meetings → ⬆ Upload recording, or drop the file on Meetings. Give it a title and date; ProdLi transcribes it with AI and writes notes, like a recorded call. MP3, M4A, WAV, MP4, MOV, WebM and more, up to 3 hours and 500 MB. Needs a free ProdLi account and uses your monthly transcription minutes. Keep the tab open until it's done; if it stops, the meeting keeps the audio and offers Retry." />
            <Row label={<Tag>Other call apps</Tag>} desc="Zoom (Join from your browser), Microsoft Teams, Webex, Slack huddles, Discord voice, Jitsi and Whereby work in the browser: join the call, then click the ProdLi icon on its tab. For any other app, turn on Setup → Record any website. ProdLi records the call's audio and, when you're signed in, transcribes it with AI as soon as the call ends (Setup → turn this off to keep audio on this computer and use on-device transcription instead). Turn on Setup → Include my microphone so your own voice is recorded too; ProdLi warns you when it's off." />
            <Row label={<Tag>Captions off?</Tag>} desc="Turn on “Transcribe on this computer” in Setup. Chrome's built-in speech recognition transcribes the call on your device (speakers: You / Others). One free download per language; audio never leaves your computer." />
            <Row label={<Tag>Several languages?</Tag>} desc="Meet captions follow one language. Under a meeting's audio, 🌐 Transcribe audio with AI sends the recording to ProdLi's AI (Whisper), which writes each part in the language it was spoken. Lines are labelled You and Others when your microphone was included in the recording (otherwise Speaker); uses your monthly transcription minutes." />
            <Row label={<Tag>Stop</Tag>} desc="Click Stop on the yellow badge, click the icon again, leave the call, or close the tab." />
            <Row label={<Tag>AI notes</Tag>} desc="Summary, key points, decisions, action items and open questions, written by Claude Haiku through your ProdLi account (free monthly allowance)." />
            <Row label={<Tag>+ To-Do / Save as note</Tag>} desc="Send action items to your To-Do list, or save the whole summary as a note in the Editor." />
            <Row label={<Tag>📋 Copy notes / ⬇ .md</Tag>} desc="Under a meeting's summary: copy the notes as Markdown (pastes cleanly into Notion, Slack, Google Docs or email) or download them as a .md file. Action items come as a checklist; the transcript isn't included." />
            <Row label={<Tag>🔗 Share</Tag>} desc="Under a meeting's summary: a read-only link to the summary, decisions and action items (never the transcript or audio) for people who weren't there. Choose 7 or 30 days (or no expiry with Pro); Update shared page after re-summarizing; Stop sharing turns the link off." />
            <Row label={<Tag>Notes language · Pro</Tag>} desc="Setup → Meeting notes → Notes language: summaries are written in the language you choose, whatever was spoken (names and terms stay as said; the transcript stays as spoken)." />
            <Row label={<Tag>Record reminder</Tag>} desc="With the recorder on, about 45 seconds after you join a Meet, Zoom, Jitsi or Whereby meeting without recording, one notification reminds you to click the ProdLi icon (or Alt+Shift+R). Once per meeting a day; Don't remind me again (or Setup → Recorder) turns it off." />
            <Row label={<Tag>📝 Your notes</Tag>} desc="While recording, a notepad opens under the recording bar (📝 Notes hides it); every meeting also has Your notes. Jot down what matters as it happens; it's saved as you type. With Pro, summaries build on your notes: what mattered to you, and your wording for decisions and action items." />
            <Row label={<Tag>★ Mark moment</Tag>} desc="While recording, press ★ Mark moment on the recording bar (or ★ on the in-call badge, or Alt+Shift+M) when something important is said. The meeting shows Key moments with what was being said; × removes one. With Pro, summaries make sure to cover them." />
            <Row label={<Tag>🎯 Coach me · Pro</Tag>} desc="Under a meeting's Insights: honest AI feedback on how the meeting went for you — what worked, what to try next time, whether clear next steps were agreed, and questions you could have asked. Pick what it was (sales call, interview, one-on-one, presenting) for sharper tips. Uses 1 AI meeting summary; the feedback is kept with the meeting." />
            <Row label={<Tag>🧭 Decisions · Pro</Tag>} desc="Meetings → 🧭 Decisions: every decision from every meeting summary, newest first. Search it, copy it as Markdown, or open the meeting a decision came from." />
            <Row label={<Tag>📊 Insights · Pro</Tag>} desc="Meetings → 📊 Insights: where your meeting time goes over the last 8 weeks — hours per week, this week against last, your average meeting and busiest day, recurring meetings, call apps, and the decisions and action items that came out. Worked out on this device." />
            <Row label={<Tag>Series · Pro</Tag>} desc="A recurring meeting (same Meet link or title) shows Earlier in this series: past occurrences with their decisions and still-open items. Click one to open it." />
            <Row label={<Tag>✅ Action items · Pro</Tag>} desc="Meetings → ✅ Action items: every open action item from every meeting, grouped by owner (you first), overdue first. Tick one when it's done, add it to your to-dos, or open the meeting it came from." />
            <Row label={<Tag>Type rules · Pro</Tag>} desc="Setup → Meeting notes → Pick the type from the meeting's name: rules like “interview, screening → Interview” or “Acme → Sales discovery”. A meeting with no type of its own gets the first rule whose words are in its name." />
            <Row label={<Tag>Your templates · Pro</Tag>} desc="Setup → Meeting notes → Your meeting templates: start from a ready-made one (Sales discovery, Customer check-in, User interview, Retrospective, Hiring debrief…) or write your own: name it, say what to focus on, and list your own sections (e.g. Budget, Decision-makers, Need, Timeline). Pick it as a meeting's type, or as your usual type; summaries fill your sections in." />
            <Row label={<Tag>Speakers & talk time</Tag>} desc="With Include my microphone on, ProdLi notes who's talking (your mic or the call) on this device. AI transcripts then label lines You and Others, and Insights shows the talk-time split, your longest stretch and how often the turn changed (Pro)." />
            <Row label={<Tag>Meeting type</Tag>} desc="Pick General, 1:1, Interview, Sales call, Stand-up or Planning next to Summarize; it shapes what the summary pulls out. Set your usual type in Setup → Meeting notes." />
            <Row label={<Tag>Word list</Tag>} desc="Setup → Meeting notes: names and terms (people, products, jargon) that summaries and audio transcripts should spell exactly." />
            <Row label={<Tag>Heads-up</Tag>} desc="Edit your “I'm taking AI notes” message in Setup; Copy heads-up (also in the recording bar) puts it on the clipboard to paste in the meeting chat. In Google Meet, ProdLi can post it in the chat for you when recording starts (Setup → Post it in the Google Meet chat)." />
            <Row label={<Tag>📅 Calendar</Tag>} desc="With Google Calendar connected (Today), a meeting you record is filed under the event that's on: the same Meet link, or the event at that time. It shows the event and who was invited, takes the event's name if it had none, and meeting prep finds it for the next one in the series." />
            <Row label={<Tag>Auto-delete</Tag>} desc="Setup → Meeting notes → Auto-delete: remove recordings after 7, 30 or 90 days (transcripts and notes stay), and/or whole meetings after 30 days, 90 days or a year. Off by default." />
          </Section>

          {/* Files */}
          <Section emoji="📄" title="Files">
            <Row label={<Tag>Open / drop</Tag>} desc="Click Open file, or drag a file anywhere onto ProdLi. Files are read on your device and never uploaded (up to 10 MB)." />
            <Row label={<Tag>Markdown</Tag>} desc="Formatted preview, or switch to Source. Links open in a new tab; scripts in the file never run." />
            <Row label={<Tag>JSON</Tag>} desc="Collapsible tree with search across keys and values, a formatted view, and the raw text. Invalid JSON shows where the problem is." />
            <Row label={<Tag>CSV / TSV</Tag>} desc="Table view with the separator detected automatically and an optional header row." />
            <Row label={<Tag>Save to Notes</Tag>} desc="Copies the file into a new Editor note (Markdown becomes formatted text)." />
          </Section>

          {/* Account */}
          <Section emoji="👤" title={accountsEnabled() ? "Account & sync" : "Account & Google Drive sync"}>
            {accountsEnabled() ? (
              <>
                <Row label={<Tag>Sign in</Tag>} desc="Optional. Sign in with Google (your profile, bottom left) to keep notes, to-dos, habits, meetings (text only) and history the same in the extension and at app.prodli.com. Everything already on this device is added; nothing is overwritten." />
                <Row label={<Tag>Settings</Tag>} desc="Your profile menu → Settings: account, plan & usage, sync & devices, backups, appearance, Today and help — all in one place." />
                <Row label={<Tag>Your data</Tag>} desc="Download your account's data or a local backup any time (Settings → Backup & data), or every note, meeting and to-do as plain Markdown files in a .zip. Deleting your account removes everything synced to ProdLi's servers." />
                <Row label={<Tag>Claude & ChatGPT</Tag>} desc="Settings → Connections: create an API key and connect Claude Desktop, Claude.ai, ChatGPT, Cursor or your own scripts (ProdLi's MCP server and a JSON API). They can read your synced to-dos, notes, meeting notes and transcripts, habits and today's plan — never change anything. One key per app; revoke any key there. Sign out everywhere revokes them all." />
              </>
            ) : (
              <>
                <Row label={<Tag>Sign in</Tag>} desc="Optional. Sign in with Google to sync through a private ProdLi folder in your own Google Drive (only ProdLi can see it). No ProdLi servers, no cost." />
                <Row label={<Tag>Sync now</Tag>} desc="Merges this computer with the copy in Drive, item by item: the newest edit of each note, task, habit or meeting wins, and deletions sync too. Runs automatically about every hour while signed in. Settings are never synced." />
                <Row label={<Tag>Replace</Tag>} desc="Overwrites this computer with the Drive copy — only for starting fresh." />
              </>
            )}
          </Section>

          {/* Keyboard Shortcuts */}
          <Section emoji="⌨️" title="Keyboard Shortcuts">
            <div style={{ border: "var(--nb-border)", overflow: "hidden" }}>

              {/* Sub-header: Editor formatting */}
              <div style={{ background: "#FFD700", padding: "4px 14px", borderBottom: "var(--nb-border)" }}>
                <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "#000" }}>✍️ Editor formatting</span>
              </div>
              <div style={{ background: "hsl(var(--muted))", padding: "6px 14px", borderBottom: "var(--nb-border)", display: "flex", gap: 14 }}>
                <div style={{ minWidth: 220, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>Shortcut</div>
                <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>Action</div>
              </div>
              <div style={{ padding: "4px 14px" }}>
                <ShortcutRow keys={["Ctrl / ⌘ + B"]} action="Bold" />
                <ShortcutRow keys={["Ctrl / ⌘ + I"]} action="Italic" />
                <ShortcutRow keys={["Ctrl / ⌘ + U"]} action="Underline" />
                <ShortcutRow keys={["Ctrl / ⌘ + Shift + S"]} action="Strikethrough" />
                <ShortcutRow keys={["Ctrl / ⌘ + Z"]} action="Undo" />
                <ShortcutRow keys={["Ctrl+Y / ⌘+Shift+Z"]} action="Redo" />
                <ShortcutRow keys={["Ctrl / ⌘ + K"]} action="Insert, edit or remove a link" />
                <ShortcutRow keys={["Ctrl / ⌘ + J"]} action="✨ Improve selected text (grammar, shorter, clearer, tone)" />
                <ShortcutRow keys={["Ctrl / ⌘ + Shift + H"]} action="Highlight" />
                <ShortcutRow keys={["Ctrl / ⌘ + E"]} action="Inline code" />
                <ShortcutRow keys={["/"]} action="Insert a block (checklist, table, heading…)" />
                <ShortcutRow keys={["Alt + N"]} action="New note" />
                <ShortcutRow keys={["Escape"]} action="Exit fullscreen mode" />
              </div>

              {/* Sub-header: Global navigation */}
              <div style={{ background: "#FFD700", padding: "4px 14px", borderBottom: "var(--nb-border)", borderTop: "var(--nb-border)" }}>
                <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "#000" }}>🌐 Global navigation</span>
              </div>
              <div style={{ background: "hsl(var(--muted))", padding: "6px 14px", borderBottom: "var(--nb-border)", display: "flex", gap: 14 }}>
                <div style={{ minWidth: 220, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>Shortcut</div>
                <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>Action</div>
              </div>
              <div style={{ padding: "4px 14px" }}>
                <ShortcutRow keys={["Ctrl / ⌘ + K"]} action="Search & commands (go anywhere, add a to-do, ask ProdLi)" />
                <ShortcutRow keys={["Alt + Shift + A"]} action="Quick add a to-do or note from any page (extension)" />
                {[...SECTIONS].sort((x, y) => x.shortcut.localeCompare(y.shortcut)).map((x) => (
                  <ShortcutRow key={x.key} keys={[`Ctrl / ⌘ + ${x.shortcut}`]} action={`Go to ${x.label}`} />
                ))}
                <ShortcutRow keys={["?"]} action="Help & shortcuts" />
                <ShortcutRow keys={["Alt + Shift + R"]} action="Start / stop recording (on a Google Meet tab)" />
                <ShortcutRow keys={["Space"]} action="Start / Pause Pomodoro timer (when on Pomodoro tab, no input focused)" />
                <ShortcutRow keys={["Escape"]} action="Close a window (Settings, Ask, Quick add…)" />
              </div>

            </div>
          </Section>

          {/* Tips */}
          <Section emoji="💡" title="Tips">
            <Row label={<Tag>Theme</Tag>} desc="Light or dark: your profile menu (bottom left), or Settings → Appearance. Saved on this device." />
            <Row label={<Tag>Privacy</Tag>} desc={accountsEnabled() ? "Everything is saved on this device first. With an account, it's also synced to ProdLi's servers (meeting audio never is). AI features send only what they need to our AI provider — see prodli.com/privacy." : "Notes, tasks, habits and history are stored in this browser. Nothing is sent to a server unless you turn on Google Drive sync."} />
            <Row label={<Tag>Offline</Tag>} desc="ProdLi works offline. Changes sync when you're back online." />
          </Section>

          {/* Support */}
          <div style={{
            border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)",
            background: "hsl(var(--card))", padding: "16px 20px",
          }}>
            <div style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>📧 Support</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Questions, feedback, or bug reports? We'd love to hear from you.
            </div>
            <a
              href="mailto:contact@prodli.com"
              style={{
                display: "inline-block", marginTop: 10,
                border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)",
                background: "#FFD700", color: "#000",
                padding: "7px 18px", fontWeight: 800, fontSize: 13,
                textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.04em",
              }}
            >
              contact@prodli.com
            </a>
            <div style={{ marginTop: 10, fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>
              Version {version()} · Made with ☕ and Neobrutalism
            </div>
          </div>

        </div>
    </>
  );

  if (embedded) return <div>{content}</div>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Help and keyboard shortcuts"
      tabIndex={-1}
      autoFocus
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{
        background: "hsl(var(--background))",
        border: "var(--nb-border)",
        boxShadow: "6px 6px 0 #FFD700",
        width: "100%",
        maxWidth: 860,
        maxHeight: "88vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "var(--nb-border)",
          background: "#000",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo size={24} />
            <span style={{ color: "#aaa", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Help & Documentation</span>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "2px solid #444", background: "transparent", color: "#888",
              width: 32, height: 32, cursor: "pointer", fontSize: 18, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit",
            }}
            title="Close (Esc)"
          >×</button>
        </div>

        {content}
      </div>
    </div>
  );
}
