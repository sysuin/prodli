// Screenshot to ProdLi (extension window, screenshot.html#<id>): crop the
// screenshot, mark it up (box, arrow, highlight, undo), optionally pull out the
// text with AI, and save it as a note or a to-do. Works with the mouse (drag)
// and the keyboard (arrows move the box, Shift+arrows resize it, Enter adds).

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { imageFileToDataUrl, NoteImageError } from "../lib/noteImages";
import { extractText, saveScreenshot, ScreenshotError } from "../lib/screenshot";
import {
  drawAnnotations,
  fitScale,
  fullRect,
  MIN_CROP,
  nudgeRect,
  PENDING_KEY,
  rectFromPoints,
  screenshotTitle,
  shapeFromBox,
  shapeFromDrag,
  startBox,
  strokeWidth,
  toImagePoint,
  TOOLS,
  touchesCrop,
  type Annotation,
  type PendingShot,
  type Point,
  type Rect,
  type Tool,
} from "../lib/screenshotCore";
import { storageSet } from "../lib/storage";

interface Edit {
  crop: Rect;
  shapes: Annotation[];
}

const btn = (primary: boolean, disabled = false, active = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled || active ? "none" : "var(--nb-shadow-sm)",
  background: primary || active ? "#FFD700" : "hsl(var(--card))",
  color: primary || active ? "#000" : "hsl(var(--foreground))",
  padding: "6px 10px",
  fontWeight: 800,
  fontSize: 12,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
});
const field: CSSProperties = { border: "var(--nb-border)", padding: "6px 8px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--background))", color: "hsl(var(--foreground))", width: "100%", boxSizing: "border-box" };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export function ScreenshotAnnotator({ shotId }: { shotId: string }) {
  const [shot, setShot] = useState<PendingShot | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tool, setTool] = useState<Tool>("crop");
  const [edit, setEdit] = useState<Edit>({ crop: { x: 0, y: 0, w: 1, h: 1 }, shapes: [] });
  const [history, setHistory] = useState<Edit[]>([]);
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [kbBox, setKbBox] = useState<Rect | null>(null);
  const [focused, setFocused] = useState(false);
  const [avail, setAvail] = useState({ w: 600, h: 400 });
  const [title, setTitle] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ocr" | "note" | "todo" | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [done, setDone] = useState<{ as: "note" | "todo"; noteId: string; title: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Point | null>(null);
  const lastNudge = useRef(0);

  const size = useMemo(() => (img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 1, h: 1 }), [img]);
  const scale = fitScale(size, avail);

  // The capture waits in session storage; it's removed once read (it can be several MB).
  useEffect(() => {
    document.title = "Screenshot to ProdLi";
    void (async () => {
      try {
        const got = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as PendingShot | undefined;
        if (!got || got.id !== shotId) return setLoadError("This screenshot is gone. Take a new one: right-click a page → Screenshot to ProdLi.");
        await chrome.storage.session.remove(PENDING_KEY);
        const image = new Image();
        image.onload = () => {
          setShot(got);
          setImg(image);
          setEdit({ crop: fullRect({ w: image.naturalWidth, h: image.naturalHeight }), shapes: [] });
          setTitle(screenshotTitle(got.title));
        };
        image.onerror = () => setLoadError("ProdLi couldn't open this screenshot. Take a new one.");
        image.src = got.dataUrl;
      } catch {
        setLoadError("ProdLi couldn't open this screenshot. Take a new one.");
      }
    })();
  }, [shotId]);

  // Fit the picture to the space it has (the window can be small).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // A little room around the picture for the keyboard focus ring.
    const ro = new ResizeObserver(([e]) => setAvail({ w: Math.max(80, e.contentRect.width - 12), h: Math.max(80, e.contentRect.height - 12) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const apply = useCallback(
    (next: Edit, coalesce = false) => {
      const now = Date.now();
      // Several arrow presses in a row undo together.
      if (!coalesce || now - lastNudge.current > 1000) setHistory((h) => [...h.slice(-49), edit]);
      lastNudge.current = coalesce ? now : 0;
      setEdit(next);
    },
    [edit],
  );
  const undo = useCallback(() => {
    if (!history.length) return;
    setEdit(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    lastNudge.current = 0;
  }, [history]);

  // Draw: picture, shapes, the crop (outside it dimmed), then what's being drawn.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(size.w * scale));
    const cssH = Math.max(1, Math.round(size.h * scale));
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.drawImage(img, 0, 0);
    const shapes = [...edit.shapes];
    if (draft && tool !== "crop") {
      const s = shapeFromDrag(tool, draft.a, draft.b, size);
      if (s) shapes.push(s);
    }
    const crop = draft && tool === "crop" ? rectFromPoints(draft.a, draft.b, size) : edit.crop;
    drawAnnotations(ctx, shapes, strokeWidth(crop));
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.fill("evenodd");
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeStyle = "#FFD700";
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    if (focused && tool !== "crop" && kbBox) {
      ctx.strokeStyle = "#000";
      ctx.strokeRect(kbBox.x, kbBox.y, kbBox.w, kbBox.h);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1 / scale;
      ctx.strokeRect(kbBox.x, kbBox.y, kbBox.w, kbBox.h);
    }
    ctx.restore();
  }, [img, size, scale, edit, draft, tool, kbBox, focused]);

  const pointAt = (e: React.PointerEvent) => toImagePoint(e.clientX, e.clientY, canvasRef.current!.getBoundingClientRect(), size);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointAt(e);
    dragRef.current = p;
    setDraft({ a: p, b: p });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) setDraft({ a: dragRef.current, b: pointAt(e) });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    if (!a) return;
    const b = pointAt(e);
    if (tool === "crop") {
      const r = rectFromPoints(a, b, size);
      if (r.w >= MIN_CROP && r.h >= MIN_CROP) apply({ ...edit, crop: r });
    } else {
      const s = shapeFromDrag(tool, a, b, size);
      if (s) apply({ ...edit, shapes: [...edit.shapes, s] });
    }
  };

  const onCanvasKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (done) return;
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.altKey ? 1 : Math.max(1, Math.round(10 / scale));
      if (tool === "crop") {
        const r = nudgeRect(edit.crop, e.key, e.shiftKey, step, fullRect(size), MIN_CROP);
        if (r) apply({ ...edit, crop: r }, true);
      } else {
        const r = nudgeRect(kbBox ?? startBox(edit.crop), e.key, e.shiftKey, step, fullRect(size), 4);
        if (r) setKbBox(r);
      }
    } else if (e.key === "Enter" && tool !== "crop") {
      e.preventDefault();
      apply({ ...edit, shapes: [...edit.shapes, shapeFromBox(tool, kbBox ?? startBox(edit.crop))] });
    }
  };

  // Shortcuts: C/R/A/H pick a tool, Ctrl/⌘+Z undoes (not while typing in a box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && done) return window.close();
      if (isTyping(e.target) || done) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, done]);

  /** The crop as a note-sized WebP (noteImages.ts), with or without the shapes. */
  const render = async (withShapes: boolean): Promise<string> => {
    const { crop, shapes } = edit;
    const c = document.createElement("canvas");
    c.width = crop.w;
    c.height = crop.h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img!, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    if (withShapes) {
      ctx.translate(-crop.x, -crop.y);
      drawAnnotations(ctx, shapes.filter((s) => touchesCrop(s, crop)), strokeWidth(crop));
    }
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new NoteImageError("ProdLi couldn't make the picture.");
    return imageFileToDataUrl(new File([blob], "screenshot.png", { type: "image/png" }));
  };

  const errorText = (err: unknown) => (err instanceof ScreenshotError || err instanceof NoteImageError ? err.message : "Something went wrong. Try again.");

  const pullText = async () => {
    setBusy("ocr");
    setStatus({ error: false, text: "Pulling out the text…" });
    try {
      const t = await extractText(await render(false));
      setText(t);
      setStatus({ error: false, text: t ? "Text added below. Check it, then save." : "No text found in this part." });
    } catch (err) {
      setStatus({ error: true, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (as: "note" | "todo") => {
    if (!shot) return;
    setBusy(as);
    setStatus(null);
    try {
      const name = title.trim() || screenshotTitle("");
      const r = await saveScreenshot(as, { image: await render(true), title: name, text: text?.trim() || undefined, url: shot.url || undefined });
      setDone({ as, noteId: r.note.id, title: r.todo?.title ?? r.note.title });
    } catch (err) {
      setStatus({ error: true, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const openInProdli = async () => {
    if (!done) return;
    await storageSet("activeNoteId", done.noteId);
    await storageSet("lastSection", done.as === "todo" ? "todos" : "editor");
    await chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    window.close();
  };

  const page: CSSProperties = { height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8, padding: 10, background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "Space Grotesk, Inter, sans-serif", overflow: "hidden" };

  if (loadError) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>📸 Screenshot to ProdLi</h1>
        <p role="alert" style={{ fontWeight: 600 }}>{loadError}</p>
        <div>
          <button type="button" style={btn(false)} onClick={() => window.close()}>Close</button>
        </div>
      </main>
    );
  }

  const cropLabel = `${edit.crop.w} × ${edit.crop.h}`;
  const working = busy !== null;
  return (
    <main style={page} data-testid="screenshot-annotator">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <h1 style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 8px 0 0" }}>📸 Screenshot</h1>
        <div role="toolbar" aria-label="Tools" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TOOLS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} title={`${t.label} (${t.key.toUpperCase()})`} disabled={!!done} onClick={() => setTool(t.id)} style={btn(false, !!done, tool === t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
          <button type="button" onClick={undo} disabled={!history.length || !!done} title="Undo (Ctrl+Z / ⌘Z)" style={btn(false, !history.length || !!done)}>
            ↶ Undo
          </button>
        </div>
      </div>

      <div ref={stageRef} style={{ flex: 1, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", border: "var(--nb-border)", background: "hsl(var(--muted))", overflow: "hidden" }}>
        {img && (
          <canvas
            ref={canvasRef}
            data-testid="shot-canvas"
            data-shapes={edit.shapes.length}
            data-crop={`${edit.crop.x},${edit.crop.y},${edit.crop.w},${edit.crop.h}`}
            tabIndex={0}
            role="application"
            aria-roledescription="screenshot editor"
            aria-label={`Screenshot. ${tool === "crop" ? "Drag to crop, or use the arrow keys to move the crop and Shift with the arrows to change its size." : "Drag to draw, or use the arrow keys to move the box, Shift with the arrows to change its size, and Enter to add it."}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => ((dragRef.current = null), setDraft(null))}
            onKeyDown={onCanvasKey}
            onFocus={() => {
              setFocused(true);
              if (!kbBox) setKbBox(startBox(edit.crop));
            }}
            onBlur={() => setFocused(false)}
            style={{ cursor: done ? "default" : "crosshair", touchAction: "none", display: "block" }}
          />
        )}
      </div>
      <div style={{ fontSize: 11, opacity: 0.8, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span aria-live="polite" data-testid="shot-crop">Crop: {cropLabel}</span>
        <span>Drag on the picture, or use the arrow keys (Shift resizes, Enter adds). C, R, A, H pick a tool.</span>
      </div>

      {done ? (
        <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div role="status" data-testid="shot-status" style={{ fontWeight: 700, flex: "1 1 200px" }}>
            ✓ {done.as === "todo" ? "Added to-do" : "Saved note"}: {done.title}
          </div>
          <button type="button" style={btn(true)} onClick={() => void openInProdli()}>Open in ProdLi</button>
          <button type="button" style={btn(false)} onClick={() => window.close()}>Close</button>
        </div>
      ) : (
        <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: 10, display: "grid", gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" placeholder="Title" maxLength={120} data-testid="shot-title" style={field} />
          {text !== null && (
            <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Text from the screenshot" placeholder="No text found" rows={3} data-testid="shot-text" style={{ ...field, resize: "vertical" }} />
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button type="button" disabled={working} onClick={() => void pullText()} title="Sends this part of the picture to ProdLi's AI to read its text. Nothing is kept on the server." style={btn(false, working)}>
              {busy === "ocr" ? "Reading…" : "✨ Pull out the text"}
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" disabled={working} onClick={() => window.close()} style={btn(false, working)}>Cancel</button>
            <button type="button" disabled={working} onClick={() => void save("todo")} style={btn(false, working)}>
              {busy === "todo" ? "Saving…" : "Save as to-do"}
            </button>
            <button type="button" disabled={working} onClick={() => void save("note")} style={btn(true, working)}>
              {busy === "note" ? "Saving…" : "Save as note"}
            </button>
          </div>
          {status && (
            <div role={status.error ? "alert" : "status"} data-testid="shot-status" style={{ fontSize: 12, fontWeight: 600, color: status.error ? "var(--danger-text)" : undefined }}>
              {status.text}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
