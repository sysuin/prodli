// "[[" in a note (or / → Link to note): pick another note to link to. Shows
// the notes whose title matches what's typed after "[["; Enter or click
// inserts a link (blocks.tsx NoteLink) in place of "[[…".

import type { Editor } from "@tiptap/react";
import type { Note } from "../../types";

export interface NotePickState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

/** If the cursor is right after "[[words" in a text block (not code), where it is. */
export function detectNotePick(editor: Editor): NotePickState | null {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.spec.code || !$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /\[\[([^[\]\n]{0,60})$/.exec(before);
  if (!m) return null;
  const from = $from.pos - m[0].length;
  const coords = view.coordsAtPos($from.pos);
  return { query: m[1], from, to: $from.pos, left: coords.left, top: coords.bottom + 6 };
}

/** Notes to offer: title matches first, then recently edited; never the note itself or templates. */
export function filterNotesForLink(notes: Note[], query: string, currentId: string | null, max = 8): Note[] {
  const q = query.trim().toLowerCase();
  const pool = notes.filter((n) => n.id !== currentId && !n.template);
  const scored = pool
    .map((n) => {
      const t = (n.title || "Untitled").toLowerCase();
      const score = !q ? 1 : t.startsWith(q) ? 3 : t.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : t.includes(q) ? 1 : 0;
      return { n, score };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt));
  return scored.slice(0, max).map((x) => x.n);
}

export function NotePicker({ state, items, index, onPick, onHover, canCreate, onCreate }: { state: NotePickState; items: Note[]; index: number; onPick: (n: Note) => void; onHover: (i: number) => void; canCreate: boolean; onCreate: () => void }) {
  const top = Math.min(state.top, window.innerHeight - 340);
  const createIndex = items.length;
  return (
    <div
      role="listbox"
      aria-label="Link to a note"
      data-note-picker
      style={{ position: "fixed", left: Math.min(state.left, window.innerWidth - 300), top: Math.max(8, top), width: 280, maxHeight: 320, overflowY: "auto", zIndex: 10000, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 4 }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8, padding: "4px 8px" }}>Link to a note</div>
      {items.map((n, i) => (
        <button
          key={n.id}
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(n);
          }}
          onMouseEnter={() => onHover(i)}
          style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", padding: "6px 8px", border: "none", background: i === index ? "#FFD700" : "transparent", color: i === index ? "#000" : "inherit", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}
        >
          <span aria-hidden style={{ width: 18, textAlign: "center" }}>{n.icon || "📄"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title || "Untitled"}</span>
        </button>
      ))}
      {canCreate && (
        <button
          role="option"
          aria-selected={index === createIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onCreate();
          }}
          onMouseEnter={() => onHover(createIndex)}
          style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", padding: "6px 8px", border: "none", background: index === createIndex ? "#FFD700" : "transparent", color: index === createIndex ? "#000" : "inherit", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}
        >
          <span aria-hidden style={{ width: 18, textAlign: "center" }}>＋</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>New note “{state.query.trim()}”</span>
        </button>
      )}
      {items.length === 0 && !canCreate && <div style={{ padding: "8px 10px", fontSize: 12, opacity: 0.7 }}>Type a note's name</div>}
    </div>
  );
}
