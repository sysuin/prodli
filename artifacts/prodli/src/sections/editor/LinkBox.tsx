// The link box (Ctrl/⌘+K, 🔗, or Edit on a link): a small field next to the
// text instead of the browser's prompt. Enter applies, Esc cancels, Remove
// takes the link off.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { placeMenu } from "./menuPlace";

export interface LinkBoxState {
  from: number;
  to: number;
  left: number;
  top: number;
  bottom: number;
  href: string;
}

/** Pure: what the user typed → a safe link, or null (empty, or a javascript:/data: link). */
export function normalizeLink(input: string): string | null {
  const url = input.trim();
  if (!url || url === "https://") return null;
  const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
  return /^(javascript|data|vbscript):/i.test(href) ? null : href;
}

export function linkBoxFor(editor: Editor): LinkBoxState {
  const { from, to } = editor.state.selection;
  const start = editor.view.coordsAtPos(from);
  return { from, to, left: start.left, top: start.top, bottom: editor.view.coordsAtPos(to).bottom, href: (editor.getAttributes("link").href as string | undefined) ?? "" };
}

export function LinkBox({ editor, state, onClose }: { editor: Editor; state: LinkBoxState; onClose: () => void }) {
  const [value, setValue] = useState(state.href);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [height, setHeight] = useState(44);
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  }, []);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);

  const restore = () => editor.chain().focus().setTextSelection({ from: state.from, to: state.to });
  const apply = () => {
    const href = normalizeLink(value);
    if (!href) {
      if (state.href) restore().extendMarkRange("link").unsetLink().run();
      else editor.commands.focus();
      return onClose();
    }
    if (state.from === state.to && !state.href) {
      // Nothing selected: insert the address itself as the link text.
      restore().insertContent({ type: "text", text: value.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      restore().extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  };
  const pos = placeMenu({ left: state.left, top: state.top, bottom: state.bottom }, { width: 340, height }, { width: window.innerWidth, height: window.innerHeight });
  const btn = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "4px 8px", fontWeight: 800, fontSize: 11, textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "inherit" };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Link"
      data-testid="link-box"
      style={{ position: "fixed", left: pos.left, top: pos.top, width: 340, zIndex: 10001, display: "flex", gap: 6, alignItems: "center", padding: 6, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)" }}
    >
      <span aria-hidden="true">🔗</span>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            editor.commands.focus();
            onClose();
          }
        }}
        placeholder="Paste or type a link"
        aria-label="Link address"
        style={{ flex: 1, minWidth: 0, border: "var(--nb-border)", padding: "5px 7px", fontSize: 13, background: "hsl(var(--background))", color: "inherit", fontFamily: "inherit" }}
      />
      <button type="button" style={{ ...btn, background: "#FFD700", color: "#000" }} onClick={apply}>
        {state.href ? "Save" : "Add"}
      </button>
      {state.href && (
        <button
          type="button"
          style={btn}
          onClick={() => {
            restore().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}
