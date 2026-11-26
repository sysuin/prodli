// Command palette (Ctrl/⌘ + K): jump to any section, run any action, or type
// anything to add it as a to-do or ask ProdLi. New sections appear here
// automatically (sections/registry.ts); new actions are one entry below.
import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "../sections/registry";
import type { Section } from "../types";
import { openImprove, REWRITE_ACTIONS } from "../lib/write";
import { parseTask } from "../lib/taskParse";
import { logHabitToday, matchHabits, parsePrefix, prefixHelp, startPomodoroNow } from "../lib/palettePrefix";
import { isDone, kindOf, momentText, progressLabel } from "../lib/habits";
import { getDayKey } from "../lib/utils";
import { addNote } from "../lib/capture";
import { openSource } from "../lib/askOpen";
import { storageGet } from "../lib/storage";
import { isExtension } from "../lib/tabSessions";
import { openSettings } from "./Settings";
import { SNIPPETS_KEY, type Snippet } from "../dictation/core";
import { fillSnippet, matchSnippets } from "../lib/snippets";
import type { Habit } from "../types";

/** "Add to-do: “Pay rent” · 📅 Dec 1 · 🔁 Every month" — shows how quick add reads the text. */
export function taskLabel(text: string): string {
  const p = parseTask(text);
  return `Add to-do: “${p.title}”${p.matched.length ? ` · ${p.matched.join(" · ")}` : ""}`;
}

export interface PaletteActions {
  go: (s: Section) => void;
  ask: (question?: string) => void;
  addTask: (title: string) => void;
  quickAdd: () => void;
  saveTabs: () => void;
  dailyNote: () => void;
  voiceTasks: () => void;
  importTasks: () => void;
  importNotes: () => void;
  toggleTheme: () => void;
  account: () => void;
  backup: () => void;
  help: () => void;
  settings: () => void;
  /** A short message at the bottom of the screen. */
  flash: (message: string) => void;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  keywords?: string;
  run: () => void;
}

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function CommandPalette({ actions, onClose, isDark }: { actions: PaletteActions; onClose: () => void; isDark: boolean }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  // For the "h" and "s" prefixes.
  const [habits, setHabits] = useState<Habit[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  useEffect(() => {
    void storageGet<Habit[]>("habits", []).then(setHabits);
    void storageGet<Snippet[]>(SNIPPETS_KEY, []).then(setSnippets);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "ask", label: "Ask ProdLi…", icon: "✨", hint: "AI assistant", keywords: "chat question ai help", run: () => actions.ask() },
      { id: "quick-add", label: "Quick add a to-do or note", icon: "➕", keywords: "new create capture", run: actions.quickAdd },
      { id: "voice-tasks", label: "Speak or paste tasks", icon: "🎙", keywords: "voice dictate brain dump talk microphone tasks", run: actions.voiceTasks },
      { id: "import-tasks", label: "Import to-dos from other apps", icon: "⇩", keywords: "import todoist ticktick google tasks csv markdown switch move migrate", run: actions.importTasks },
      { id: "import-notes", label: "Import notes from other apps", icon: "⇩", keywords: "import notion evernote keep obsidian bear markdown enex notes switch move migrate", run: actions.importNotes },
      { id: "daily-note", label: "Open today's daily note", icon: "📅", keywords: "journal daily note today log", run: actions.dailyNote },
      { id: "save-tabs", label: "Save open tabs and close them", icon: "🗂", keywords: "tabs session onetab window clear later", run: actions.saveTabs },
      // Writing help works on the text selected in Notes (the selection survives opening the palette).
      ...REWRITE_ACTIONS.map((a) => ({
        id: `improve-${a.id}`,
        label: `Improve selection: ${a.label}`,
        icon: "✨",
        keywords: "writing grammar spelling rewrite shorten tone notes ai",
        run: () => {
          actions.go("editor");
          setTimeout(() => openImprove(a.id), 0);
        },
      })),
      ...SECTIONS.map((s) => ({ id: `go-${s.key}`, label: `Go to ${s.label}`, icon: s.emoji, hint: `${mod}${s.shortcut}`, keywords: `${s.key} ${s.description}`, run: () => actions.go(s.key) })),
      { id: "theme", label: isDark ? "Switch to light mode" : "Switch to dark mode", icon: isDark ? "☀️" : "🌙", keywords: "theme dark light", run: actions.toggleTheme },
      { id: "settings", label: "Settings", icon: "⚙️", keywords: "preferences options account plan sync appearance", run: actions.settings },
      { id: "account", label: "Account & sync", icon: "👤", keywords: "sign in login profile devices", run: actions.account },
      { id: "backup", label: "Backup & data", icon: "💾", keywords: "export import restore download", run: actions.backup },
      { id: "help", label: "Help & keyboard shortcuts", icon: "?", keywords: "shortcuts guide", run: actions.help },
    ];
    // Typed prefixes: t to-do · n note · h habit · p 25 Pomodoro · ? ask · s snippet (lib/palettePrefix.ts).
    const pre = parsePrefix(query);
    // Snippets live in the Chrome extension (Settings → Dictation): elsewhere "s …" is just text.
    if (pre && (pre.kind !== "snippet" || isExtension())) return prefixCommands(pre, { actions, habits, snippets });
    const q = query.trim().toLowerCase();
    // Writing-help entries only show when searched for, so the default list stays short.
    const matched = q ? base.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q)) : base.filter((c) => !c.id.startsWith("improve-"));
    const text = query.trim();
    // Free text: offer to add it as a to-do or ask ProdLi about it.
    const typed: Command[] = text
      ? [
          { id: "typed-ask", label: `Ask ProdLi: “${text}”`, icon: "✨", run: () => actions.ask(text) },
          { id: "typed-task", label: taskLabel(text), icon: "✅", run: () => actions.addTask(text) },
        ]
      : [];
    return matched.length ? [...matched, ...typed] : typed;
  }, [query, actions, isDark, habits, snippets]);

  useEffect(() => setActive(0), [query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2200, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "12vh 16px 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, commands.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(commands[active]);
            } else if (e.key === "Escape") onClose();
          }}
          placeholder="Go to, do, or type: t to-do · n note · h habit · p 25 · ? ask"
          aria-label="Search commands"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={commands[active] ? `palette-${commands[active].id}` : undefined}
          style={{ width: "100%", boxSizing: "border-box", border: "none", borderBottom: "var(--nb-border)", padding: "14px 16px", fontSize: 16, fontFamily: "inherit", background: "transparent", color: "inherit", outline: "none" }}
        />
        <ul id="palette-list" role="listbox" style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: "50vh", overflowY: "auto" }}>
          {commands.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer", fontSize: 14, fontWeight: 600, background: i === active ? "#FFD700" : "transparent", color: i === active ? "#000" : "inherit" }}
            >
              <span style={{ width: 22, textAlign: "center" }} aria-hidden>
                {c.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              {c.hint && <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, fontFamily: "Space Mono, monospace" }}>{c.hint}</span>}
            </li>
          ))}
          {commands.length === 0 && <li style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>{parsePrefix(query) ? "Nothing matches." : "Type something to add it or ask ProdLi."}</li>}
        </ul>
        {!query && (
          <div data-testid="palette-prefix-help" style={{ borderTop: "var(--nb-border)", padding: "7px 12px", fontSize: 11, fontWeight: 700, opacity: 0.75, fontFamily: "Space Mono, monospace" }}>
            Type first: {prefixHelp(isExtension() ? undefined : ["todo", "note", "habit", "pomodoro", "ask"])}
          </div>
        )}
      </div>
    </div>
  );
}

/** The commands for a typed prefix (t, n, h, p, ?, s). */
function prefixCommands(pre: NonNullable<ReturnType<typeof parsePrefix>>, ctx: { actions: PaletteActions; habits: Habit[]; snippets: Snippet[] }): Command[] {
  const { actions, habits, snippets } = ctx;
  const text = pre.rest;
  switch (pre.kind) {
    case "todo":
      return text ? [{ id: "prefix-todo", label: taskLabel(text), icon: "✅", run: () => actions.addTask(text) }] : [];
    case "note":
      return [
        {
          id: "prefix-note",
          label: text ? `New note: “${text}”` : "New note",
          icon: "✍️",
          run: () =>
            void addNote({ title: text || "Untitled" }).then((n) => {
              void openSource({ kind: "note", id: n.id, title: n.title });
            }),
        },
      ];
    case "habit": {
      const found = matchHabits(habits, text);
      return found.map((h) => ({
        id: `prefix-habit-${h.id}`,
        label: `${kindOf(h) === "check" ? (isDone(h, getDayKey()) ? "Unmark" : "Check off") : kindOf(h) === "timed" ? "+5 min" : "+1"}: ${h.name}`,
        icon: h.emoji,
        hint: progressLabel(h, getDayKey()),
        run: () =>
          void logHabitToday(h.id).then((r) => {
            if (!r) return;
            if (r.moment) {
              const m = momentText(r.moment);
              actions.flash(`${m.title} ${h.name}${r.moment.earnedFreeze ? " · 🧊 streak freeze earned" : ""}`);
            } else actions.flash(r.done ? `✓ ${h.name}: ${progressLabel(r.habit, getDayKey())}` : `${h.name}: ${progressLabel(r.habit, getDayKey())}`);
          }),
      }));
    }
    case "pomodoro": {
      const mins = pre.minutes;
      return [
        {
          id: "prefix-pomodoro",
          label: `Start a ${mins ? `${mins}-min` : ""} Pomodoro${text ? `: ${text}` : ""}`.replace("a  Pomodoro", "a Pomodoro"),
          icon: "🍅",
          run: () =>
            void startPomodoroNow(mins, text).then((t) => {
              actions.flash(`🍅 Focus started: ${Math.round(t.remaining / 60)} min${text ? ` · ${text}` : ""}`);
            }),
        },
      ];
    }
    case "ask":
      return [{ id: "prefix-ask", label: text ? `Ask ProdLi: “${text}”` : "Ask ProdLi…", icon: "✨", run: () => actions.ask(text || undefined) }];
    case "snippet": {
      const found = matchSnippets(snippets, text);
      if (!snippets.length) return [{ id: "prefix-snippet-none", label: "No snippets yet: add them in Settings → Dictation → Snippets", icon: "✂️", run: () => openSettings("dictation") }];
      return found.map((sn) => ({
        id: `prefix-snippet-${sn.id}`,
        label: `Copy: ${sn.cue}`,
        icon: "✂️",
        hint: sn.text.length > 28 ? `${sn.text.slice(0, 28)}…` : sn.text,
        run: () =>
          void navigator.clipboard.writeText(fillSnippet(sn.text)).then(
            () => actions.flash(`Copied “${sn.cue}”. Paste it anywhere.`),
            () => actions.flash("Couldn't copy. Try again."),
          ),
      }));
    }
  }
}
