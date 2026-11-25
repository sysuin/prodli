// The phone app edits notes with TenTap's start kit, which knows less than this
// editor. Its check (prodli-mobile/src/lib/html.ts) opens a note read-only when
// it has anything TenTap would drop. This runs the check on HTML written by
// this editor itself, so a new block type here can't silently become editable
// (and lossy) on the phone.
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../src/sections/editor/extensions";
import { readOnlyReason } from "../../../prodli-mobile/src/lib/html";

const editor = new Editor({ extensions: buildExtensions(), content: "<p></p>" });
const html = (make: (e: Editor) => unknown) => {
  make(editor);
  return editor.getHTML();
};

describe("notes from this editor on the phone", () => {
  it.each<[string, (e: Editor) => unknown]>([
    ["text colour", (e) => e.chain().setContent("<p>red</p>").selectAll().setColor("#dc2626").run()],
    ["highlight", (e) => e.chain().setContent("<p>hi</p>").selectAll().toggleHighlight({ color: "#fde68a" }).run()],
    ["checklist", (e) => e.chain().setContent("<p>t</p>").selectAll().toggleTaskList().run()],
    ["link", (e) => e.chain().setContent("<p>go</p>").selectAll().setLink({ href: "https://example.com" }).run()],
    ["headings, quote and lists", (e) => e.commands.setContent("<h1>T</h1><blockquote><p>q</p></blockquote><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><ol><li><p>1</p></li></ol><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>")],
  ])("%s stays editable", (_name, make) => {
    expect(readOnlyReason(html(make))).toBeNull();
  });

  it.each<[string, (e: Editor) => unknown, string]>([
    ["callout", (e) => e.chain().setContent("<p>Remember</p>").selectAll().setCallout().run(), "a callout"],
    ["toggle", (e) => e.chain().setContent("<p>More</p>").selectAll().setDetails().run(), "a toggle"],
    ["code block", (e) => e.chain().setContent("<p>let x</p>").selectAll().toggleCodeBlock().run(), "a code block"],
    ["divider", (e) => e.chain().setContent("<p>a</p>").setHorizontalRule().run(), "a divider"],
    ["background colour", (e) => e.chain().setContent("<p>y</p>").selectAll().setBackgroundColor("#fef3c7").run(), "a background colour"],
    ["link to another note", (e) => e.chain().setContent("<p>See </p>").focus("end").insertNoteLink({ id: "n1", title: "Plan" }).run(), "a link to another note"],
    ["picture", (e) => e.commands.setContent('<figure data-type="note-image"><img src="data:image/webp;base64,AAA"></figure>'), "a picture"],
    ["table", (e) => e.chain().setContent("<p></p>").insertTable({ rows: 2, cols: 2 }).run(), "a table"],
  ])("a %s opens read-only", (_name, make, what) => {
    expect(readOnlyReason(html(make))).toContain(what);
  });
});
