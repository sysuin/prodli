// Notion-style text and background colours for notes. Saved as CSS variables
// (style="color: var(--note-red)") so they follow light and dark mode; the
// variables live in index.css. Elsewhere (Markdown, other apps) they fall back
// to the normal text colour.

export const NOTE_COLORS = [
  { id: "gray", label: "Gray" },
  { id: "brown", label: "Brown" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "pink", label: "Pink" },
  { id: "red", label: "Red" },
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number]["id"];

export const textColor = (c: NoteColor) => `var(--note-${c})`;
export const bgColor = (c: NoteColor) => `var(--note-${c}-bg)`;

/** Which palette colour a saved style value is ("var(--note-red)" → "red"). */
export function colorIdOf(value: string | null | undefined): NoteColor | null {
  const m = /var\(--note-([a-z]+)(-bg)?\)/.exec(value ?? "");
  return m && NOTE_COLORS.some((c) => c.id === m[1]) ? (m[1] as NoteColor) : null;
}
