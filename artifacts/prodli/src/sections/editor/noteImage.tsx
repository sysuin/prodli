// Pictures in notes, with a size and a caption. Click a picture to see the
// size buttons (S · M · L · Full) and a drag handle on its right edge, and to
// add a caption underneath. Saved as <figure data-type="note-image">; plain
// <img> (older notes, pasted HTML) still loads.

import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useRef, useState } from "react";

export const IMAGE_SIZES = [
  { label: "S", width: 33 },
  { label: "M", width: 50 },
  { label: "L", width: 75 },
  { label: "Full", width: 100 },
] as const;

/** Pure: a width in % from a drag (clamped to 15–100, whole numbers). */
export function widthFromDrag(startPx: number, dx: number, containerPx: number): number {
  if (containerPx <= 0) return 100;
  return Math.max(15, Math.min(100, Math.round(((startPx + dx) / containerPx) * 100)));
}

const pct = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : null;
};

function ImageView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const width = pct(node.attrs.width);
  const caption = (node.attrs.caption as string) || "";
  const [live, setLive] = useState<number | null>(null);
  const wrap = useRef<HTMLElement | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const editable = editor.isEditable;
  const shown = live ?? width ?? 100;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startPx = img.current?.getBoundingClientRect().width ?? 0;
    const containerPx = wrap.current?.getBoundingClientRect().width ?? 0;
    let last = shown;
    const move = (ev: PointerEvent) => {
      last = widthFromDrag(startPx, ev.clientX - startX, containerPx);
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      updateAttributes({ width: last >= 100 ? null : last });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <NodeViewWrapper as="figure" data-type="note-image" className={`note-figure${selected ? " is-selected" : ""}`} ref={(el: HTMLElement | null) => (wrap.current = el)}>
      <div className="note-figure-frame" style={{ width: `${shown}%` }} data-drag-handle>
        <img ref={img} src={node.attrs.src as string} alt={(node.attrs.alt as string) || ""} title={(node.attrs.title as string) || undefined} className="note-image" loading="lazy" draggable={false} />
        {editable && selected && (
          <>
            <span className="note-figure-resize" role="slider" aria-label="Picture width" aria-valuemin={15} aria-valuemax={100} aria-valuenow={shown} tabIndex={-1} onPointerDown={startDrag} contentEditable={false} />
            <span className="note-figure-sizes" contentEditable={false}>
              {IMAGE_SIZES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={(width ?? 100) === s.width}
                  title={`${s.width}% wide`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ width: s.width >= 100 ? null : s.width })}
                >
                  {s.label}
                </button>
              ))}
            </span>
          </>
        )}
      </div>
      {(caption || (editable && selected)) && (
        <figcaption contentEditable={false}>
          {editable ? (
            <input
              value={caption}
              placeholder="Add a caption…"
              aria-label="Picture caption"
              maxLength={300}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  editor.commands.focus();
                }
              }}
            />
          ) : (
            caption
          )}
        </figcaption>
      )}
    </NodeViewWrapper>
  );
}

export const NoteImage = Image.extend({
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
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
