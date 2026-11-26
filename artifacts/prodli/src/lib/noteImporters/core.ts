// Import notes from other apps: the shape every reader produces, the shared
// HTML clean-up, and turning an import into ProdLi notes. Storage and Undo are
// in ./apply.ts; the readers are ./notion.ts, ./evernote.ts, ./keep.ts and
// ./markdownFiles.ts.
//
// A reader's HTML is sanitized (DOMPurify) and may hold two markers that are
// resolved here once every note has its ProdLi id:
//   <img data-import-src="KEY">  a picture from the export (ParsedNotes.images)
//   <a data-import-note="KEY">   a link to another note in the export
// Re-importing skips notes already imported (`Note.importedFrom`), and links
// to them point at the copy that's already here.

import { generateId } from "../utils";
import { markdownToSafeHtml, sanitizeHtml } from "../filePreview";
import { toEditorHtml } from "../editorHtml";
import { fitsInNote } from "../noteImages";
import { MAX_NOTE_BYTES } from "../markdownDetect";
import type { Note } from "../../types";

export { IMPORT_NOTES_EVENT } from "./events";

export type NoteApp = "notion" | "evernote" | "keep" | "markdown";

export const NOTE_APP_NAMES: Record<NoteApp, string> = {
  notion: "Notion",
  evernote: "Evernote",
  keep: "Google Keep",
  markdown: "Markdown files",
};

export interface ImportNote {
  /** Unique within the import; what `data-import-note` markers point at. */
  key: string;
  /** Stable across exports of the same notes, for skipping duplicates. */
  sourceId: string;
  title: string;
  /** Sanitized note HTML (may hold the markers above). */
  html: string;
  createdAt?: string;
  updatedAt?: string;
  pinned?: boolean;
  icon?: string;
  /** Archived in the other app (Keep). */
  archived?: boolean;
  /** The title should follow the first line (the other app had no title). */
  autoTitle?: boolean;
}

export interface ImportImage {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ParsedNotes {
  app: NoteApp;
  notes: ImportNote[];
  /** Pictures the notes use, by the key in their `data-import-src`. */
  images: Map<string, ImportImage>;
  /** What won't carry over, for the preview. */
  dropped: string[];
  /** Other things worth saying in the preview. */
  info: string[];
}

/** Most notes one import takes. */
export const MAX_IMPORT_NOTES = 3000;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
/** The picture type for a file name, or null when it isn't a picture a note can show. */
export const imageMime = (name: string): string | null => IMAGE_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "a/b/../c d.md" → "a/c d.md": a path inside the export, without "./" and "../". */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const stripExt = (name: string) => name.replace(/\.[^./]+$/, "");

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Where a relative link in the note at `from` points, or null for a web link. */
export function resolveRelative(from: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) return null;
  const path = safeDecode(href.split("#")[0].split("?")[0]);
  if (!path) return null;
  return normalizePath(path.startsWith("/") ? path : dirOf(from) + path);
}

/** Drops the first heading when it only repeats the title (Notion, Bear and Obsidian exports start that way). */
export function dropTitleHeading(markdown: string, title: string): string {
  const m = /^\s*#\s+(.+?)\s*#*\s*(\r?\n|$)/.exec(markdown);
  if (m && m[1].trim().toLowerCase() === title.trim().toLowerCase()) return markdown.slice(m[0].length);
  return markdown;
}

export interface LinkResolver {
  /** The note this file's relative link points at, as an import key. */
  note(path: string): string | undefined;
  /** The picture at this path, as an image key. */
  image(path: string): string | undefined;
}

/**
 * Relative links and pictures inside an export become markers; links to
 * files that weren't imported keep only their text; pictures on the web
 * become links (a note never loads anything from the web by itself).
 */
export function linkMarkers(html: string, from: string, resolve: LinkResolver): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("a[href]").forEach((a) => {
    const path = resolveRelative(from, a.getAttribute("href") ?? "");
    if (path === null) return;
    const key = resolve.note(path);
    if (key) {
      a.setAttribute("data-import-note", key);
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
    } else {
      const img = a.querySelector("img");
      if (img && a.childNodes.length === 1) a.replaceWith(img);
      else a.replaceWith(...Array.from(a.childNodes));
    }
  });
  doc.querySelectorAll("img").forEach((img) => {
    if (img.hasAttribute("data-import-src")) return;
    const src = img.getAttribute("src") ?? "";
    const path = resolveRelative(from, src);
    const key = path === null ? undefined : resolve.image(path);
    if (key) {
      img.setAttribute("data-import-src", key);
      img.removeAttribute("src");
    } else if (/^https?:/i.test(src)) {
      const a = doc.createElement("a");
      a.setAttribute("href", src);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.textContent = `🖼 ${img.getAttribute("alt") || "Picture"}`;
      img.replaceWith(a);
    } else if (!/^data:image\//i.test(src)) img.remove();
  });
  return doc.body.innerHTML;
}

/** Markdown → note HTML, with relative links and pictures resolved. */
export function markdownNoteHtml(markdown: string, from: string, resolve: LinkResolver): string {
  return toEditorHtml(linkMarkers(markdownToSafeHtml(markdown), from, resolve));
}

/** Another app's HTML → note HTML, with relative links and pictures resolved. */
export function htmlNoteHtml(html: string, from: string, resolve: LinkResolver): string {
  return toEditorHtml(linkMarkers(sanitizeHtml(html), from, resolve));
}

/** "Tags: a, b" at the end of a note, so the other app's tags and labels stay searchable. */
export const tagsLine = (tags: string[]) => (tags.length ? `<p>Tags: ${tags.map(escapeHtml).join(", ")}</p>` : "");

// ── Preview ──────────────────────────────────────────────────────────────────

const keyOf = (app: string, id: string) => `${app}\u0000${id}`;

/** Already-imported notes, by app + source id → the ProdLi note. */
function importedNotes(existing: Note[]): Map<string, Note> {
  const m = new Map<string, Note>();
  for (const n of existing) if (n.importedFrom) m.set(keyOf(n.importedFrom.app, n.importedFrom.id), n);
  return m;
}

export interface NotesSummary {
  total: number;
  toAdd: number;
  duplicates: number;
  archived: number;
  pictures: number;
  /** Notes too large to import (over 1 MB of text). */
  tooLarge: string[];
}

const textBytes = (html: string) => new TextEncoder().encode(html.replace(/<img [^>]*>/g, "")).length;

export function summarizeNotes(parsed: ParsedNotes, existing: Note[], includeArchived: boolean): NotesSummary {
  const have = importedNotes(existing);
  const s: NotesSummary = { total: parsed.notes.length, toAdd: 0, duplicates: 0, archived: 0, pictures: 0, tooLarge: [] };
  for (const n of parsed.notes) {
    if (n.archived) s.archived++;
    if (n.archived && !includeArchived) continue;
    if (have.has(keyOf(parsed.app, n.sourceId))) {
      s.duplicates++;
      continue;
    }
    if (textBytes(n.html) > MAX_NOTE_BYTES) {
      s.tooLarge.push(n.title);
      continue;
    }
    s.toAdd++;
    s.pictures += (n.html.match(/data-import-src=/g) ?? []).length;
  }
  return s;
}

// ── Building the notes ───────────────────────────────────────────────────────

/** Turns an export's picture into a data: URL for the note (in the app: shrunk to WebP, lib/noteImages.ts). */
export type ImageToDataUrl = (image: ImportImage) => Promise<string>;

export interface BuiltNotes {
  notes: Note[];
  skipped: number;
  tooLarge: number;
  /** Pictures left out: unreadable, or the note was already full. */
  picturesDropped: number;
}

export async function buildNotes(
  parsed: ParsedNotes,
  opts: { existing: Note[]; includeArchived: boolean; toDataUrl: ImageToDataUrl; now?: Date },
): Promise<BuiltNotes> {
  const now = (opts.now ?? new Date()).toISOString();
  const have = importedNotes(opts.existing);
  const target = new Map<string, { id: string; title: string }>();
  const fresh: { n: ImportNote; id: string }[] = [];
  let skipped = 0;
  let tooLarge = 0;
  for (const n of parsed.notes.slice(0, MAX_IMPORT_NOTES)) {
    if (n.archived && !opts.includeArchived) continue;
    const prev = have.get(keyOf(parsed.app, n.sourceId));
    if (prev) {
      target.set(n.key, { id: prev.id, title: prev.title });
      skipped++;
      continue;
    }
    if (textBytes(n.html) > MAX_NOTE_BYTES) {
      tooLarge++;
      continue;
    }
    const id = generateId();
    target.set(n.key, { id, title: n.title });
    fresh.push({ n, id });
  }

  const dataUrls = new Map<string, string | null>();
  let picturesDropped = 0;
  const notes: Note[] = [];
  for (const { n, id } of fresh) {
    let html = n.html;
    if (html.includes("data-import-") && typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      doc.querySelectorAll("a[data-import-note]").forEach((a) => {
        const t = target.get(a.getAttribute("data-import-note") ?? "");
        if (!t) return a.replaceWith(...Array.from(a.childNodes));
        const link = doc.createElement("a");
        link.setAttribute("data-type", "note-link");
        link.setAttribute("data-note-id", t.id);
        link.setAttribute("href", `#note-${t.id}`);
        link.textContent = t.title || "Untitled";
        a.replaceWith(link);
      });
      let size = doc.body.innerHTML.length;
      for (const img of Array.from(doc.querySelectorAll("img[data-import-src]"))) {
        const key = img.getAttribute("data-import-src")!;
        const image = parsed.images.get(key);
        let url = dataUrls.get(key);
        if (url === undefined && image) {
          url = await opts.toDataUrl(image).catch(() => null);
          dataUrls.set(key, url);
        }
        if (url && fitsInNote(size, url.length)) {
          img.setAttribute("src", url);
          img.removeAttribute("data-import-src");
          size += url.length;
        } else {
          picturesDropped++;
          img.remove();
        }
      }
      html = doc.body.innerHTML;
    }
    notes.push({
      id,
      title: n.title,
      content: html || "<p></p>",
      createdAt: n.createdAt ?? n.updatedAt ?? now,
      updatedAt: n.updatedAt ?? n.createdAt ?? now,
      ...(n.pinned ? { pinned: true } : {}),
      ...(n.icon ? { icon: n.icon } : {}),
      autoTitle: !!n.autoTitle,
      importedFrom: { app: parsed.app, id: n.sourceId },
    });
  }
  return { notes, skipped, tooLarge, picturesDropped };
}
