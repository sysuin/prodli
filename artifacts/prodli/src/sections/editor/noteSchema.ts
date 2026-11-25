// The schema of ProdLi's own note blocks (callout, link to another note, picture
// with caption): how they're read from and written to HTML, with no React and no
// node views. The note editor (blocks.tsx, noteImage.tsx) adds its node views and
// commands on top; the phone app's editor (prodli-mobile/editor-web) uses these
// as they are, so both write exactly the same HTML.

import { mergeAttributes, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";

/** A picture width in percent (10–100), or null. */
export const pct = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : null;
};

export const CalloutSchema = Node.create({
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
});

export const NoteLinkSchema = Node.create({
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
});

export const NoteImageSchema = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => pct(el.getAttribute("data-width") ?? el.querySelector?.("img")?.getAttribute("data-width")),
        renderHTML: (a) => (a.width ? { "data-width": a.width } : {}),
      },
      caption: {
        default: "",
        parseHTML: (el) => (el.tagName === "FIGURE" ? el.querySelector("figcaption")?.textContent?.trim() ?? "" : ""),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure[data-type="note-image"]',
        getAttrs: (el) => {
          const i = (el as HTMLElement).querySelector("img");
          return i?.getAttribute("src") ? { src: i.getAttribute("src"), alt: i.getAttribute("alt"), title: i.getAttribute("title") } : false;
        },
      },
      { tag: "img[src]" },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { "data-width": w, ...imgAttrs } = HTMLAttributes as Record<string, unknown>;
    const width = pct(w);
    const img = ["img", mergeAttributes(imgAttrs, { class: "note-image", ...(width ? { style: `width:${width}%`, "data-width": width } : {}) })];
    const caption = (node.attrs.caption as string) || "";
    return ["figure", { "data-type": "note-image", class: "note-figure", ...(width ? { "data-width": width } : {}) }, img, ...(caption ? [["figcaption", {}, caption]] : [])] as never;
  },
});
