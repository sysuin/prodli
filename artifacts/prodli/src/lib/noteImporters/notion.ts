// Notion: Settings → Export → "Markdown & CSV" (or "HTML"), "Include
// subpages". The .zip (sometimes .zip files inside a .zip) holds one file per
// page, named "Title <32-hex id>.md", with subpages in a folder of the same
// name, pictures beside them, and each database as a CSV. Pages become notes,
// links between pages become note links, databases become a note with a
// table whose names link to their pages.

import { parseCsv } from "../importers/csv";
import {
  baseName,
  dirOf,
  dropTitleHeading,
  escapeHtml,
  htmlNoteHtml,
  imageMime,
  markdownNoteHtml,
  plural,
  stripExt,
  type ImportImage,
  type ImportNote,
  type ParsedNotes,
} from "./core";
import { isJunk, makeResolver, text, type ExportFile } from "./markdownFiles";

const ID = /[ _-]?([0-9a-f]{32})$/i;

/** "Plan 1a2b…32.md" → { title: "Plan", id: "1a2b…" }. */
export function notionName(path: string): { title: string; id?: string } {
  const stem = stripExt(baseName(path)).replace(/_all$/, "");
  const m = ID.exec(stem);
  return m ? { title: stem.slice(0, m.index).trim() || "Untitled", id: m[1].toLowerCase() } : { title: stem.trim() || "Untitled" };
}

/** Does this look like a Notion export? (Its file names end in 32-character page ids.) */
export const isNotionExport = (paths: string[]) => paths.some((p) => /\.(md|html|csv)$/i.test(p) && ID.test(stripExt(baseName(p)).replace(/_all$/, "")));

/** Notion's callouts in a Markdown export: <aside>💡 text</aside>. */
function asideToCallout(html: string): string {
  if (!html.includes("<aside") || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("aside").forEach((aside) => {
    const div = doc.createElement("div");
    div.setAttribute("data-type", "callout");
    div.setAttribute("data-color", "gray");
    let emoji = "💡";
    const first = aside.firstChild?.nodeType === 3 ? aside.firstChild : aside.querySelector("p")?.firstChild;
    const m = first?.nodeType === 3 ? /^\s*(\p{Extended_Pictographic}️?)\s*/u.exec(first.textContent ?? "") : null;
    if (m && first) {
      emoji = m[1];
      first.textContent = (first.textContent ?? "").slice(m[0].length);
    }
    div.setAttribute("data-emoji", emoji);
    // A callout holds paragraphs; loose text goes in one.
    let p: HTMLElement | null = null;
    for (const node of Array.from(aside.childNodes)) {
      const block = node.nodeType === 1 && /^(P|UL|OL|H[1-6]|PRE|BLOCKQUOTE)$/.test((node as Element).tagName);
      if (block) {
        p = null;
        div.appendChild(node);
      } else if (node.nodeType !== 3 || node.textContent?.trim()) {
        if (!p) div.appendChild((p = doc.createElement("p")));
        p.appendChild(node);
      }
    }
    if (!div.childNodes.length) div.appendChild(doc.createElement("p"));
    aside.replaceWith(div);
  });
  return doc.body.innerHTML;
}

/** Notion's HTML export: the page body, with its to-dos, toggles and callouts in the shapes the editor knows. */
export function notionHtmlPage(html: string): { title?: string; icon?: string; body: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector(".page-title")?.textContent?.trim() || undefined;
  const icon = doc.querySelector(".page-header-icon .icon")?.textContent?.trim() || undefined;
  const body = doc.querySelector(".page-body") ?? doc.body;
  body.querySelectorAll("ul.to-do-list").forEach((ul) => {
    ul.setAttribute("data-type", "taskList");
    ul.querySelectorAll(":scope > li").forEach((li) => {
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", li.querySelector(".checkbox-on") ? "true" : "false");
      li.querySelectorAll(".checkbox").forEach((c) => c.remove());
      const p = doc.createElement("p");
      p.textContent = li.textContent?.trim() ?? "";
      li.replaceChildren(p);
    });
  });
  body.querySelectorAll("ul.toggle > li > details").forEach((d) => {
    const summary = d.querySelector(":scope > summary");
    const content = doc.createElement("div");
    content.setAttribute("data-type", "detailsContent");
    for (const n of Array.from(d.childNodes)) if (n !== summary) content.appendChild(n);
    if (!content.childNodes.length) content.appendChild(doc.createElement("p"));
    d.setAttribute("class", "note-toggle");
    d.appendChild(content);
    d.closest("ul.toggle")!.replaceWith(d);
  });
  body.querySelectorAll("figure.callout").forEach((f) => {
    const div = doc.createElement("div");
    div.setAttribute("data-type", "callout");
    div.setAttribute("data-color", "gray");
    div.setAttribute("data-emoji", f.querySelector(".icon")?.textContent?.trim() || "💡");
    const content = f.querySelector(":scope > div:last-child") ?? f;
    const p = doc.createElement("p");
    p.textContent = content.textContent?.trim() ?? "";
    div.appendChild(p);
    f.replaceWith(div);
  });
  // Database properties at the top of a row's page.
  body.querySelectorAll("table.properties").forEach((t) => t.removeAttribute("class"));
  return { title, icon, body: body.innerHTML };
}

export function parseNotionFiles(files: ExportFile[]): ParsedNotes {
  const usable = files.filter((f) => !isJunk(f.path));
  const pages = usable.filter((f) => /\.(md|html?)$/i.test(f.path));
  const imageFiles = usable.filter((f) => imageMime(f.path));
  // Each database comes as "Name id.csv" and "Name id_all.csv" (every row, not only the default view's): keep one.
  const csvAll = new Set(usable.filter((f) => /_all\.csv$/i.test(f.path)).map((f) => f.path.replace(/_all\.csv$/i, ".csv")));
  const databases = usable.filter((f) => /\.csv$/i.test(f.path) && !csvAll.has(f.path));
  const others = usable.length - pages.length - imageFiles.length - usable.filter((f) => /\.csv$/i.test(f.path)).length;

  const resolve = makeResolver(
    [...pages, ...databases].map((f) => f.path),
    imageFiles.map((f) => f.path),
  );
  // A link to a database points at "Name id.csv" even when "Name id_all.csv" is what's kept.
  const noteKey = (path: string) => resolve.note(path) ?? (csvAll.has(path) ? resolve.note(path.replace(/\.csv$/i, "_all.csv")) : undefined);
  const resolver = { note: noteKey, image: resolve.image };
  const images = new Map<string, ImportImage>(imageFiles.map((f) => [f.path, { name: baseName(f.path), mime: imageMime(f.path)!, bytes: f.bytes }]));

  const notes: ImportNote[] = [];
  const titles = new Map<string, string>();
  for (const f of pages) {
    const { title: fileTitle, id } = notionName(f.path);
    let title = fileTitle;
    let icon: string | undefined;
    let html: string;
    if (/\.html?$/i.test(f.path)) {
      const page = notionHtmlPage(text(f));
      title = page.title || fileTitle;
      icon = page.icon && page.icon.length <= 8 ? page.icon : undefined;
      html = htmlNoteHtml(page.body, f.path, resolver);
    } else {
      html = asideToCallout(markdownNoteHtml(dropTitleHeading(text(f), title), f.path, resolver));
    }
    titles.set(f.path, title);
    notes.push({ key: f.path, sourceId: id ?? f.path, title, html, ...(icon ? { icon } : {}) });
  }

  for (const f of databases) {
    const { title, id } = notionName(f.path);
    const rows = parseCsv(text(f)).filter((r) => r.some((c) => c.trim()));
    if (!rows.length) continue;
    // A row's page is in the folder named like the database: link its name to it.
    const folder = `${stripExt(f.path).replace(/_all$/i, "")}/`;
    const rowPage = new Map<string, string>();
    for (const p of pages) if (dirOf(p.path) === folder) rowPage.set((titles.get(p.path) ?? "").toLowerCase(), p.path);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const cell = (tag: "th" | "td", v: string, link?: string) => `<${tag}><p>${link ? `<a data-import-note="${escapeHtml(link)}">${escapeHtml(v)}</a>` : escapeHtml(v)}</p></${tag}>`;
    const [head, ...body] = rows;
    const html =
      `<table><tbody><tr>${Array.from({ length: cols }, (_, i) => cell("th", head[i] ?? "")).join("")}</tr>` +
      body.map((r) => `<tr>${Array.from({ length: cols }, (_, i) => cell("td", r[i] ?? "", i === 0 ? rowPage.get((r[0] ?? "").trim().toLowerCase()) : undefined)).join("")}</tr>`).join("") +
      `</tbody></table>`;
    notes.push({ key: f.path, sourceId: id ? `db:${id}` : f.path, title, html });
  }

  const dropped: string[] = [];
  if (databases.length) dropped.push("database views, filters and property types (each database comes in as a table)");
  if (others > 0) dropped.push(`${plural(others, "other file")} (PDFs and other attachments)`);
  if (pages.some((p) => p.path.includes("/"))) dropped.push("page nesting (subpages become their own notes, linked from the page above)");
  return { app: "notion", notes, images, dropped, info: [] };
}
