// "A" in the selection bubble: Notion-style text and background colours for
// the selected text (colors.ts; saved as CSS variables so they follow dark mode).

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { bgColor, colorIdOf, NOTE_COLORS, textColor } from "./colors";

export function ColorButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const current = colorIdOf(editor.getAttributes("textStyle").color as string | undefined);
  const currentBg = colorIdOf(editor.getAttributes("textStyle").backgroundColor as string | undefined);
  const cell = { width: 24, height: 24, cursor: "pointer", padding: 0, fontWeight: 900, fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" } as const;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        title="Text colour"
        aria-label="Text colour"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="tb-flat"
        style={{ ...(currentBg ? { background: bgColor(currentBg) } : {}), color: current ? textColor(current) : "hsl(var(--foreground))", minWidth: 30, height: 30, fontWeight: 900, textDecoration: "underline", textDecorationThickness: 3 }}
      >
        A
      </button>
      {open && (
        <div role="dialog" aria-label="Colours" data-color-menu style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 10002, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 8, width: 292 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.65, marginBottom: 4 }}>Text</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            <button type="button" aria-label="Default text colour" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().unsetColor().run()} style={{ ...cell, border: !current ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.25)", background: "transparent", color: "hsl(var(--foreground))" }}>A</button>
            {NOTE_COLORS.map((c) => (
              <button key={c.id} type="button" aria-label={`${c.label} text`} aria-pressed={current === c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setColor(textColor(c.id)).run()} style={{ ...cell, border: current === c.id ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.25)", background: "transparent", color: textColor(c.id) }}>
                A
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.65, margin: "8px 0 4px" }}>Background</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            <button type="button" aria-label="No background" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().unsetBackgroundColor().run()} style={{ ...cell, border: !currentBg ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.25)", background: "transparent", color: "hsl(var(--foreground))" }}>⌀</button>
            {NOTE_COLORS.map((c) => (
              <button key={c.id} type="button" aria-label={`${c.label} background`} aria-pressed={currentBg === c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setBackgroundColor(bgColor(c.id)).run()} style={{ ...cell, border: currentBg === c.id ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.15)", background: bgColor(c.id) }} />
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
