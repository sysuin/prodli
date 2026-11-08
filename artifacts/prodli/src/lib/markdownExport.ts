// Convert ProdLi notes (HTML from the Editor) to Markdown files and back.

import TurndownService from "turndown";

let turndown: TurndownService | null = null;

function service(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  turndown.addRule("strikethrough", {
    filter: ["s", "del"],
    replacement: (content) => `~~${content}~~`,
  });
  turndown.addRule("underline", {
    // Markdown has no underline; keep the text.
    filter: ["u"],
    replacement: (content) => content,
  });
  return turndown;
}

export function htmlToMarkdown(html: string): string {
  return service().turndown(html || "").trim() + "\n";
}

/** Markdown for a note, adding the title as a heading if the note doesn't start with one. */
export function noteToMarkdown(title: string, html: string): string {
  const body = htmlToMarkdown(html);
  return /^#\s/.test(body) ? body : `# ${title}\n\n${body}`;
}

export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "note";
  return `${base}.${ext}`;
}

export function downloadText(fileName: string, text: string, mime = "text/markdown"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
