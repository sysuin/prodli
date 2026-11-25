// The phone app edits notes in its own editor bundle (prodli-mobile/editor-web):
// TenTap's start kit plus phoneEditorExtensions(). Here HTML written by this
// note editor goes through an editor with the same extensions, and must come
// back unchanged, so editing a note on the phone can never drop anything.
// The phone's safety check (prodli-mobile/src/lib/html.ts) must then let these
// notes be edited.
import { describe, expect, it } from "vitest";
import { Editor, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { buildExtensions } from "../../src/sections/editor/extensions";
import { phoneEditorExtensions } from "../../src/sections/editor/phoneExtensions";
import { readOnlyReason } from "../../../prodli-mobile/src/lib/html";
import { PHONE_LINK_ATTRIBUTES } from "../../../prodli-mobile/src/lib/editorConfig";

/** TenTap 1.1's start kit as the phone configures it (NoteEditor.native.tsx), without its image bridge. */
function phoneKit(): AnyExtension[] {
  return [
    StarterKit.configure({ codeBlock: false, horizontalRule: false, trailingNode: false, gapcursor: false, listKeymap: false, link: { openOnClick: false, autolink: true, HTMLAttributes: PHONE_LINK_ATTRIBUTES } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    ...phoneEditorExtensions(),
  ];
}

const desk = new Editor({ extensions: buildExtensions(), content: "<p></p>" });
const phone = new Editor({ extensions: phoneKit(), content: "<p></p>" });
const written = (make: (e: Editor) => unknown) => {
  make(desk);
  return desk.getHTML();
};
const throughPhone = (html: string) => {
  phone.commands.setContent(html);
  return phone.getHTML();
};
/** What this editor itself keeps when it opens the note again (ProseMirror tidies a little, e.g. a space at the end of a line). */
const throughDesk = (html: string) => {
  desk.commands.setContent(html);
  return desk.getHTML();
};

const NOTES: [string, (e: Editor) => unknown][] = [
  ["text colour", (e) => e.chain().setContent("<p>red</p>").selectAll().setColor("#dc2626").run()],
  ["background colour", (e) => e.chain().setContent("<p>yellow</p>").selectAll().setBackgroundColor("var(--note-yellow-bg)").run()],
  ["highlight", (e) => e.chain().setContent("<p>hi</p>").selectAll().toggleHighlight({ color: "#fde68a" }).run()],
  ["link", (e) => e.chain().setContent("<p>go</p>").selectAll().setLink({ href: "https://example.com" }).run()],
  ["checklist, nested", (e) => e.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>sub</p></li></ul></li></ul>')],
  ["headings, quote, lists, marks", (e) => e.commands.setContent("<h1>T</h1><h3>t</h3><blockquote><p>q</p></blockquote><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><ol><li><p>1</p></li></ol><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code><br>line</p>")],
  ["callout", (e) => e.chain().setContent("<p>Remember</p>").selectAll().setCallout({ emoji: "🚀", color: "blue" }).run()],
  ["toggle (open)", (e) => e.commands.setContent('<details class="note-toggle" open=""><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details>')],
  ["toggle (closed)", (e) => e.chain().setContent("<p>More</p>").selectAll().setDetails().run()],
  ["code block with a language", (e) => e.commands.setContent('<pre><code class="language-js">const a = 1;\nconsole.log(a);</code></pre>')],
  ["code block without one", (e) => e.chain().setContent("<p>plain</p>").selectAll().toggleCodeBlock().run()],
  ["divider", (e) => e.chain().setContent("<p>a</p>").setHorizontalRule().run()],
  ["table", (e) => e.chain().setContent("<p></p>").insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run()],
  ["link to another note", (e) => e.chain().setContent("<p>See </p>").focus("end").insertNoteLink({ id: "n1", title: "Plan" }).run()],
  ["picture with a caption and size", (e) => e.commands.setContent('<figure data-type="note-image" data-width="60"><img src="data:image/webp;base64,AAA" alt="Board" data-width="60"><figcaption>The whiteboard</figcaption></figure>')],
  ["picture without", (e) => e.commands.setContent('<figure data-type="note-image"><img src="data:image/webp;base64,AAA"></figure>')],
];

describe("notes from this editor on the phone", () => {
  it.each(NOTES)("a note with %s comes back from the phone's editor as this editor keeps it", (_name, make) => {
    const html = written(make);
    expect(throughPhone(html)).toBe(throughDesk(html));
  });

  it.each(NOTES)("a note with %s can be edited on the phone", (_name, make) => {
    expect(readOnlyReason(written(make))).toBeNull();
  });

  it("a note with everything at once survives too", () => {
    const html = NOTES.map(([, make]) => written(make)).join("");
    const all = throughDesk(html);
    expect(throughPhone(all)).toBe(all);
  });
});
