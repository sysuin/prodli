// Notion-style block actions for the Editor: move a block up or down, duplicate
// or delete it, and turn it into another kind of block. A "block" is a direct
// child of the document (a paragraph, heading, list, quote, callout, toggle…),
// or a single item of a list or checklist (itemStartAt), so one bullet can be
// moved or deleted on its own.
// Used by the ⋮⋮ block handle, its menu and the keyboard shortcuts
// (Alt+Shift+↑/↓ move, Ctrl/⌘+D duplicate).

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

/** Start position of the top-level block that contains `pos` (or the cursor). */
export function blockStartAt(editor: Editor, pos = editor.state.selection.from): number | null {
  const { doc } = editor.state;
  if (doc.childCount === 0) return null;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth === 0) {
    // Between blocks (e.g. a selected block): the block right after.
    const index = Math.min($pos.index(0), doc.childCount - 1);
    let start = 0;
    for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
    return start;
  }
  return $pos.before(1);
}

const ITEM_TYPES = new Set(["listItem", "taskItem"]);
export const isListItem = (name: string | undefined) => !!name && ITEM_TYPES.has(name);

/** Start of the innermost list item around `pos` (or the cursor); otherwise of its top-level block. */
export function itemStartAt(editor: Editor, pos = editor.state.selection.from): number | null {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) if (ITEM_TYPES.has($pos.node(d).type.name)) return $pos.before(d);
  return blockStartAt(editor, pos);
}

/** Moves the block (or list item) starting at `start` one place up or down among its siblings. False at the top/bottom. */
export function moveBlock(editor: Editor, start: number, dir: "up" | "down"): boolean {
  const { state } = editor;
  const $start = state.doc.resolve(start);
  const parent = $start.parent;
  const index = $start.index();
  if (index >= parent.childCount || parent.child(index) !== state.doc.nodeAt(start)) return false;
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= parent.childCount) return false;
  const node = parent.child(index);
  const other = parent.child(target);
  // Keep the cursor at the same spot inside the moved block.
  const offsetInBlock = Math.max(0, state.selection.from - start);
  const tr = state.tr.delete(start, start + node.nodeSize);
  const insertAt = dir === "up" ? start - other.nodeSize : start + other.nodeSize;
  tr.insert(insertAt, node);
  const cursor = Math.min(insertAt + Math.min(offsetInBlock, node.nodeSize - 1), tr.doc.content.size);
  const $c = tr.doc.resolve(cursor);
  tr.setSelection($c.parent.inlineContent ? TextSelection.create(tr.doc, cursor) : TextSelection.near($c));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Puts a copy of the block right after it. */
export function duplicateBlock(editor: Editor, start: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(start);
  if (!node) return false;
  const after = start + node.nodeSize;
  const tr = state.tr.insert(after, node.copy(node.content));
  tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function deleteBlock(editor: Editor, start: number): boolean {
  const { state } = editor;
  let node = state.doc.nodeAt(start);
  if (!node) return false;
  // The only item of a list: remove the (now empty) list with it.
  let $s = state.doc.resolve(start);
  while ($s.depth > 0 && $s.parent.childCount === 1 && (ITEM_TYPES.has(node.type.name) || /list/i.test($s.parent.type.name))) {
    start = $s.before($s.depth);
    node = $s.parent;
    $s = state.doc.resolve(start);
  }
  const tr = state.tr.delete(start, start + node.nodeSize);
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start, tr.doc.content.size))));
  editor.view.dispatch(tr);
  return true;
}

/** Selects the whole block (for dragging, or before "turn into"). */
export function selectBlock(editor: Editor, start: number): void {
  const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, start));
  editor.view.dispatch(tr);
}

/** Puts the cursor inside the block (at its start), so commands act on it. */
export function focusBlock(editor: Editor, start: number): void {
  const pos = Math.min(start + 1, editor.state.doc.content.size);
  editor.chain().focus().setTextSelection(TextSelection.near(editor.state.doc.resolve(pos)).from).run();
}

/** Adds an empty paragraph after the block (a new item after a list item) and puts the cursor in it. */
export function insertParagraphAfter(editor: Editor, start: number, text = ""): void {
  const node = editor.state.doc.nodeAt(start);
  if (!node) return;
  const after = start + node.nodeSize;
  if (ITEM_TYPES.has(node.type.name)) {
    const { schema } = editor.state;
    const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
    const item = node.type.create(node.type.name === "taskItem" ? { checked: false } : null, para);
    const tr = editor.state.tr.insert(after, item);
    tr.setSelection(TextSelection.create(tr.doc, after + 2 + text.length));
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return;
  }
  editor
    .chain()
    .focus()
    .insertContentAt(after, { type: "paragraph", content: text ? [{ type: "text", text }] : [] })
    .setTextSelection(after + 1 + text.length)
    .run();
}

export type TurnInto = "text" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "toggle" | "quote" | "callout" | "code";

export const TURN_INTO: { id: TurnInto; label: string; icon: string }[] = [
  { id: "text", label: "Text", icon: "¶" },
  { id: "h1", label: "Heading 1", icon: "H1" },
  { id: "h2", label: "Heading 2", icon: "H2" },
  { id: "h3", label: "Heading 3", icon: "H3" },
  { id: "bullet", label: "Bullet list", icon: "•" },
  { id: "number", label: "Numbered list", icon: "1." },
  { id: "todo", label: "Checklist", icon: "☑" },
  { id: "toggle", label: "Toggle list", icon: "▸" },
  { id: "quote", label: "Quote", icon: "❝" },
  { id: "callout", label: "Callout", icon: "💡" },
  { id: "code", label: "Code block", icon: "{}" },
];

/** The kind of block the cursor is in, for the "Turn into" menu. */
export function currentKind(editor: Editor): TurnInto {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("taskList")) return "todo";
  if (editor.isActive("bulletList")) return "bullet";
  if (editor.isActive("orderedList")) return "number";
  if (editor.isActive("details")) return "toggle";
  if (editor.isActive("callout")) return "callout";
  if (editor.isActive("blockquote")) return "quote";
  if (editor.isActive("codeBlock")) return "code";
  return "text";
}

/** Turns the block with the cursor into another kind (unwrapping lists, quotes and callouts first). */
export function turnInto(editor: Editor, kind: TurnInto): void {
  const from = currentKind(editor);
  if (from === kind) return;
  let chain = editor.chain().focus();
  // Back to a plain paragraph first.
  if (from === "bullet") chain = chain.toggleBulletList();
  else if (from === "number") chain = chain.toggleOrderedList();
  else if (from === "todo") chain = chain.toggleTaskList();
  else if (from === "quote") chain = chain.lift("blockquote");
  else if (from === "callout") chain = chain.lift("callout");
  else if (from === "toggle") chain = chain.unsetDetails();
  else if (from === "code") chain = chain.toggleCodeBlock();
  chain = chain.setParagraph();
  switch (kind) {
    case "h1":
    case "h2":
    case "h3":
      chain = chain.setHeading({ level: Number(kind[1]) as 1 | 2 | 3 });
      break;
    case "bullet":
      chain = chain.toggleBulletList();
      break;
    case "number":
      chain = chain.toggleOrderedList();
      break;
    case "todo":
      chain = chain.toggleTaskList();
      break;
    case "toggle":
      chain = chain.setDetails();
      break;
    case "quote":
      chain = chain.toggleBlockquote();
      break;
    case "callout":
      chain = chain.setCallout();
      break;
    case "code":
      chain = chain.toggleCodeBlock();
      break;
  }
  chain.run();
}
