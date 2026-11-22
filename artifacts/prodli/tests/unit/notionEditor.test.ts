import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { blockStartAt, currentKind, deleteBlock, duplicateBlock, moveBlock, turnInto } from "../../src/sections/editor/blockOps";
import { colorIdOf, textColor } from "../../src/sections/editor/colors";
import { filterNotesForLink } from "../../src/sections/editor/NotePicker";
import { htmlToMarkdown } from "../../src/lib/markdownExport";
import type { Note } from "../../src/types";

let editor: Editor | null = null;
const make = (content: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, TaskList, TaskItem, Details, DetailsSummary, DetailsContent], content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.textContent));
  // StarterKit keeps an empty paragraph at the end of the note.
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
};
const startOf = (e: Editor, text: string) => {
  let pos = -1;
  e.state.doc.forEach((n, offset) => {
    if (pos < 0 && n.textContent === text) pos = offset;
  });
  return pos;
};

describe("block moves", () => {
  it("moves a block down and up, and stops at the ends", () => {
    const e = make("<p>A</p><p>B</p><p>C</p>");
    expect(moveBlock(e, startOf(e, "A"), "down")).toBe(true);
    expect(texts(e)).toEqual(["B", "A", "C"]);
    expect(moveBlock(e, startOf(e, "C"), "up")).toBe(true);
    expect(texts(e)).toEqual(["B", "C", "A"]);
    expect(moveBlock(e, startOf(e, "B"), "up")).toBe(false);
    expect(moveBlock(e, startOf(e, "A"), "down")).toBe(false);
  });
  it("moves whole lists as one block", () => {
    const e = make("<p>Intro</p><ul><li><p>one</p></li><li><p>two</p></li></ul>");
    moveBlock(e, startOf(e, "onetwo"), "up");
    expect(texts(e)).toEqual(["onetwo", "Intro"]);
  });
  it("duplicates and deletes a block, never leaving the note empty", () => {
    const e = make("<h2>Title</h2>");
    duplicateBlock(e, 0);
    expect(texts(e)).toEqual(["Title", "Title"]);
    deleteBlock(e, 0);
    deleteBlock(e, 0);
    expect(texts(e)).toEqual([""]);
    expect(e.state.doc.firstChild?.type.name).toBe("paragraph");
  });
  it("finds the top-level block around the cursor", () => {
    const e = make("<p>A</p><ul><li><p>deep</p></li></ul>");
    const inside = startOf(e, "deep") + 3;
    expect(blockStartAt(e, inside)).toBe(startOf(e, "deep"));
  });
});

describe("turn into", () => {
  it("changes a paragraph into a heading, a list, a toggle and back", () => {
    const e = make("<p>Hello</p>");
    e.commands.setTextSelection(2);
    turnInto(e, "h2");
    expect(currentKind(e)).toBe("h2");
    turnInto(e, "bullet");
    expect(currentKind(e)).toBe("bullet");
    expect(e.getHTML()).toContain("<ul>");
    turnInto(e, "todo");
    expect(currentKind(e)).toBe("todo");
    turnInto(e, "text");
    expect(currentKind(e)).toBe("text");
    expect(e.getHTML().replace(/(<p><\/p>)+$/, "")).toBe("<p>Hello</p>");
    turnInto(e, "toggle");
    expect(e.getHTML()).toContain("<details");
  });
});

describe("note link search", () => {
  const n = (id: string, title: string, updatedAt = "2026-11-01", extra: Partial<Note> = {}) => ({ id, title, content: "", createdAt: updatedAt, updatedAt, ...extra }) as Note;
  const notes = [n("a", "Copy deck"), n("b", "Launch plan"), n("c", "Product copy", "2026-11-20"), n("t", "Copy template", "2026-11-21", { template: true })];
  it("ranks title starts first, then word starts, and skips the note itself and templates", () => {
    expect(filterNotesForLink(notes, "cop", null).map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterNotesForLink(notes, "", "b").map((x) => x.id)).toEqual(["c", "a"]);
    expect(filterNotesForLink(notes, "zzz", null)).toEqual([]);
  });
});

describe("colours", () => {
  it("saves theme variables and reads them back", () => {
    expect(textColor("red")).toBe("var(--note-red)");
    expect(colorIdOf("var(--note-blue-bg)")).toBe("blue");
    expect(colorIdOf("#ff0000")).toBeNull();
  });
});

describe("Markdown export of the new blocks", () => {
  it("writes callouts as quotes with their icon, toggles as bold headings, note links as names", () => {
    const md = htmlToMarkdown(`<div data-type="callout" data-emoji="⚠️" data-color="orange"><p>Keep it short.</p></div><details><summary>Timeline</summary><div data-type="detailsContent"><p>Mon: draft</p></div></details><p>See <a data-type="note-link" data-note-id="n2" href="#note-n2">Copy deck</a> and <span style="color: var(--note-red)">red</span>.</p>`);
    expect(md).toContain("> ⚠️ Keep it short.");
    expect(md).toContain("**Timeline**");
    expect(md).toContain("Mon: draft");
    expect(md).toContain("See Copy deck and red.");
  });
});
