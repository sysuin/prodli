// Helpers for the Files previewer: detect a file's type, read it safely, and
// turn it into something we can show or save as a note. Files are read in the
// browser only — nothing is uploaded.

import { Marked } from "marked";
import DOMPurify from "dompurify";
import { rowsToTableHtml, toEditorHtml } from "./editorHtml";

export type PreviewKind = "markdown" | "json" | "jsonl" | "csv" | "text";

export interface OpenedFile {
  name: string;
  size: number;
  kind: PreviewKind;
  /** File extension without the dot, lowercased ("" if none) */
  ext: string;
  text: string;
  lastModified: number;
}

export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024; // 10 MB
export { MAX_NOTE_BYTES } from "./markdownDetect";

const MARKDOWN_EXT = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const JSON_EXT = new Set(["json", "geojson", "webmanifest", "har", "ipynb", "map"]);
const JSONL_EXT = new Set(["jsonl", "ndjson"]);
const CSV_EXT = new Set(["csv", "tsv"]);

export const ACCEPT_ATTR =
  ".md,.markdown,.mdx,.json,.geojson,.jsonl,.ndjson,.csv,.tsv,.txt,.log,.yaml,.yml,.toml,.ini,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.sql,.sh,.env,text/*,application/json";

export class PreviewError extends Error {}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function kindFor(name: string): PreviewKind {
  const ext = extensionOf(name);
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (JSONL_EXT.has(ext)) return "jsonl";
  if (JSON_EXT.has(ext)) return "json";
  if (CSV_EXT.has(ext)) return "csv";
  return "text";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function readPreviewFile(file: File): Promise<OpenedFile> {
  if (file.size > MAX_PREVIEW_BYTES) {
    throw new PreviewError(`${file.name} is ${formatBytes(file.size)}. Files up to ${formatBytes(MAX_PREVIEW_BYTES)} can be previewed.`);
  }
  const text = await file.text();
  // A NUL character in the first few KB almost always means a binary file.
  if (text.slice(0, 8000).includes("\u0000")) {
    throw new PreviewError(`${file.name} looks like a binary file. ProdLi can preview text files such as .md, .json, .csv and .txt.`);
  }
  return {
    name: file.name,
    size: file.size,
    kind: kindFor(file.name),
    ext: extensionOf(file.name),
    text: text.replace(/^﻿/, ""), // strip byte-order mark
    lastModified: file.lastModified,
  };
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const marked = new Marked({ gfm: true, breaks: false });

let purifyConfigured = false;
function configurePurify(): void {
  if (purifyConfigured) return;
  purifyConfigured = true;
  // Open links in a new tab, without giving the page access to ProdLi.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    // Task-list checkboxes (- [x]) are display-only; drop any other inputs.
    if (node.tagName === "INPUT") {
      if (node.getAttribute("type") === "checkbox") node.setAttribute("disabled", "");
      else node.remove();
    }
  });
}

/**
 * Markdown → safe HTML. Markdown can contain raw HTML (including <script> and
 * event handlers), so the output is always sanitized before it's shown.
 */
export function markdownToSafeHtml(markdown: string): string {
  // DOMPurify returns its input unchanged where it can't run safely; never
  // show unsanitized HTML in that case — fall back to escaped text.
  if (!DOMPurify.isSupported) return `<pre>${escapeHtml(markdown)}</pre>`;
  configurePurify();
  const raw = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "button", "textarea", "select"] });
}

/** Another app's HTML (an import) → safe HTML, sanitized the same way. */
export function sanitizeHtml(html: string): string {
  if (!DOMPurify.isSupported) return `<p>${escapeHtml(html.replace(/<[^>]*>/g, " "))}</p>`;
  configurePurify();
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "button", "textarea", "select"] });
}

// ── JSON ──────────────────────────────────────────────────────────────────────

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; line: number | null; column: number | null };

function lineColFromPosition(text: string, pos: number): { line: number; column: number } {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const column = pos - before.lastIndexOf("\n");
  return { line, column };
}

export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lc = /line (\d+) column (\d+)/i.exec(message);
    if (lc) return { ok: false, error: message, line: Number(lc[1]), column: Number(lc[2]) };
    const pos = /position (\d+)/i.exec(message);
    // Newer Chrome versions don't say where the error is — find it ourselves.
    const at = pos ? Number(pos[1]) : findJsonErrorPosition(text);
    if (at !== null) {
      const { line, column } = lineColFromPosition(text, at);
      return { ok: false, error: message, line, column };
    }
    return { ok: false, error: message, line: null, column: null };
  }
}

/**
 * Minimal JSON scanner used only after JSON.parse has failed, to report where.
 * Returns the character index of the first problem, or null if none was found.
 */
export function findJsonErrorPosition(text: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === "\\") i += 2;
      else if (ch < " ") fail();
      else i++;
    }
    fail();
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      ws();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ":") fail();
        i++;
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === '"') string();
    else if (ch === "t") literal("true");
    else if (ch === "f") literal("false");
    else if (ch === "n") literal("null");
    else number();
  };
  try {
    value();
    ws();
    return i < text.length ? i : null;
  } catch (pos) {
    return typeof pos === "number" ? Math.min(pos, text.length) : null;
  }
}

/** JSON Lines: one JSON value per line. Returns an array, or the first bad line. */
export function parseJsonLines(text: string): JsonParseResult {
  const values: unknown[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      values.push(JSON.parse(line));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), line: i + 1, column: null };
    }
  }
  return { ok: true, value: values };
}

// ── CSV / TSV ─────────────────────────────────────────────────────────────────

export function detectDelimiter(text: string, ext: string): string {
  if (ext === "tsv") return "\t";
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180-style parser: handles quoted fields, escaped quotes ("") and newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Save to Notes ─────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** HTML for a new ProdLi note made from the file (the Editor reads HTML). */
export function fileToNoteHtml(file: OpenedFile): string {
  switch (file.kind) {
    case "markdown":
      return toEditorHtml(markdownToSafeHtml(file.text));
    case "csv": {
      const rows = parseDelimited(file.text, detectDelimiter(file.text, file.ext)).filter((r) => !(r.length === 1 && r[0] === ""));
      return rowsToTableHtml(rows);
    }
    case "json": {
      const parsed = parseJson(file.text);
      const body = parsed.ok ? JSON.stringify(parsed.value, null, 2) : file.text;
      return `<pre><code>${escapeHtml(body)}</code></pre>`;
    }
    case "text":
      if (file.ext === "txt" || file.ext === "") {
        return file.text
          .split(/\r?\n\s*\r?\n/)
          .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`)
          .join("");
      }
      return `<pre><code>${escapeHtml(file.text)}</code></pre>`;
    default:
      return `<pre><code>${escapeHtml(file.text)}</code></pre>`;
  }
}
