// Google Keep: takeout.google.com → only Keep → export. The .zip has one JSON
// file per note under Takeout/Keep/ (plus an HTML copy, ignored) and the
// note's pictures beside it. Lists become checklists, labels a "Tags:" line,
// pinned stays pinned; notes in the bin are left out.

import { baseName, dirOf, escapeHtml, imageMime, plural, stripExt, tagsLine, type ImportImage, type ImportNote, type ParsedNotes } from "./core";
import { sanitizeHtml } from "../filePreview";
import { toEditorHtml } from "../editorHtml";
import { isJunk, text, type ExportFile } from "./markdownFiles";

interface KeepJson {
  title?: string;
  textContent?: string;
  textContentHtml?: string;
  listContent?: { text?: string; textHtml?: string; isChecked?: boolean }[];
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  labels?: { name?: string }[];
  attachments?: { filePath?: string; mimetype?: string }[];
  annotations?: { url?: string; title?: string }[];
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
  color?: string;
}

const parse = (s: string): KeepJson | null => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) && ("textContent" in v || "listContent" in v) && "isTrashed" in v ? (v as KeepJson) : null;
  } catch {
    return null;
  }
};

export const isKeepExport = (files: ExportFile[]) => files.some((f) => /\.json$/i.test(f.path) && /(^|\/)Keep\//.test(f.path)) || files.some((f) => /\.json$/i.test(f.path) && f.bytes.length < 2_000_000 && parse(text(f)) !== null);

const usecToIso = (u?: number) => (typeof u === "number" && u > 0 ? new Date(Math.floor(u / 1000)).toISOString() : undefined);
const paragraphs = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

export function parseKeepFiles(files: ExportFile[]): ParsedNotes {
  const usable = files.filter((f) => !isJunk(f.path));
  const byPath = new Map(usable.map((f) => [f.path.toLowerCase(), f]));
  const images = new Map<string, ImportImage>();
  const notes: ImportNote[] = [];
  let trashed = 0;
  let audio = 0;
  let coloured = 0;
  let labelled = 0;
  for (const f of usable.filter((x) => /\.json$/i.test(x.path))) {
    const k = parse(text(f));
    if (!k) continue;
    if (k.isTrashed) {
      trashed++;
      continue;
    }
    let body = "";
    if (k.listContent?.length) {
      body += `<ul data-type="taskList">${k.listContent.map((i) => `<li data-type="taskItem" data-checked="${i.isChecked ? "true" : "false"}"><p>${escapeHtml(i.text ?? "")}</p></li>`).join("")}</ul>`;
    }
    if (k.textContentHtml) body += sanitizeHtml(k.textContentHtml);
    else if (k.textContent) body += paragraphs(k.textContent);
    for (const a of k.attachments ?? []) {
      const name = a.filePath ?? "";
      if (!/^image\//.test(a.mimetype ?? "") && !imageMime(name)) {
        audio++;
        continue;
      }
      // Keep's JSON sometimes says .jpeg for a file saved as .jpg (and the other way round).
      const want = (dirOf(f.path) + name).toLowerCase();
      const file = byPath.get(want) ?? byPath.get(want.replace(/\.jpeg$/, ".jpg")) ?? byPath.get(want.replace(/\.jpg$/, ".jpeg"));
      if (!file) continue;
      images.set(file.path, { name: baseName(file.path), mime: imageMime(file.path) ?? a.mimetype ?? "image/jpeg", bytes: file.bytes });
      body += `<img data-import-src="${escapeHtml(file.path)}" alt="${escapeHtml(stripExt(baseName(file.path)))}">`;
    }
    const links = (k.annotations ?? []).filter((a) => a.url && /^https?:\/\//i.test(a.url));
    if (links.length) body += `<ul>${links.map((a) => `<li><p><a href="${escapeHtml(a.url!)}">${escapeHtml(a.title || a.url!)}</a></p></li>`).join("")}</ul>`;
    const labels = (k.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
    if (labels.length) labelled++;
    if (k.color && k.color !== "DEFAULT") coloured++;
    const title = (k.title ?? "").trim();
    const firstLine = (k.textContent ?? k.listContent?.[0]?.text ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
    const created = usecToIso(k.createdTimestampUsec);
    notes.push({
      key: f.path,
      sourceId: k.createdTimestampUsec ? `c:${k.createdTimestampUsec}` : stripExt(baseName(f.path)),
      title: title || firstLine.slice(0, 80) || "Untitled",
      autoTitle: !title,
      html: toEditorHtml(sanitizeHtml(body)) + tagsLine(labels),
      ...(created ? { createdAt: created } : {}),
      ...(usecToIso(k.userEditedTimestampUsec) ? { updatedAt: usecToIso(k.userEditedTimestampUsec) } : {}),
      ...(k.isPinned ? { pinned: true } : {}),
      ...(k.isArchived ? { archived: true } : {}),
    });
  }
  const dropped: string[] = [];
  if (audio) dropped.push(`${plural(audio, "voice recording")} and drawings`);
  if (coloured) dropped.push("note colours");
  dropped.push("reminders and collaborators");
  const info: string[] = [];
  if (trashed) info.push(`${plural(trashed, "note")} in Keep's bin ${trashed === 1 ? "is" : "are"} left out.`);
  if (labelled) info.push("Labels are kept as a “Tags:” line at the end of each note.");
  return { app: "keep", notes, images, dropped, info };
}
