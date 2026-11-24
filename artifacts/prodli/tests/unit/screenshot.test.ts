import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  arrowHead,
  blockedPage,
  captureErrorMessage,
  clampRect,
  drawAnnotations,
  fitScale,
  isOcrImage,
  MAX_OCR_DATA_URL,
  MIN_SHAPE,
  nudgeRect,
  rectFromPoints,
  screenshotFits,
  screenshotNoteHtml,
  screenshotTitle,
  shapeFromBox,
  shapeFromDrag,
  startBox,
  strokeWidth,
  toImagePoint,
  touchesCrop,
  type Annotation,
  type Draw2D,
} from "../../src/lib/screenshotCore";
import { MAX_NOTE_IMAGE_HTML } from "../../src/lib/noteImages";
import { NoteImage } from "../../src/sections/editor/noteImage";
import { pickSnippets } from "../../src/lib/ask";
import type { Note, Todo } from "../../src/types";

const size = { w: 1000, h: 600 };

describe("crop math", () => {
  it("makes a rectangle from a drag in any direction, kept inside the picture", () => {
    expect(rectFromPoints({ x: 100, y: 50 }, { x: 400, y: 250 }, size)).toEqual({ x: 100, y: 50, w: 300, h: 200 });
    expect(rectFromPoints({ x: 400, y: 250 }, { x: 100, y: 50 }, size)).toEqual({ x: 100, y: 50, w: 300, h: 200 });
    expect(rectFromPoints({ x: -50, y: 500 }, { x: 1200, y: 900 }, size)).toEqual({ x: 0, y: 500, w: 1000, h: 100 });
    expect(rectFromPoints({ x: 10.4, y: 10.6 }, { x: 20.5, y: 30.2 }, size)).toEqual({ x: 10, y: 11, w: 10, h: 20 });
  });

  it("clamps a rectangle to whole pixels inside the picture", () => {
    expect(clampRect({ x: -5, y: 590, w: 2000, h: 100 }, size)).toEqual({ x: 0, y: 590, w: 1000, h: 10 });
    expect(clampRect({ x: 999.6, y: 0, w: 0, h: 0 }, size)).toEqual({ x: 999, y: 0, w: 1, h: 1 });
  });

  it("shrinks big screenshots to fit the window but never enlarges small ones", () => {
    expect(fitScale({ w: 2800, h: 1800 }, { w: 1400, h: 1800 })).toBe(0.5);
    expect(fitScale({ w: 2800, h: 1800 }, { w: 2800, h: 450 })).toBe(0.25);
    expect(fitScale({ w: 400, h: 300 }, { w: 1400, h: 900 })).toBe(1);
    expect(fitScale({ w: 0, h: 0 }, { w: 100, h: 100 })).toBe(1);
  });

  it("turns a mouse position on the shown picture into screenshot pixels", () => {
    // Shown at half size, 20 px from the left and 10 px from the top.
    const box = { left: 20, top: 10, width: 500, height: 300 };
    expect(toImagePoint(20, 10, box, size)).toEqual({ x: 0, y: 0 });
    expect(toImagePoint(270, 160, box, size)).toEqual({ x: 500, y: 300 });
    expect(toImagePoint(900, -40, box, size)).toEqual({ x: 1000, y: 0 });
  });

  it("moves and resizes with the arrow keys, staying inside and at least the minimum size", () => {
    const all = { x: 0, y: 0, ...size };
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(nudgeRect(r, "ArrowRight", false, 10, all)).toEqual({ x: 110, y: 100, w: 200, h: 100 });
    expect(nudgeRect(r, "ArrowUp", false, 500, all)).toEqual({ x: 100, y: 0, w: 200, h: 100 });
    expect(nudgeRect(r, "ArrowRight", false, 5000, all)).toEqual({ x: 800, y: 100, w: 200, h: 100 });
    expect(nudgeRect(r, "ArrowDown", true, 10, all)).toEqual({ x: 100, y: 100, w: 200, h: 110 });
    expect(nudgeRect(r, "ArrowLeft", true, 500, all, 16)).toEqual({ x: 100, y: 100, w: 16, h: 100 });
    expect(nudgeRect(r, "ArrowRight", true, 5000, all)).toEqual({ x: 100, y: 100, w: 900, h: 100 });
    expect(nudgeRect(r, "Enter", false, 10, all)).toBeNull();
  });

  it("starts the keyboard box in the middle of the crop", () => {
    expect(startBox({ x: 100, y: 0, w: 300, h: 90 })).toEqual({ x: 200, y: 30, w: 100, h: 30 });
  });
});

describe("shapes", () => {
  it("makes boxes, highlights and arrows from drags; tiny drags are ignored", () => {
    expect(shapeFromDrag("rect", { x: 50, y: 60 }, { x: 10, y: 20 }, size)).toEqual({ kind: "rect", x: 10, y: 20, w: 40, h: 40 });
    expect(shapeFromDrag("highlight", { x: 0, y: 0 }, { x: 100, y: 20 }, size)).toEqual({ kind: "highlight", x: 0, y: 0, w: 100, h: 20 });
    expect(shapeFromDrag("arrow", { x: 10, y: 10 }, { x: 1500, y: 300 }, size)).toEqual({ kind: "arrow", x1: 10, y1: 10, x2: 1000, y2: 300 });
    expect(shapeFromDrag("rect", { x: 10, y: 10 }, { x: 10 + MIN_SHAPE - 1, y: 10 }, size)).toBeNull();
    // A straight line has no area: no box.
    expect(shapeFromDrag("rect", { x: 10, y: 10 }, { x: 80, y: 10 }, size)).toBeNull();
  });

  it("makes shapes from the keyboard box (arrows go corner to corner)", () => {
    const box = { x: 10, y: 20, w: 30, h: 40 };
    expect(shapeFromBox("rect", box)).toEqual({ kind: "rect", ...box });
    expect(shapeFromBox("arrow", box)).toEqual({ kind: "arrow", x1: 10, y1: 20, x2: 40, y2: 60 });
  });

  it("picks a line width that suits the crop", () => {
    expect(strokeWidth({ w: 200, h: 100 })).toBe(3);
    expect(strokeWidth({ w: 1500, h: 900 })).toBe(6);
    expect(strokeWidth({ w: 9000, h: 100 })).toBe(14);
  });

  it("points the arrowhead back along the arrow", () => {
    const [a, b] = arrowHead(0, 0, 100, 0, 20);
    expect(a.x).toBeCloseTo(100 - 20 * Math.cos((28 * Math.PI) / 180));
    expect(b.x).toBeCloseTo(a.x);
    expect(a.y).toBeCloseTo(-b.y);
    expect(Math.abs(a.y)).toBeCloseTo(20 * Math.sin((28 * Math.PI) / 180));
  });

  it("knows which shapes are inside the crop", () => {
    const crop = { x: 100, y: 100, w: 100, h: 100 };
    expect(touchesCrop({ kind: "rect", x: 150, y: 150, w: 10, h: 10 }, crop)).toBe(true);
    expect(touchesCrop({ kind: "highlight", x: 0, y: 0, w: 50, h: 50 }, crop)).toBe(false);
    expect(touchesCrop({ kind: "arrow", x1: 0, y1: 150, x2: 120, y2: 150 }, crop)).toBe(true);
    expect(touchesCrop({ kind: "arrow", x1: 300, y1: 300, x2: 250, y2: 250 }, crop)).toBe(false);
  });
});

describe("drawing", () => {
  /** A canvas context that records what it was asked to do. */
  function recorder() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => calls.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a) : a)).join(",")})`)),
      set: (t, k: string, v) => {
        t[k] = v;
        calls.push(`${k}=${v}`);
        return true;
      },
    });
    return { ctx: ctx as unknown as Draw2D, calls };
  }

  it("draws a box as a red outline, a highlight as a see-through yellow fill, an arrow as a line and a head", () => {
    const { ctx, calls } = recorder();
    const shapes: Annotation[] = [
      { kind: "rect", x: 1, y: 2, w: 3, h: 4 },
      { kind: "highlight", x: 5, y: 6, w: 7, h: 8 },
      { kind: "arrow", x1: 0, y1: 0, x2: 100, y2: 0 },
    ];
    drawAnnotations(ctx, shapes, 5);
    expect(calls).toContain("strokeRect(1,2,3,4)");
    expect(calls).toContain("lineWidth=5");
    expect(calls).toContain("strokeStyle=#E11D48");
    expect(calls).toContain("globalCompositeOperation=multiply");
    expect(calls.some((c) => c.startsWith("fillStyle=rgba(255, 215, 0"))).toBe(true);
    expect(calls).toContain("fillRect(5,6,7,8)");
    expect(calls).toContain("moveTo(0,0)");
    expect(calls).toContain("lineTo(100,0)");
    // Arrowhead: 4 × line width long, filled.
    const head = arrowHead(0, 0, 100, 0, 20);
    expect(calls).toContain(`lineTo(${Math.round(head[0].x)},${Math.round(head[0].y)})`);
    expect(calls.filter((c) => c === "fill()").length).toBe(1);
    // Every shape is drawn in its own save/restore, so styles don't leak.
    expect(calls.filter((c) => c === "save()").length).toBe(3);
    expect(calls.filter((c) => c === "restore()").length).toBe(3);
  });

  it("draws nothing for no shapes", () => {
    const { ctx, calls } = recorder();
    drawAnnotations(ctx, [], 3);
    expect(calls).toEqual([]);
  });
});

describe("size limits", () => {
  it("fits a note-sized picture and its text, but not more than the notes' picture limit", () => {
    expect(screenshotFits("data:image/webp;base64," + "A".repeat(400_000), "Some text")).toBe(true);
    expect(screenshotFits("x".repeat(MAX_NOTE_IMAGE_HTML), "")).toBe(false);
    expect(screenshotFits("x".repeat(MAX_NOTE_IMAGE_HTML - 1000), "y".repeat(2000))).toBe(false);
  });

  it("sends only WebP or PNG data URLs under the server's cap for text", () => {
    expect(isOcrImage("data:image/webp;base64,AAAA")).toBe(true);
    expect(isOcrImage("data:image/png;base64,iVBO==")).toBe(true);
    expect(isOcrImage("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(isOcrImage("https://example.com/a.png")).toBe(false);
    expect(isOcrImage("data:image/webp;base64," + "A".repeat(MAX_OCR_DATA_URL))).toBe(false);
  });
});

describe("capture errors", () => {
  it("explains pages Chrome won't let extensions capture", () => {
    for (const u of ["chrome://settings", "chrome://newtab/", "about:blank", "view-source:https://a.com", "https://chromewebstore.google.com/detail/x", "https://chrome.google.com/webstore/category/extensions"]) {
      expect(blockedPage(u)).toBe(true);
      expect(captureErrorMessage(u)).toMatch(/Chrome doesn't let extensions/);
    }
    expect(blockedPage("https://example.com/")).toBe(false);
    expect(blockedPage("https://chrome.google.com/search")).toBe(false);
    expect(captureErrorMessage("file:///Users/a.html")).toMatch(/file access/);
    expect(captureErrorMessage("https://example.com/")).toMatch(/couldn't take a screenshot/);
  });
});

describe("the note", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });
  const src = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4";

  it("names it after the page", () => {
    expect(screenshotTitle("  Pricing —  Acme ")).toBe("Screenshot: Pricing — Acme");
    expect(screenshotTitle("", new Date(2026, 10, 24))).toMatch(/^Screenshot .*2026/);
  });

  it("holds the picture as a note image, then the text and the source, and the editor keeps it", () => {
    const html = screenshotNoteHtml({ src, title: "Screenshot: Pricing <b>", text: "Plan A $5\n\nPlan B $9", url: "https://acme.example/pricing" });
    expect(html.startsWith(`<figure data-type="note-image"><img src="${src}" alt="Screenshot of Pricing &lt;b&gt;"></figure>`)).toBe(true);
    expect(html).toContain("<p>Plan A $5</p><p>Plan B $9</p>");
    expect(html).toContain('<p>Source: <a href="https://acme.example/pricing">Pricing &lt;b&gt;</a></p>');
    editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, NoteImage.extend({ addNodeView: () => null }).configure({ allowBase64: true })], content: html });
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe("image");
    expect(first.attrs.src).toBe(src);
    expect(editor.getHTML()).toContain('<figure data-type="note-image"');
  });

  it("makes the pulled-out text searchable in Ask (the picture itself isn't)", () => {
    const now = new Date().toISOString();
    const note: Note = { id: "n1", title: "Screenshot: Invoice", content: screenshotNoteHtml({ src, title: "Screenshot: Invoice", text: "Total due 18 EUR by Friday" }), createdAt: now, updatedAt: now };
    const [hit] = pickSnippets("when is the total due", [note], []);
    expect(hit?.id).toBe("n1");
    expect(hit.text).toContain("Total due 18 EUR by Friday");
    expect(hit.text).not.toContain("base64");
  });
});

describe("saving", () => {
  it("saves a note with the picture, or a to-do linked to that note", async () => {
    vi.resetModules();
    const { saveScreenshot } = await import("../../src/lib/screenshot");
    const { storageGet } = await import("../../src/lib/storage");
    const src = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4";
    const a = await saveScreenshot("note", { image: src, title: "Screenshot: Docs", text: "Hello", url: "https://docs.example/" });
    expect(a.todo).toBeUndefined();
    expect(a.note.content).toContain(`<img src="${src}"`);
    expect(a.note.content).toContain("<p>Hello</p>");
    const b = await saveScreenshot("todo", { image: src, title: "Screenshot: Bug", url: "https://app.example/" });
    expect(b.todo?.title).toBe("Screenshot: Bug");
    expect(b.todo?.noteId).toBe(b.note.id);
    expect(b.todo?.subtasks?.map((s) => s.title)).toEqual(["https://app.example/"]);
    const notes = await storageGet<Note[]>("notes", []);
    const todos = await storageGet<Todo[]>("todos", []);
    expect(notes.map((n) => n.id)).toEqual([b.note.id, a.note.id]);
    expect(todos[0].noteId).toBe(b.note.id);
    await expect(saveScreenshot("note", { image: "x".repeat(MAX_NOTE_IMAGE_HTML), title: "Big" })).rejects.toThrow(/too big/);
  });

  it("uses the test stand-in for Pull out the text and refuses pictures it can't send", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_E2E", "1");
    const { extractText } = await import("../../src/lib/screenshot");
    (globalThis as { __prodliOcrStub?: unknown }).__prodliOcrStub = async (image: string) => ({ text: `  read ${image.slice(5, 15)}  ` });
    try {
      expect(await extractText("data:image/webp;base64,AAAA")).toBe("read image/webp");
      await expect(extractText("data:image/gif;base64,AAAA")).rejects.toThrow(/too big/);
    } finally {
      delete (globalThis as { __prodliOcrStub?: unknown }).__prodliOcrStub;
      vi.unstubAllEnvs();
    }
  });
});
