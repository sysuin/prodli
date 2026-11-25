// What the phone app's note editor adds to TenTap's start kit (bold, lists,
// checklists, links, headings, quotes, colour, highlights…) so it can edit every
// block this editor writes: tables, code blocks, dividers, toggles, callouts,
// pictures with captions, links to other notes and background colours. Schema
// only (no React, no node views), with the same HTML as extensions.ts:
// the phone loads these in its own editor bundle (prodli-mobile/editor-web), and
// tests/unit/phoneEditable.test.ts checks every block survives a round trip.

import type { AnyExtension } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { TableKit } from "@tiptap/extension-table";
import { BackgroundColor } from "@tiptap/extension-text-style";
import { CalloutSchema, NoteImageSchema, NoteLinkSchema } from "./noteSchema";

export function phoneEditorExtensions(): AnyExtension[] {
  return [
    TableKit.configure({ table: { resizable: true } }),
    // The note editor's code block adds colours on top (lowlight); the HTML is the same.
    CodeBlock.configure({ defaultLanguage: null }),
    HorizontalRule,
    Details.configure({ persist: true, HTMLAttributes: { class: "note-toggle" } }),
    DetailsSummary,
    DetailsContent,
    // TenTap's colour bridge brings the textStyle mark this attaches to.
    BackgroundColor,
    // Replaces TenTap's image bridge (left out on the phone): same node name, plus captions and sizes.
    NoteImageSchema.configure({ allowBase64: true, HTMLAttributes: { loading: "lazy" } }),
    CalloutSchema,
    NoteLinkSchema,
  ];
}
