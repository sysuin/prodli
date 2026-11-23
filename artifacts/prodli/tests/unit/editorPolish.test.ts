import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { deleteBlock, duplicateBlock, insertParagraphAfter, itemStartAt, moveBlock } from "../../src/sections/editor/blockOps";
import { placeMenu } from "../../src/sections/editor/menuPlace";
import { isBlankNote, notePreview, plainTextOf } from "../../src/sections/editor/NoteList";
import { normalizeLink } from "../../src/sections/editor/LinkBox";
import { fitsInNote, fitWithin, isNoteImage, MAX_NOTE_IMAGE_HTML } from "../../src/lib/noteImages";
import type { Note } from "../../src/types";

let editor: Editor | null = null;
const make = (content: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })], content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const items = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.descendants((n) => {
    if (n.type.name === "listItem" || n.type.name === "taskItem") out.push(n.firstChild?.textContent ?? "");
    return true;
  });
  return out;
};
const posOf = (e: Editor, text: string) => {
  let pos = -1;
  e.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text === text) pos = p;
    return pos < 0;
  });
  return pos;
};

describe("single list items (block handle, Alt+Shift+↑/↓)", () => {
  it("finds the list item around the cursor, or the top-level block outside lists", () => {
    const e = make("<p>Intro</p><ul><li><p>milk</p></li><li><p>eggs</p></li></ul>");
    const eggs = itemStartAt(e, posOf(e, "eggs"));
    expect(e.state.doc.nodeAt(eggs!)?.type.name).toBe("listItem");
    expect(itemStartAt(e, posOf(e, "Intro"))).toBe(0);
  });

  it("moves one item within its list and stops at the ends", () => {
    const e = make("<ul><li><p>milk</p></li><li><p>eggs</p></li><li><p>bread</p></li></ul>");
    expect(moveBlock(e, itemStartAt(e, posOf(e, "eggs"))!, "up")).toBe(true);
    expect(items(e)).toEqual(["eggs", "milk", "bread"]);
    expect(moveBlock(e, itemStartAt(e, posOf(e, "eggs"))!, "up")).toBe(false);
    expect(moveBlock(e, itemStartAt(e, posOf(e, "bread"))!, "down")).toBe(false);
  });

  it("deletes, duplicates and adds items; deleting the last item removes the list", () => {
    const e = make("<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><p>call</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>email</p></li></ul><p>end</p>");
    duplicateBlock(e, itemStartAt(e, posOf(e, "email"))!);
    expect(items(e)).toEqual(["call", "email", "email"]);
    insertParagraphAfter(e, itemStartAt(e, posOf(e, "call"))!);
    expect(items(e)).toEqual(["call", "", "email", "email"]);
    let added: { checked?: boolean } | null = null;
    e.state.doc.descendants((n) => {
      if (n.type.name === "taskItem" && n.textContent === "" && !added) added = n.attrs as { checked?: boolean };
      return true;
    });
    expect(added).toMatchObject({ checked: false });
    const one = make("<ul><li><p>only</p></li></ul><p>after</p>");
    expect(deleteBlock(one, itemStartAt(one, posOf(one, "only"))!)).toBe(true);
    expect(one.getHTML()).not.toContain("<ul");
    expect(one.getText()).toContain("after");
  });
});

describe("menus open where there's room", () => {
  const vp = { width: 1000, height: 800 };
  it("below the line when it fits, above it near the bottom, inside the window", () => {
    expect(placeMenu({ left: 100, top: 100, bottom: 120 }, { width: 260, height: 300 }, vp)).toEqual({ left: 100, top: 126 });
    expect(placeMenu({ left: 100, top: 700, bottom: 720 }, { width: 260, height: 300 }, vp)).toEqual({ left: 100, top: 394 });
    expect(placeMenu({ left: 900, top: 100, bottom: 120 }, { width: 260, height: 300 }, vp).left).toBe(732);
  });
});

describe("notes list and empty notes", () => {
  const note = (content: string, extra: Partial<Note> = {}): Note => ({ id: "n", title: "Untitled", content, createdAt: "", updatedAt: "", autoTitle: true, ...extra });
  it("joins inline formatting without stray spaces", () => {
    expect(plainTextOf("<p>Some <strong>bold</strong> text and a <a href='x'>link</a>.</p>")).toBe("Some bold text and a link.");
    expect(notePreview(note("<h1>Trip</h1><p>a <em>b</em>, c</p><table><tr><td>x</td><td>y</td></tr></table>", { title: "Trip" }), 90)).toBe("a b, c · x y");
  });
  it("knows a note nobody wrote in", () => {
    expect(isBlankNote(note(""))).toBe(true);
    expect(isBlankNote(note("<h1></h1>"))).toBe(true);
    expect(isBlankNote(note("<h1></h1><p> </p>"))).toBe(true);
    expect(isBlankNote(note("<p>hi</p>"))).toBe(false);
    expect(isBlankNote(note('<img src="data:image/webp;base64,AAA">'))).toBe(false);
    expect(isBlankNote(note("", { icon: "🚀" }))).toBe(false);
    expect(isBlankNote(note("", { autoTitle: false, title: "Named" }))).toBe(false);
    expect(isBlankNote(note("", { template: true }))).toBe(false);
  });
});

describe("links and pictures", () => {
  it("turns what you type into a safe link", () => {
    expect(normalizeLink("example.com/eggs")).toBe("https://example.com/eggs");
    expect(normalizeLink("http://a.b")).toBe("http://a.b");
    expect(normalizeLink("sam@acme.com")).toBe("mailto:sam@acme.com");
    expect(normalizeLink("  ")).toBeNull();
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("data:text/html,x")).toBeNull();
  });
  it("shrinks pictures and keeps notes within the sync limit", () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(isNoteImage({ type: "image/png" })).toBe(true);
    expect(isNoteImage({ type: "image/svg+xml" })).toBe(false);
    expect(fitsInNote(1000, 200_000)).toBe(true);
    expect(fitsInNote(MAX_NOTE_IMAGE_HTML - 10, 200_000)).toBe(false);
  });
});
