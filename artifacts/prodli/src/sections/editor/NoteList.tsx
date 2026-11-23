import { useMemo, useState } from "react";
import type { Note } from "../../types";
import { BUILTIN_TEMPLATES } from "../../lib/noteTemplates";

export type NoteSort = "updated" | "created" | "title";

export function plainTextOf(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|div|tr|blockquote|pre|summary)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    // Inline tags (bold, links, colours…) join their text without adding spaces: "a <a>link</a>." stays "a link.".
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A note nobody has written in yet (no text, no picture, no icon or cover). It's tidied away when you leave it. */
export function isBlankNote(n: Pick<Note, "content" | "template" | "icon" | "cover" | "autoTitle">): boolean {
  if (n.template || n.icon || n.cover || n.autoTitle === false) return false;
  if (/<(img|table|hr|span[^>]*data-note-id)/i.test(n.content)) return false;
  return plainTextOf(n.content).trim() === "";
}

/** First words of a note after its title line, for the note list. */
export function notePreview(note: Note, max = 90): string {
  const lines = plainTextOf(note.content).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (lines.length && note.title && lines[0].toLowerCase() === note.title.trim().toLowerCase()) lines.shift();
  const text = lines.join(" · ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  const by = {
    updated: (a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt),
    title: (a: Note, b: Note) => (a.title || "Untitled").localeCompare(b.title || "Untitled", undefined, { sensitivity: "base" }),
  }[sort];
  return [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by(a, b));
}

const iconBtn: React.CSSProperties = {
  border: "var(--nb-border)",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  width: 22,
  height: 22,
  cursor: "pointer",
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

interface Props {
  notes: Note[];
  activeId: string | null;
  sort: NoteSort;
  onSortChange: (s: NoteSort) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Your templates (notes marked as templates). */
  templates: Note[];
  onFromTemplate: (html: string, name: string) => void;
  onEditTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onSaveAsTemplate: (id: string) => void;
  onDailyNote: () => void;
}

export function NoteList({ notes, activeId, sort, onSortChange, onSelect, onCreate, onRename, onTogglePin, onDuplicate, onDelete, templates, onFromTemplate, onEditTemplate, onDeleteTemplate, onSaveAsTemplate, onDailyNote }: Props) {
  const [search, setSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const { list, snippets, searching } = useMemo(() => {
    const snippets: Record<string, string> = {};
    const sorted = sortNotes(notes, sort);
    if (!q) {
      for (const n of sorted) snippets[n.id] = notePreview(n);
      return { list: sorted, snippets, searching: false };
    }
    const list = sorted.filter((n) => {
      if ((n.title || "").toLowerCase().includes(q)) return true;
      const text = plainTextOf(n.content).replace(/\s+/g, " ");
      const i = text.toLowerCase().indexOf(q);
      if (i === -1) return false;
      const s = Math.max(0, i - 25);
      const e = Math.min(text.length, i + q.length + 55);
      snippets[n.id] = `${s > 0 ? "…" : ""}${text.slice(s, e).trim()}${e < text.length ? "…" : ""}`;
      return true;
    });
    return { list, snippets, searching: true };
  }, [notes, sort, q]);

  const commitRename = (id: string) => {
    onRename(id, tempTitle.trim());
    setEditing(null);
  };

  return (
    <div className="editor-sidebar" style={{ width: 240, borderRight: "var(--nb-border)", display: "flex", flexDirection: "column", background: "hsl(var(--background))", flexShrink: 0 }}>
      <div style={{ padding: "12px 12px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "var(--nb-border)", gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes · {notes.length}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            aria-label="Sort notes"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as NoteSort)}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 10, fontWeight: 700, height: 26, fontFamily: "inherit" }}
          >
            <option value="updated">Recent</option>
            <option value="created">Newest</option>
            <option value="title">A–Z</option>
          </select>
          <button
            onClick={onDailyNote}
            title="Today's daily note"
            aria-label="Today's daily note"
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", width: 26, height: 26, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--nb-shadow-sm)", color: "hsl(var(--foreground))" }}
          >
            📅
          </button>
          <button
            onClick={() => setShowTemplates((v) => !v)}
            title="New note from a template"
            aria-label="New note from a template"
            aria-expanded={showTemplates}
            style={{ border: "var(--nb-border)", background: showTemplates ? "hsl(var(--foreground))" : "hsl(var(--card))", color: showTemplates ? "hsl(var(--background))" : "hsl(var(--foreground))", width: 26, height: 26, cursor: "pointer", fontWeight: 900, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--nb-shadow-sm)" }}
          >
            ▾
          </button>
          <button
            onClick={onCreate}
            title="New note (Alt+N)"
            aria-label="New note"
            style={{ border: "var(--nb-border)", background: "#FFD700", width: 26, height: 26, cursor: "pointer", fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--nb-shadow-sm)", color: "#000" }}
          >
            +
          </button>
        </div>
      </div>
      {showTemplates && (
        <div role="menu" aria-label="Templates" data-testid="templates-menu" style={{ borderBottom: "var(--nb-border)", background: "hsl(var(--card))", padding: 6, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", padding: "2px 4px 4px" }}>New from a template</div>
          {BUILTIN_TEMPLATES.map((t) => (
            <button key={t.id} role="menuitem" onClick={() => (setShowTemplates(false), onFromTemplate(t.html, t.name))} style={menuItem}>
              {t.emoji} {t.name}
            </button>
          ))}
          <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", padding: "8px 4px 4px" }}>Your templates</div>
          {templates.length === 0 && <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", padding: "0 4px 4px" }}>Use ⋯ → Save as template on any note. A template named “Daily note” is used by 📅.</div>}
          {templates.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
              <button role="menuitem" onClick={() => (setShowTemplates(false), onFromTemplate(t.content, t.title))} style={{ ...menuItem, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ☆ {t.title || "Untitled template"}
              </button>
              <button onClick={() => (setShowTemplates(false), onEditTemplate(t.id))} aria-label={`Edit template ${t.title}`} title="Edit" style={tplIcon}>✎</button>
              <button onClick={() => onDeleteTemplate(t.id)} aria-label={`Delete template ${t.title}`} title="Delete" style={{ ...tplIcon, color: "#E53935" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--nb-section-border)" }}>
        <input
          type="search"
          placeholder="Search notes…"
          aria-label="Search notes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", border: "var(--nb-border)", padding: "5px 8px", fontSize: 12, fontFamily: "inherit", background: "hsl(var(--card))", color: "hsl(var(--foreground))", boxSizing: "border-box" }}
        />
      </div>
      <div style={{ overflowY: "auto", flex: 1 }} onClick={() => setMenuFor(null)}>
        {list.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: "hsl(var(--muted-foreground))", fontWeight: 600, textAlign: "center" }}>No notes match “{search}”</div>
        ) : (
          list.map((note) => {
            const active = note.id === activeId;
            return (
              <div
                key={note.id}
                data-note-id={note.id}
                onClick={() => onSelect(note.id)}
                style={{
                  position: "relative",
                  padding: "9px 10px 9px 12px",
                  borderBottom: "1px solid var(--nb-section-border)",
                  background: active ? "#FFD700" : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 6,
                  color: active ? "#000" : "hsl(var(--foreground))",
                }}
              >
                {editing === note.id ? (
                  <input
                    autoFocus
                    aria-label="Note title"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={() => commitRename(note.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ border: "var(--nb-border)", padding: "2px 4px", fontSize: 12, fontWeight: 700, width: "100%", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
                  />
                ) : (
                  <div
                    style={{ flex: 1, minWidth: 0 }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditing(note.id);
                      setTempTitle(note.title);
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {note.pinned && <span aria-label="Pinned" title="Pinned">📌 </span>}
                      {note.icon && <span aria-hidden style={{ marginRight: 5 }}>{note.icon}</span>}
                      {note.title || "Untitled"}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{relativeTime(note.updatedAt)}</div>
                    {snippets[note.id] && (
                      <div style={{ fontSize: 11, fontStyle: searching ? "italic" : "normal", opacity: 0.8, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.35 }}>{snippets[note.id]}</div>
                    )}
                  </div>
                )}
                <button
                  aria-label={`Actions for ${note.title || "Untitled"}`}
                  title="More actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === note.id ? null : note.id);
                  }}
                  style={{ ...iconBtn, fontSize: 14, fontWeight: 900, flexShrink: 0 }}
                >
                  ⋯
                </button>
                {menuFor === note.id && (
                  <div
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: "absolute", right: 8, top: 34, zIndex: 20, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", minWidth: 150, padding: 4 }}
                  >
                    {[
                      { label: note.pinned ? "Unpin" : "Pin to top", run: () => onTogglePin(note.id) },
                      { label: "Rename", run: () => { setEditing(note.id); setTempTitle(note.title); } },
                      { label: "Duplicate", run: () => onDuplicate(note.id) },
                      { label: "Save as template", run: () => onSaveAsTemplate(note.id) },
                      { label: "Delete", run: () => onDelete(note.id), danger: true },
                    ].map((item) => (
                      <button
                        key={item.label}
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          item.run();
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", color: item.danger ? "#E53935" : "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const menuItem: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", color: "hsl(var(--foreground))", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const tplIcon: React.CSSProperties = { border: "none", background: "none", cursor: "pointer", fontWeight: 900, fontSize: 13, padding: "0 6px", color: "hsl(var(--foreground))", fontFamily: "inherit" };
