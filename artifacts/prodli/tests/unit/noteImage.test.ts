import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NoteImage, widthFromDrag, IMAGE_SIZES } from "../../src/sections/editor/noteImage";
import { htmlToMarkdown } from "../../src/lib/markdownExport";

let editor: Editor | null = null;
// Without a DOM-rendered React view the node falls back to renderHTML, which is what's saved.
const make = (content: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, NoteImage.extend({ addNodeView: () => null }).configure({ allowBase64: true })], content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("pictures with a size and a caption", () => {
  it("keeps size and caption when saved and loaded again", () => {
    const e = make('<figure data-type="note-image" data-width="50"><img src="data:image/webp;base64,AAA" alt="Chart"><figcaption>Q3 sales</figcaption></figure><p>after</p>');
    const img = e.state.doc.firstChild!;
    expect(img.type.name).toBe("image");
    expect(img.attrs).toMatchObject({ width: 50, caption: "Q3 sales", alt: "Chart" });
    const html = e.getHTML();
    expect(html).toContain('<figure data-type="note-image"');
    expect(html).toContain('data-width="50"');
    expect(html).toContain("<figcaption>Q3 sales</figcaption>");
    const again = make(html);
    expect(again.state.doc.firstChild!.attrs).toMatchObject({ width: 50, caption: "Q3 sales" });
  });

  it("still loads plain pictures from older notes and pasted pages", () => {
    const e = make('<p>x</p><img src="https://example.com/a.png" alt="A">');
    let found: Record<string, unknown> | null = null;
    e.state.doc.descendants((n) => {
      if (n.type.name === "image") found = n.attrs;
      return true;
    });
    expect(found).toMatchObject({ src: "https://example.com/a.png", width: null, caption: "" });
  });

  it("sizes from a drag stay between 15% and 100%", () => {
    expect(widthFromDrag(400, 0, 800)).toBe(50);
    expect(widthFromDrag(400, 1000, 800)).toBe(100);
    expect(widthFromDrag(400, -390, 800)).toBe(15);
    expect(IMAGE_SIZES.map((s) => s.width)).toEqual([33, 50, 75, 100]);
  });

  it("exports to Markdown with the caption under the picture", () => {
    const md = htmlToMarkdown('<figure data-type="note-image"><img src="https://example.com/a.png" alt="Chart"><figcaption>Q3 sales</figcaption></figure>');
    expect(md).toContain("![Chart](https://example.com/a.png)");
    expect(md).toContain("*Q3 sales*");
  });
});
