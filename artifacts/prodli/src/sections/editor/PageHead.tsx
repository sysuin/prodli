// The top of a note, Notion-style: an optional cover band and page icon, with
// "Add icon" / "Add cover" showing on hover. Saved on the note (Note.icon,
// Note.cover) and synced with it.

import { useState } from "react";
import type { Note } from "../../types";
import { EmojiPicker, EMOJIS } from "./EmojiPicker";

export const NOTE_COVERS = [
  { id: "sunrise", label: "Sunrise", css: "linear-gradient(120deg, #FFD700 0%, #FF6B6B 100%)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(120deg, #00BCD4 0%, #3F51B5 100%)" },
  { id: "forest", label: "Forest", css: "linear-gradient(120deg, #66BB6A 0%, #00796B 100%)" },
  { id: "grape", label: "Grape", css: "linear-gradient(120deg, #B388FF 0%, #FF4FA3 100%)" },
  { id: "sand", label: "Sand", css: "linear-gradient(120deg, #F4EBDD 0%, #D7B98E 100%)" },
  { id: "night", label: "Night", css: "linear-gradient(120deg, #1F2A44 0%, #000000 100%)" },
  { id: "yellow", label: "Yellow", css: "#FFD700" },
  { id: "cyan", label: "Cyan", css: "#00BCD4" },
] as const;

const coverCss = (id: string | undefined) => NOTE_COVERS.find((c) => c.id === id)?.css;

export function PageHead({ note, onChange }: { note: Note; onChange: (patch: Partial<Note>) => void }) {
  const [picking, setPicking] = useState(false);
  const [covers, setCovers] = useState(false);
  const cover = coverCss(note.cover);
  const nextCover = () => {
    const i = NOTE_COVERS.findIndex((c) => c.id === note.cover);
    onChange({ cover: NOTE_COVERS[(i + 1) % NOTE_COVERS.length].id });
  };

  return (
    <div data-testid="page-head" style={{ marginBottom: note.icon ? 4 : 0 }}>
      {cover && (
        <div className="page-cover" role="img" aria-label="Cover" style={{ background: cover }}>
          <div className="page-head-actions" style={{ position: "absolute", right: 8, bottom: 6, background: "hsl(var(--card) / 0.85)", borderRadius: 4 }}>
            <button type="button" onClick={() => setCovers((v) => !v)} aria-expanded={covers}>
              Change cover
            </button>
            <button type="button" onClick={() => onChange({ cover: undefined })}>
              Remove
            </button>
          </div>
          {covers && (
            <div role="dialog" aria-label="Pick a cover" style={{ position: "absolute", right: 8, top: "calc(100% + 4px)", zIndex: 20, display: "grid", gridTemplateColumns: "repeat(4, 56px)", gap: 6, padding: 8, background: "hsl(var(--card))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)" }}>
              {NOTE_COVERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`${c.label} cover`}
                  aria-pressed={note.cover === c.id}
                  onClick={() => {
                    onChange({ cover: c.id });
                    setCovers(false);
                  }}
                  style={{ height: 34, border: note.cover === c.id ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.2)", background: c.css, cursor: "pointer", padding: 0 }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {note.icon && (
        <div style={{ position: "relative", marginTop: cover ? -34 : 8, width: "fit-content" }}>
          <button type="button" className="page-icon" aria-label="Change the page icon" title="Change icon" onClick={() => setPicking((v) => !v)}>
            {note.icon}
          </button>
          {picking && (
            <EmojiPicker
              onPick={(e) => {
                onChange({ icon: e });
                setPicking(false);
              }}
              onRemove={() => {
                onChange({ icon: undefined });
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
      {(!note.icon || !cover) && (
      <div className="page-head-actions" style={{ marginTop: cover && !note.icon ? 6 : 2 }}>
        {!note.icon && (
          <button type="button" onClick={() => onChange({ icon: EMOJIS[Math.floor(Math.random() * 24)] })} title="Add a page icon">
            ☺ Add icon
          </button>
        )}
        {!cover && (
          <button type="button" onClick={nextCover} title="Add a cover">
            ▭ Add cover
          </button>
        )}
      </div>
      )}
    </div>
  );
}
