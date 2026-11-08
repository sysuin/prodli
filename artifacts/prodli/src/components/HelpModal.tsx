import { useEffect } from "react";

interface HelpModalProps {
  onClose: () => void;
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

export function HelpModal({ onClose }: HelpModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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
            <span style={{ background: "#FFD700", color: "#000", fontWeight: 900, fontSize: 15, padding: "3px 10px", border: "2px solid #FFD700" }}>ProdLi</span>
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
              Your new tab is now an all-in-one productivity hub: Editor, To-Dos, Pomodoro, Habits, Time Tracker, Meetings and Files. Data is stored locally in your browser. Optional: sign in with Google (👤) to back up to your own Google Drive.
            </div>
          </div>

          {/* Editor */}
          <Section emoji="✍️" title="Editor">
            <Row label={<Tag>/ commands</Tag>} desc="Type / anywhere to insert headings, checklists, bullet or numbered lists, tables, quotes, code blocks, dividers, highlights, today's date or the time. Use ↑ ↓ and Enter, or keep typing to filter." />
            <Row label={<Tag>Select text</Tag>} desc="A small menu appears over selected text for bold, italic, underline, strikethrough, highlight, code and links." />
            <Row label={<Tag>Checklists</Tag>} desc="Tick items off right in the note. Checklists survive Markdown import/export." />
            <Row label={<Tag>Tables</Tag>} desc="Insert with / or ▦. While the cursor is in a table, a Table bar lets you add or delete rows and columns, toggle the header row, or delete the table. Drag column edges to resize." />
            <Row label={<Tag>🔗 Links</Tag>} desc="Ctrl/⌘+K adds or edits a link (leave empty to remove). Plain click edits; Ctrl/⌘+click — or Open ↗ in the link menu — opens it." />
            <Row label={<Tag>Paste Markdown</Tag>} desc="Pasting Markdown text (headings, lists, checklists, bold, links) turns it into formatting automatically." />
            <Row label={<Tag>+ / Alt+N</Tag>} desc="New note. Untitled notes are named after their first line until you rename them." />
            <Row label={<Tag>⋯ menu</Tag>} desc="Pin to top, rename (or double-click the title), duplicate, or delete — with Undo." />
            <Row label={<Tag>Sort & search</Tag>} desc="Sort by recently edited, newest, or A–Z. Search matches titles and text, with an excerpt." />
            <Row label={<Tag>☰ Outline</Tag>} desc="Shows the note's headings; click one to jump there." />
            <Row label={<><Tag>⧉</Tag><Tag>⬆</Tag><Tag>⬇</Tag><Tag>🖨</Tag></>} desc="Copy as Markdown, import a .md file as a note, export the note as .md, or print / save as PDF." />
            <Row label={<Tag>⛶ Fullscreen</Tag>} desc="Hides the sidebar for distraction-free writing. Press Escape to exit." />
            <Row label={<Tag>Saving</Tag>} desc="Notes save automatically (the status bar shows Saving… / Saved). Edits in several ProdLi tabs are merged — nothing gets overwritten." />
          </Section>

          {/* To-Dos */}
          <Section emoji="✅" title="To-Dos">
            <Row label={<Tag>Add task</Tag>} desc="Type a task title, optionally set Priority and Due Date, then click Add or press Enter." />
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
          </Section>

          {/* Habits */}
          <Section emoji="🎯" title="Habits">
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
            <Row label={<Tag>⚙ Setup</Tag>} desc="Add your Claude API key, turn on the recorder (Chrome asks for permission), and optionally include your microphone." />
            <Row label={<Tag>Record</Tag>} desc="On a Google Meet tab, click the ProdLi toolbar icon or press Alt+Shift+R. No bot joins the call; ProdLi reads Meet's captions, which only you can see." />
            <Row label={<Tag>Stop</Tag>} desc="Click Stop on the yellow badge, click the icon again, leave the call, or close the tab." />
            <Row label={<Tag>AI notes</Tag>} desc="Summary, key points, decisions, action items and open questions, written by Claude Haiku using your own API key." />
            <Row label={<Tag>+ To-Do / Save as note</Tag>} desc="Send action items to your To-Do list, or save the whole summary as a note in the Editor." />
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
          <Section emoji="👤" title="Account & Google Drive backup">
            <Row label={<Tag>Sign in</Tag>} desc="Optional. Sign in with Google to back up everything to a private ProdLi folder in your own Google Drive (only ProdLi can see it). No ProdLi servers, no cost." />
            <Row label={<Tag>Back up now</Tag>} desc="Saves notes, to-dos, habits, Pomodoro data, time tracking and meeting notes to Drive. Auto-backup runs once a day while signed in. Your Claude API key is never included." />
            <Row label={<Tag>Restore</Tag>} desc="Replaces this device's data with the Drive backup — use it to move to a new computer." />
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
                <ShortcutRow keys={["Ctrl / ⌘ + 1"]} action="Switch to Editor" />
                <ShortcutRow keys={["Ctrl / ⌘ + 2"]} action="Switch to To-Dos" />
                <ShortcutRow keys={["Ctrl / ⌘ + 3"]} action="Switch to Pomodoro" />
                <ShortcutRow keys={["Ctrl / ⌘ + 4"]} action="Switch to Habits" />
                <ShortcutRow keys={["Ctrl / ⌘ + 5"]} action="Switch to Tracker" />
                <ShortcutRow keys={["Ctrl / ⌘ + 6"]} action="Switch to Meetings" />
                <ShortcutRow keys={["Ctrl / ⌘ + 7"]} action="Switch to Files" />
                <ShortcutRow keys={["Alt + Shift + R"]} action="Start / stop recording (on a Google Meet tab)" />
                <ShortcutRow keys={["Space"]} action="Start / Pause Pomodoro timer (when on Pomodoro tab, no input focused)" />
                <ShortcutRow keys={["Escape"]} action="Close this help panel" />
              </div>

            </div>
          </Section>

          {/* Tips */}
          <Section emoji="💡" title="Tips">
            <Row label={<Tag>Dark mode</Tag>} desc="Click the 🌙 / ☀️ button in the top-right to toggle between light and dark themes. Your preference is saved." />
            <Row label={<Tag>Data privacy</Tag>} desc="All notes, tasks, habits, and Pomodoro sessions are stored using chrome.storage.local — entirely on your device. Nothing is sent to any server." />
            <Row label={<Tag>Offline</Tag>} desc="ProdLi works fully offline. No internet connection is required." />
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
              Version 1.0.0 · Made with ☕ and Neobrutalism
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
