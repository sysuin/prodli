// Notion-style block handle: hovering a block shows "+" (add a block below,
// opening the / menu) and "⋮⋮" (drag to move the block; click for the block
// menu: turn into, colour, duplicate, move, delete). Hidden on touch screens.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { blockStartAt, currentKind, deleteBlock, duplicateBlock, focusBlock, insertParagraphAfter, isListItem, itemStartAt, moveBlock, selectBlock, turnInto, TURN_INTO } from "./blockOps";
import { bgColor, NOTE_COLORS, textColor, type NoteColor } from "./colors";

interface Hover {
  start: number;
  top: number;
  height: number;
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

/** The block (or list item) element under the pointer's height, and its doc position. */
function blockAtY(editor: Editor, y: number): { el: HTMLElement; start: number } | null {
  const root = editor.view.dom as HTMLElement;
  const kids = Array.from(root.children) as HTMLElement[];
  let best: HTMLElement | null = null;
  for (const el of kids) {
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    if (y >= r.top - 4 && y <= r.bottom + 4) {
      best = el;
      break;
    }
  }
  if (!best) return null;
  // Inside a list or checklist: the single item under the pointer (the innermost one, for nested lists).
  if (best.matches("ul, ol")) {
    let item: HTMLElement | null = null;
    for (const li of Array.from(best.querySelectorAll("li")) as HTMLElement[]) {
      const r = li.getBoundingClientRect();
      if (r.height && y >= r.top - 2 && y <= r.bottom + 2) item = li; // later = deeper
    }
    if (item) {
      try {
        const pos = editor.view.posAtDOM(item, 0);
        const start = itemStartAt(editor, pos);
        if (start !== null && isListItem(editor.state.doc.nodeAt(start)?.type.name)) return { el: item, start };
      } catch {
        // fall back to the whole list
      }
    }
  }
  let pos: number;
  try {
    pos = editor.view.posAtDOM(best, 0);
  } catch {
    return null;
  }
  const start = blockStartAt(editor, pos);
  return start === null ? null : { el: best, start };
}

export function BlockHandle({ editor, pageRef }: { editor: Editor | null; pageRef: RefObject<HTMLDivElement | null> }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<{ start: number; top: number } | null>(null);
  const dragging = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const track = useCallback(
    (e: MouseEvent) => {
      // A drag that ended without a dragend event (e.g. dropped outside the window).
      if (dragging.current && e.buttons === 0) dragging.current = false;
      if (!editor || dragging.current || menu || isTouch()) return;
      const page = pageRef.current;
      if (!page) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".block-handle")) return;
      const hit = blockAtY(editor, e.clientY);
      if (!hit) return setHover(null);
      const pr = page.getBoundingClientRect();
      const r = hit.el.getBoundingClientRect();
      // Line up with the first line of text (headings are taller).
      const cs = getComputedStyle(hit.el);
      const firstLine = Math.min(r.height, parseFloat(cs.lineHeight) || 24);
      setHover({ start: hit.start, top: r.top - pr.top + Math.max(0, (firstLine - 24) / 2) + (parseFloat(cs.paddingTop) || 0), height: r.height });
    },
    [editor, pageRef, menu],
  );

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !editor) return;
    const leave = (e: MouseEvent) => {
      if (!dragging.current && !menu && !(e.relatedTarget as HTMLElement | null)?.closest?.(".block-handle")) setHover(null);
    };
    const dropped = () => {
      dragging.current = false;
      setHover(null);
    };
    page.addEventListener("mousemove", track);
    page.addEventListener("mouseleave", leave);
    page.addEventListener("drop", dropped);
    const hide = () => !menu && setHover(null);
    editor.on("update", hide);
    return () => {
      page.removeEventListener("mousemove", track);
      page.removeEventListener("mouseleave", leave);
      page.removeEventListener("drop", dropped);
      editor.off("update", hide);
    };
  }, [editor, pageRef, track, menu]);

  // Close the block menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node) && !(e.target as HTMLElement).closest(".block-handle")) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        editor?.commands.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu, editor]);

  if (!editor || !editor.isEditable) return null;

  const add = (start: number) => {
    const node = editor.state.doc.nodeAt(start);
    if (isListItem(node?.type.name)) {
      insertParagraphAfter(editor, start); // a new empty item below
      setHover(null);
      return;
    }
    if (node?.type.name === "paragraph" && node.content.size === 0) {
      editor.chain().focus().setTextSelection(start + 1).insertContent("/").run();
    } else {
      insertParagraphAfter(editor, start, "/");
    }
    setHover(null);
  };

  const onDragStart = (e: React.DragEvent, start: number) => {
    const node = editor.state.doc.nodeAt(start);
    if (!node) return;
    dragging.current = true;
    selectBlock(editor, start);
    const sel = editor.state.selection;
    const slice = sel.content();
    // ProseMirror moves the dragged block when it's dropped inside the editor.
    (editor.view as unknown as { dragging: unknown }).dragging = { slice, move: true, node: sel instanceof NodeSelection ? sel : undefined };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.textContent);
    const dom = editor.view.nodeDOM(start) as HTMLElement | null;
    if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
  };

  const h = menu ? { start: menu.start, top: menu.top, height: 0 } : hover;
  return (
    <>
      {h && (
        <div className="block-handle" data-testid="block-handle" style={{ top: h.top, left: -48 }}>
          <button type="button" aria-label="Add a block below" title="Add a block below (opens the / menu)" onMouseDown={(e) => e.preventDefault()} onClick={() => add(h.start)}>
            +
          </button>
          <button
            type="button"
            draggable
            aria-label="Drag to move, or click for block options"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            title="Drag to move · Click for options"
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => onDragStart(e, h.start)}
            onDragEnd={() => {
              dragging.current = false;
              setHover(null);
            }}
            onClick={() => {
              if (menu) return setMenu(null);
              focusBlock(editor, h.start);
              setMenu({ start: h.start, top: h.top });
            }}
          >
            ⋮⋮
          </button>
        </div>
      )}
      {menu && (
        <BlockMenu
          ref={menuRef}
          editor={editor}
          start={menu.start}
          top={menu.top + 28}
          onDone={() => {
            setMenu(null);
            setHover(null);
          }}
        />
      )}
    </>
  );
}

const item: CSSProperties = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", border: "none", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 13, fontWeight: 600 };
const head: CSSProperties = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8, padding: "6px 8px 2px" };
const kbd: CSSProperties = { marginLeft: "auto", fontSize: 10, opacity: 0.8, fontWeight: 700 };

function BlockMenu({ ref, editor, start, top, onDone }: { ref: RefObject<HTMLDivElement | null>; editor: Editor; start: number; top: number; onDone: () => void }) {
  const [tab, setTab] = useState<"main" | "turn" | "color">("main");
  const node = editor.state.doc.nodeAt(start);
  if (!node) return null;
  const kind = currentKind(editor);
  const isCallout = node.type.name === "callout";
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl";

  const act = (fn: () => void) => () => {
    fn();
    onDone();
  };
  const colorBlock = (kindOf: "text" | "bg", c: NoteColor | null) => {
    if (isCallout && kindOf === "bg") {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(start, undefined, { ...node.attrs, color: c ?? "gray" });
        return true;
      }).run();
      return;
    }
    const from = start + 1;
    const to = start + node.nodeSize - 1;
    let chain = editor.chain().focus().setTextSelection({ from, to });
    if (kindOf === "text") chain = c ? chain.setColor(textColor(c)) : chain.unsetColor();
    else chain = c ? chain.setBackgroundColor(bgColor(c)) : chain.unsetBackgroundColor();
    chain.setTextSelection(from).run();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Block options"
      data-testid="block-menu"
      style={{ position: "absolute", top, left: -48, zIndex: 10000, width: 240, maxHeight: 420, overflowY: "auto", background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 4 }}
    >
      {tab === "main" && (
        <>
          <button role="menuitem" style={item} onClick={() => setTab("turn")}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>↻</span> Turn into <span style={kbd}>{TURN_INTO.find((t) => t.id === kind)?.label} ›</span>
          </button>
          <button role="menuitem" style={item} onClick={() => setTab("color")}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>🎨</span> Colour <span style={kbd}>›</span>
          </button>
          <div style={{ height: 1, background: "hsl(var(--foreground) / 0.12)", margin: "4px 0" }} />
          <button role="menuitem" style={item} onClick={act(() => duplicateBlock(editor, start))}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>⧉</span> Duplicate <span style={kbd}>{mod}+D</span>
          </button>
          <button role="menuitem" style={item} onClick={act(() => moveBlock(editor, start, "up"))}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>↑</span> Move up <span style={kbd}>Alt+Shift+↑</span>
          </button>
          <button role="menuitem" style={item} onClick={act(() => moveBlock(editor, start, "down"))}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>↓</span> Move down <span style={kbd}>Alt+Shift+↓</span>
          </button>
          <button role="menuitem" style={{ ...item, color: "var(--danger-text)" }} onClick={act(() => deleteBlock(editor, start))}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>🗑</span> Delete
          </button>
        </>
      )}
      {tab === "turn" && (
        <>
          <button style={{ ...item, fontSize: 11, fontWeight: 800 }} onClick={() => setTab("main")}>‹ Back</button>
          <div style={head}>Turn into</div>
          {TURN_INTO.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === kind}
              style={{ ...item, background: t.id === kind ? "hsl(var(--foreground) / 0.08)" : "transparent" }}
              onClick={act(() => {
                focusBlock(editor, start);
                turnInto(editor, t.id);
              })}
            >
              <span aria-hidden style={{ width: 22, height: 22, border: "1px solid hsl(var(--foreground) / 0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>{t.icon}</span>
              {t.label}
              {t.id === kind && <span style={kbd}>✓</span>}
            </button>
          ))}
        </>
      )}
      {tab === "color" && (
        <>
          <button style={{ ...item, fontSize: 11, fontWeight: 800 }} onClick={() => setTab("main")}>‹ Back</button>
          <div style={head}>Text colour</div>
          <button role="menuitem" style={item} onClick={act(() => colorBlock("text", null))}>
            <span aria-hidden style={{ width: 22, textAlign: "center", fontWeight: 900 }}>A</span> Default
          </button>
          {NOTE_COLORS.map((c) => (
            <button key={`t-${c.id}`} role="menuitem" style={item} onClick={act(() => colorBlock("text", c.id))}>
              <span aria-hidden style={{ width: 22, textAlign: "center", fontWeight: 900, color: textColor(c.id) }}>A</span> {c.label}
            </button>
          ))}
          <div style={head}>Background</div>
          <button role="menuitem" style={item} onClick={act(() => colorBlock("bg", null))}>
            <span aria-hidden style={{ width: 22, height: 18, border: "1px solid hsl(var(--foreground) / 0.25)" }} /> Default
          </button>
          {NOTE_COLORS.map((c) => (
            <button key={`b-${c.id}`} role="menuitem" style={item} onClick={act(() => colorBlock("bg", c.id))}>
              <span aria-hidden style={{ width: 22, height: 18, background: bgColor(c.id), border: "1px solid hsl(var(--foreground) / 0.15)" }} /> {c.label} background
            </button>
          ))}
        </>
      )}
    </div>
  );
}
