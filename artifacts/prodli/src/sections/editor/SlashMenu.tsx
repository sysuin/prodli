import { useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { placeMenu } from "./menuPlace";
import { NOTE_COLORS, textColor, type NoteColor } from "./colors";

export interface SlashItem {
  id: string;
  group: "Basic blocks" | "Insert" | "Style";
  label: string;
  hint: string;
  icon: string;
  keywords: string;
  run: (editor: Editor) => void;
  /** Colour items: the palette colour (shown on the icon). */
  color?: NoteColor;
}

const today = () => new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", group: "Basic blocks", label: "Text", hint: "Plain paragraph", icon: "¶", keywords: "paragraph plain", run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h1", group: "Basic blocks", label: "Heading 1", hint: "Big section title  #", icon: "H1", keywords: "title heading big", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", group: "Basic blocks", label: "Heading 2", hint: "Medium title  ##", icon: "H2", keywords: "subtitle heading", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", group: "Basic blocks", label: "Heading 3", hint: "Small title  ###", icon: "H3", keywords: "heading small", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "todo", group: "Basic blocks", label: "Checklist", hint: "Tasks with checkboxes  [ ]", icon: "☑", keywords: "todo task checkbox check list", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "bullet", group: "Basic blocks", label: "Bullet list", hint: "Simple list  -", icon: "•", keywords: "unordered list ul", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "number", group: "Basic blocks", label: "Numbered list", hint: "1, 2, 3…  1.", icon: "1.", keywords: "ordered list ol", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "toggle", group: "Basic blocks", label: "Toggle list", hint: "Hide details under a heading", icon: "▸", keywords: "toggle collapse expand details fold accordion", run: (e) => e.chain().focus().setDetails().run() },
  { id: "callout", group: "Basic blocks", label: "Callout", hint: "Make a note stand out", icon: "💡", keywords: "callout box tip info warning note", run: (e) => e.chain().focus().setCallout().run() },
  { id: "quote", group: "Basic blocks", label: "Quote", hint: "Citation  >", icon: "❝", keywords: "blockquote citation", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "table", group: "Basic blocks", label: "Table", hint: "3 × 3 grid", icon: "▦", keywords: "grid spreadsheet", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "code", group: "Basic blocks", label: "Code block", hint: "Monospace code  ```", icon: "{}", keywords: "pre snippet", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "divider", group: "Basic blocks", label: "Divider", hint: "Horizontal line  ---", icon: "—", keywords: "hr line separator rule", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: "notelink", group: "Insert", label: "Link to note", hint: "Link another note  [[", icon: "↗", keywords: "link page note mention reference backlink", run: (e) => e.chain().focus().insertContent("[[").run() },
  { id: "image", group: "Insert", label: "Image", hint: "Upload a picture (or paste one)", icon: "🖼", keywords: "picture photo image screenshot upload", run: () => window.dispatchEvent(new CustomEvent("prodli-insert-image")) },
  { id: "date", group: "Insert", label: "Today's date", hint: today(), icon: "📅", keywords: "date day now", run: (e) => e.chain().focus().insertContent(today()).run() },
  { id: "time", group: "Insert", label: "Current time", hint: "Insert the time", icon: "🕒", keywords: "time clock now", run: (e) => e.chain().focus().insertContent(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })).run() },
  { id: "highlight", group: "Style", label: "Highlight", hint: "Mark text in yellow", icon: "🖍", keywords: "marker mark", run: (e) => e.chain().focus().toggleHighlight().run() },
  ...NOTE_COLORS.map((c) => ({ id: `color-${c.id}`, group: "Style" as const, label: `${c.label} text`, hint: "Colour the text", icon: "A", keywords: `color colour ${c.id} text`, run: (e: Editor) => e.chain().focus().setColor(textColor(c.id)).run(), color: c.id })),
];

export interface SlashState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
  /** Top of the cursor's line (the menu opens above it when there's no room below). */
  lineTop: number;
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
  return { query, from, to: $from.pos, left: coords.left, top: coords.bottom, lineTop: coords.top };
}

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_ITEMS.filter((i) => !i.color);
  return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.includes(q));
}

export function SlashMenu({ state, items, index, onPick, onHover }: { state: SlashState; items: SlashItem[]; index: number; onPick: (i: SlashItem) => void; onHover: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320);
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  }, [items.length]);
  const pos = placeMenu({ left: state.left, top: state.lineTop, bottom: state.top }, { width: 260, height }, { width: window.innerWidth, height: window.innerHeight });
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Insert block"
      data-slash-menu
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
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
          <div key={item.id}>
          {(i === 0 || items[i - 1].group !== item.group) && <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8, padding: "6px 8px 2px" }}>{item.group}</div>}
          <button
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
            <span style={{ width: 28, height: 28, border: "var(--nb-border)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0, background: "hsl(var(--background))", color: item.color ? textColor(item.color) : "hsl(var(--foreground))" }}>{item.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 800, fontSize: 13 }}>{item.label}</span>
              <span style={{ display: "block", fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.hint}</span>
            </span>
          </button>
          </div>
        ))
      )}
    </div>
  );
}
