import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { BackgroundColor, Color, TextStyle } from "@tiptap/extension-text-style";
import { BlockKeys, Callout, NoteLink } from "./blocks";

/** All Editor features in one place. */
export function buildExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false, // plain click edits; Ctrl/⌘+click (or the bubble's Open) follows the link
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
        if (node.type.name === "detailsSummary") return "Toggle";
        return "Write something, or type “/” for commands…";
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Highlight.configure({ multicolor: true }),
    Typography,
    TextStyle,
    Color,
    BackgroundColor,
    Details.configure({
      persist: true,
      HTMLAttributes: { class: "note-toggle" },
      renderToggleButton: ({ element, isOpen }) => {
        element.setAttribute("aria-label", isOpen ? "Collapse toggle" : "Expand toggle");
        element.setAttribute("aria-expanded", String(isOpen));
      },
    }),
    DetailsSummary,
    DetailsContent,
    Callout,
    NoteLink,
    BlockKeys,
  ];
}
