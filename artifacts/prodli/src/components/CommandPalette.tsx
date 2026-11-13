// Command palette (Ctrl/⌘ + K): jump to any section, run any action, or type
// anything to add it as a to-do or ask ProdLi. New sections appear here
// automatically (sections/registry.ts); new actions are one entry below.
import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "../sections/registry";
import type { Section } from "../types";

export interface PaletteActions {
  go: (s: Section) => void;
  ask: (question?: string) => void;
  addTask: (title: string) => void;
  quickAdd: () => void;
  toggleTheme: () => void;
  account: () => void;
  backup: () => void;
  help: () => void;
  settings: () => void;
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

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "ask", label: "Ask ProdLi…", icon: "✨", hint: "AI assistant", keywords: "chat question ai help", run: () => actions.ask() },
      { id: "quick-add", label: "Quick add a to-do or note", icon: "➕", keywords: "new create capture", run: actions.quickAdd },
      ...SECTIONS.map((s) => ({ id: `go-${s.key}`, label: `Go to ${s.label}`, icon: s.emoji, hint: `${mod}${s.shortcut}`, keywords: `${s.key} ${s.description}`, run: () => actions.go(s.key) })),
      { id: "theme", label: isDark ? "Switch to light mode" : "Switch to dark mode", icon: isDark ? "☀️" : "🌙", keywords: "theme dark light", run: actions.toggleTheme },
      { id: "settings", label: "Settings", icon: "⚙️", keywords: "preferences options account plan sync appearance", run: actions.settings },
      { id: "account", label: "Account & sync", icon: "👤", keywords: "sign in login profile devices", run: actions.account },
      { id: "backup", label: "Backup & data", icon: "💾", keywords: "export import restore download", run: actions.backup },
      { id: "help", label: "Help & keyboard shortcuts", icon: "?", keywords: "shortcuts guide", run: actions.help },
    ];
    const q = query.trim().toLowerCase();
    const matched = q ? base.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q)) : base;
    const text = query.trim();
    // Free text: offer to add it as a to-do or ask ProdLi about it.
    const typed: Command[] = text
      ? [
          { id: "typed-ask", label: `Ask ProdLi: “${text}”`, icon: "✨", run: () => actions.ask(text) },
          { id: "typed-task", label: `Add to-do: “${text}”`, icon: "✅", run: () => actions.addTask(text) },
        ]
      : [];
    return matched.length ? [...matched, ...typed] : typed;
  }, [query, actions, isDark]);

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
          placeholder="Go to, do, or type to add a to-do / ask ProdLi…"
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
          {commands.length === 0 && <li style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>Type something to add it or ask ProdLi.</li>}
        </ul>
      </div>
    </div>
  );
}
