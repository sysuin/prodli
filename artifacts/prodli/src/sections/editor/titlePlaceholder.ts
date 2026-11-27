// "Untitled" in the empty title line (the note's first line, a Heading 1)
// wherever the cursor is. The Placeholder extension only shows a hint in the
// line you're on, so without this an untitled note shows no title at all.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const TitlePlaceholder = Extension.create({
  name: "titlePlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("titlePlaceholder"),
        props: {
          decorations: ({ doc }) => {
            const first = doc.firstChild;
            if (!first || first.type.name !== "heading" || first.attrs.level !== 1 || first.content.size > 0) return null;
            return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: "is-title-empty", "data-placeholder": "Untitled" })]);
          },
        },
      }),
    ];
  },
});
