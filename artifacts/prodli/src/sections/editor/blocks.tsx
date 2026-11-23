// Notion-style blocks for the Editor:
// - Callout: a tinted box with an icon (click the icon to change it).
// - Note link: an inline link to another note ("[[" or / → Link to note);
//   it shows the note's current title and opens it on click.
// - Block keys: Alt+Shift+↑/↓ moves the block, Ctrl/⌘+D duplicates it.
// Toggle lists come from @tiptap/extension-details; colours from
// @tiptap/extension-text-style (see colors.ts).

import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useState, useSyncExternalStore } from "react";
import { duplicateBlock, itemStartAt, moveBlock } from "./blockOps";
import { EmojiPicker } from "./EmojiPicker";
import { NOTE_COLORS, type NoteColor } from "./colors";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string; color?: NoteColor }) => ReturnType;
      toggleCallout: () => ReturnType;
    };
    noteLink: {
      insertNoteLink: (attrs: { id: string; title: string }) => ReturnType;
    };
  }
}

export const OPEN_NOTE_LINK_EVENT = "prodli:open-note-link";

// ── Callout ──────────────────────────────────────────────────────────────────

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [picking, setPicking] = useState(false);
  const emoji = (node.attrs.emoji as string) || "💡";
  const color = (node.attrs.color as string) || "gray";
  return (
    <NodeViewWrapper as="div" data-type="callout" data-color={color} className="note-callout">
      <span contentEditable={false} style={{ position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          className="note-callout-icon"
          aria-label="Change the callout icon"
          title="Change icon"
          disabled={!editor.isEditable}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPicking((v) => !v)}
        >
          {emoji}
        </button>
        {picking && (
          <EmojiPicker
            onPick={(e) => {
              updateAttributes({ emoji: e });
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
            colors={{ value: color, options: NOTE_COLORS.map((c) => c.id), onPick: (c) => updateAttributes({ color: c }) }}
          />
        )}
      </span>
      <NodeViewContent className="note-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") || "💡", renderHTML: (a) => ({ "data-emoji": a.emoji }) },
      color: { default: "gray", parseHTML: (el) => el.getAttribute("data-color") || "gray", renderHTML: (a) => ({ "data-color": a.color }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        () =>
        ({ commands, editor }) =>
          editor.isActive(this.name) ? commands.lift(this.name) : commands.wrapIn(this.name),
    };
  },
  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of a callout's first line takes the text out of the callout.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) return $from.index(d) === 0 && $from.depth === d + 1 ? editor.commands.lift(this.name) : false;
        }
        return false;
      },
    };
  },
});

// ── Note links ───────────────────────────────────────────────────────────────

/** Current note titles, kept up to date by the Editor (so links show renamed titles). */
const titles = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
export function setNoteTitles(notes: { id: string; title: string }[]): void {
  titles.clear();
  for (const n of notes) titles.set(n.id, n.title);
  version++;
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

function NoteLinkView({ node }: ReactNodeViewProps) {
  useSyncExternalStore(subscribe, () => version);
  const id = node.attrs.id as string;
  const current = titles.get(id);
  const missing = titles.size > 0 && current === undefined;
  const title = current || (node.attrs.title as string) || "Untitled";
  return (
    <NodeViewWrapper as="span" className={`note-link${missing ? " note-link-missing" : ""}`} data-type="note-link" data-link-id={id}>
      <a
        href={`#note-${id}`}
        contentEditable={false}
        title={missing ? "This note was deleted" : `Open “${title}”`}
        onClick={(e) => {
          e.preventDefault();
          if (!missing) window.dispatchEvent(new CustomEvent(OPEN_NOTE_LINK_EVENT, { detail: { id } }));
        }}
      >
        <span aria-hidden>↗ </span>
        {title}
      </a>
    </NodeViewWrapper>
  );
}

export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: "", parseHTML: (el) => el.getAttribute("data-note-id") || "", renderHTML: (a) => ({ "data-note-id": a.id }) },
      title: { default: "", parseHTML: (el) => (el.textContent || "").replace(/^↗\s*/, "") },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="note-link"]', priority: 60 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-type": "note-link", href: `#note-${node.attrs.id}` }), node.attrs.title || "Untitled"];
  },
  renderText({ node }) {
    return node.attrs.title || "Untitled";
  },
  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView);
  },
  addCommands() {
    return {
      insertNoteLink:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]).run(),
    };
  },
});

// ── Block keys ───────────────────────────────────────────────────────────────

export const BlockKeys = Extension.create({
  name: "blockKeys",
  addKeyboardShortcuts() {
    // Inside a list, these move or duplicate the list item; elsewhere, the whole block.
    const move = (dir: "up" | "down") => () => {
      const start = itemStartAt(this.editor);
      return start === null ? false : moveBlock(this.editor, start, dir);
    };
    return {
      "Alt-Shift-ArrowUp": move("up"),
      "Alt-Shift-ArrowDown": move("down"),
      "Mod-d": () => {
        const start = itemStartAt(this.editor);
        return start === null ? false : duplicateBlock(this.editor, start);
      },
    };
  },
});
