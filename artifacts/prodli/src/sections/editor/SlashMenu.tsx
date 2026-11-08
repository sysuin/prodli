import type { Editor } from "@tiptap/react";

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
  keywords: string;
  run: (editor: Editor) => void;
}

const today = () => new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", icon: "¶", keywords: "paragraph plain", run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h1", label: "Heading 1", hint: "Big section title", icon: "H1", keywords: "title heading big", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", hint: "Medium title", icon: "H2", keywords: "subtitle heading", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", hint: "Small title", icon: "H3", keywords: "heading small", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "todo", label: "Checklist", hint: "Tasks with checkboxes", icon: "☑", keywords: "todo task checkbox check list", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "bullet", label: "Bullet list", hint: "Simple list", icon: "•", keywords: "unordered list ul", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "number", label: "Numbered list", hint: "1, 2, 3…", icon: "1.", keywords: "ordered list ol", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "table", label: "Table", hint: "3 × 3 grid", icon: "▦", keywords: "grid spreadsheet", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "quote", label: "Quote", hint: "Callout or citation", icon: "❝", keywords: "blockquote citation", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code block", hint: "Monospace code", icon: "{}", keywords: "pre snippet", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "divider", label: "Divider", hint: "Horizontal line", icon: "—", keywords: "hr line separator rule", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: "highlight", label: "Highlight", hint: "Mark text in yellow", icon: "🖍", keywords: "marker mark", run: (e) => e.chain().focus().toggleHighlight().run() },
  { id: "date", label: "Today's date", hint: today(), icon: "📅", keywords: "date day now", run: (e) => e.chain().focus().insertContent(today()).run() },
  { id: "time", label: "Current time", hint: "Insert the time", icon: "🕒", keywords: "time clock now", run: (e) => e.chain().focus().insertContent(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })).run() },
];

export interface SlashState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

/** If the cursor is right after "/word" in a text block (not code), returns where it is. */
export function detectSlash(editor: Editor): SlashState | null {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.spec.code || !$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)\/([\p{L}0-9]{0,20})$/u.exec(textBefore);
  if (!m) return null;
  const query = m[1];
  const from = $from.pos - query.length - 1;
  const coords = view.coordsAtPos($from.pos);
  return { query, from, to: $from.pos, left: coords.left, top: coords.bottom + 6 };
}

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.includes(q));
}

export function SlashMenu({ state, items, index, onPick, onHover }: { state: SlashState; items: SlashItem[]; index: number; onPick: (i: SlashItem) => void; onHover: (i: number) => void }) {
  const top = Math.min(state.top, window.innerHeight - 340);
  return (
    <div
      role="listbox"
      aria-label="Insert block"
      data-slash-menu
      style={{
        position: "fixed",
        left: Math.min(state.left, window.innerWidth - 280),
        top: Math.max(8, top),
        width: 260,
        maxHeight: 320,
        overflowY: "auto",
        zIndex: 10000,
        background: "hsl(var(--card))",
        color: "hsl(var(--foreground))",
        border: "var(--nb-border)",
        boxShadow: "var(--nb-shadow)",
        padding: 4,
      }}
    >
      {items.length === 0 ? (
        <div style={{ padding: "8px 10px", fontSize: 12, opacity: 0.7 }}>No matching blocks</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => {
              e.preventDefault(); // keep editor focus
              onPick(item);
            }}
            onMouseEnter={() => onHover(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "6px 8px",
              border: "none",
              background: i === index ? "#FFD700" : "transparent",
              color: i === index ? "#000" : "inherit",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <span style={{ width: 28, height: 28, border: "var(--nb-border)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>{item.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 800, fontSize: 13 }}>{item.label}</span>
              <span style={{ display: "block", fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.hint}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
