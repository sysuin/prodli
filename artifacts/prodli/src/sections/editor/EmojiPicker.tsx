// A small emoji picker (page icons and callout icons), with an optional row of
// colours (callout background). Closes on Escape or a click outside.

import { useEffect, useRef } from "react";
import { NOTE_COLORS } from "./colors";

export const EMOJIS = [
  "💡", "📌", "⭐", "✅", "⚠️", "❗", "❓", "🔥", "🚀", "🎯", "📝", "📄",
  "📅", "⏰", "📊", "📈", "💰", "🧠", "💬", "📣", "🔒", "🔑", "🛠️", "⚙️",
  "🐛", "🧪", "📦", "🏠", "✈️", "🍎", "☕", "🎉", "❤️", "👍", "👀", "🙏",
  "😀", "🤔", "😅", "🌱", "🌍", "☀️", "🌙", "📚", "🎵", "🏃", "💼", "🗂️",
];

export function EmojiPicker({
  onPick,
  onClose,
  onRemove,
  colors,
  align = "left",
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  onRemove?: () => void;
  colors?: { value: string; options: readonly string[]; onPick: (c: string) => void };
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick an icon"
      data-emoji-picker
      contentEditable={false}
      style={{ position: "absolute", top: "calc(100% + 4px)", [align]: 0, zIndex: 10001, width: 268, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 8 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Icon ${e}`}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(e)}
            style={{ border: "none", background: "transparent", fontSize: 18, lineHeight: "28px", height: 30, cursor: "pointer", borderRadius: 4 }}
            className="emoji-cell"
          >
            {e}
          </button>
        ))}
      </div>
      {colors && (
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }} role="group" aria-label="Background colour">
          {colors.options.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`${NOTE_COLORS.find((x) => x.id === c)?.label ?? c} background`}
              aria-pressed={colors.value === c}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => colors.onPick(c)}
              style={{ width: 22, height: 22, border: colors.value === c ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--foreground) / 0.3)", background: `var(--note-${c}-bg)`, cursor: "pointer", padding: 0 }}
            />
          ))}
        </div>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} style={{ marginTop: 8, border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 11, fontWeight: 800, padding: "3px 8px", cursor: "pointer" }}>
          Remove icon
        </button>
      )}
    </div>
  );
}
