// Markdown notes: a folder of .md files zipped up (Obsidian vault, Bear's
// Markdown export, Logseq pages, …) or several files picked at once. Each file
// is a note named after the file; pictures next to them come along; [[wiki
// links]] and relative links to other notes become ProdLi note links.

import {
  baseName,
  dropTitleHeading,
  escapeHtml,
  imageMime,
  markdownNoteHtml,
  normalizePath,
  plural,
  stripExt,
  tagsLine,
  type ImportImage,
  type LinkResolver,
  type ParsedNotes,
} from "./core";

export interface ExportFile {
  /** Path inside the export ("Vault/Projects/Plan.md"). */
  path: string;
  bytes: Uint8Array;
}

export const isNoteFile = (path: string) => /\.(md|markdown|txt)$/i.test(path);
/** Files every OS and app adds that aren't notes. */
export const isJunk = (path: string) => /(^|\/)(__MACOSX|\.obsidian|\.trash|\.git)\//.test(path) || /(^|\/)\.[^/]*$/.test(path);

const decoder = new TextDecoder();
export const text = (f: ExportFile) => decoder.decode(f.bytes).replace(/^﻿/, "");

/** YAML front matter at the top of a note: the few fields worth keeping, and the rest of the text. */
export function frontMatter(md: string): { body: string; title?: string; tags: string[]; created?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\s*(\r?\n|$)/.exec(md);
  if (!m) return { body: md, tags: [] };
  const out: { body: string; title?: string; tags: string[]; created?: string } = { body: md.slice(m[0].length), tags: [] };
  const lines = m[1].split(/\r?\n/);
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (key === "title" && value) out.title = unquote(value);
    else if ((key === "created" || key === "date") && value) {
      const d = new Date(unquote(value));
      if (!isNaN(d.getTime())) out.created = d.toISOString();
    } else if (key === "tags" || key === "tag") {
      if (value.startsWith("[")) out.tags.push(...value.replace(/^\[|\]$/g, "").split(",").map(unquote));
      else if (value) out.tags.push(...value.split(/[,\s]+/).map(unquote));
      else while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) out.tags.push(unquote(lines[++i].replace(/^\s*-\s+/, "")));
    }
  }
  out.tags = out.tags.map((t) => t.replace(/^#/, "")).filter(Boolean);
  return out;
}

/** Looks notes and pictures up by path, and by name for [[wiki links]] (Obsidian links by name, not path). */
export function makeResolver(notePaths: string[], imagePaths: string[]): LinkResolver & { byName(name: string): string | undefined; imageByName(name: string): string | undefined } {
  const notes = new Set(notePaths);
  const images = new Set(imagePaths);
  const noteNames = new Map<string, string>();
  for (const p of notePaths) {
    const k = stripExt(baseName(p)).toLowerCase();
    if (!noteNames.has(k)) noteNames.set(k, p);
    const full = stripExt(p).toLowerCase();
    if (!noteNames.has(full)) noteNames.set(full, p);
  }
  const imageNames = new Map<string, string>();
  for (const p of imagePaths) {
    const k = baseName(p).toLowerCase();
    if (!imageNames.has(k)) imageNames.set(k, p);
  }
  const lowerNotes = new Map(notePaths.map((p) => [p.toLowerCase(), p]));
  return {
    note: (path) => (notes.has(path) ? path : lowerNotes.get(path.toLowerCase()) ?? (notes.has(`${path}.md`) ? `${path}.md` : undefined)),
    image: (path) => (images.has(path) ? path : imageNames.get(baseName(path).toLowerCase())),
    byName: (name) => {
      const n = normalizePath(name).toLowerCase().replace(/\.md$/, "");
      return noteNames.get(n) ?? noteNames.get(baseName(n));
    },
    imageByName: (name) => imageNames.get(baseName(normalizePath(name)).toLowerCase()),
  };
}

/** Obsidian's ![[picture.png]] and [[Note|text]] → HTML the Markdown reader passes on. */
export function wikiLinks(md: string, resolve: ReturnType<typeof makeResolver>): string {
  // Leave code alone.
  return md.replace(/(```[\s\S]*?```|`[^`\n]*`)|(!?)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g, (all, code, bang, target, _heading, alias) => {
    if (code) return code;
    const name = String(target ?? "").trim();
    if (bang) {
      const img = resolve.imageByName(name);
      return img ? `<img data-import-src="${escapeHtml(img)}" alt="${escapeHtml(stripExt(baseName(name)))}">` : "";
    }
    const label = escapeHtml(String(alias ?? "").trim() || name);
    const key = name ? resolve.byName(name) : undefined;
    return key ? `<a data-import-note="${escapeHtml(key)}">${label}</a>` : label;
  });
}

export function parseMarkdownFiles(files: ExportFile[]): ParsedNotes {
  const usable = files.filter((f) => !isJunk(f.path));
  const noteFiles = usable.filter((f) => isNoteFile(f.path));
  const imageFiles = usable.filter((f) => imageMime(f.path));
  const others = usable.length - noteFiles.length - imageFiles.length;
  const resolve = makeResolver(
    noteFiles.map((f) => f.path),
    imageFiles.map((f) => f.path),
  );
  const images = new Map<string, ImportImage>(imageFiles.map((f) => [f.path, { name: baseName(f.path), mime: imageMime(f.path)!, bytes: f.bytes }]));
  const notes = noteFiles.map((f) => {
    const fm = frontMatter(text(f));
    const title = fm.title || stripExt(baseName(f.path)) || "Untitled";
    const body = /\.txt$/i.test(f.path) ? fm.body.split(/\r?\n\r?\n/).map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`).join("") : null;
    const html = body ?? markdownNoteHtml(wikiLinks(dropTitleHeading(fm.body, title), resolve), f.path, resolve);
    return { key: f.path, sourceId: f.path, title, html: html + tagsLine(fm.tags), ...(fm.created ? { createdAt: fm.created } : {}) };
  });
  const dropped: string[] = [];
  if (others > 0) dropped.push(`${plural(others, "other file")} (PDFs and other attachments)`);
  const folders = new Set(noteFiles.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean));
  if (folders.size > 1) dropped.push("folders (ProdLi notes have no folders; links between notes are kept)");
  return { app: "markdown", notes, images, dropped, info: [] };
}
