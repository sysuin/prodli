// Convert ProdLi notes (HTML from the Editor) to Markdown files.

import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";

let turndown: TurndownService | null = null;

function service(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    hr: "---",
  });
  turndown.use(tables);
  turndown.addRule("strikethrough", {
    filter: ["s", "del"],
    replacement: (content) => `~~${content}~~`,
  });
  turndown.addRule("underline", {
    // Markdown has no underline; keep the text.
    filter: ["u"],
    replacement: (content) => content,
  });
  turndown.addRule("highlight", {
    filter: ["mark"],
    replacement: (content) => `==${content}==`,
  });
  // Editor checklists: <li data-type="taskItem" data-checked="true">
  turndown.addRule("taskItem", {
    filter: (node) => node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
      const text = content.replace(/^\n+|\n+$/g, "").replace(/\n+/g, "\n  ");
      return `- [${checked ? "x" : " "}] ${text}\n`;
    },
  });
  turndown.addRule("taskList", {
    filter: (node) => node.nodeName === "UL" && (node as HTMLElement).getAttribute("data-type") === "taskList",
    replacement: (content) => `\n\n${content}\n\n`,
  });
  // Callouts: a quote that starts with the icon ("> 💡 Remember…").
  turndown.addRule("callout", {
    filter: (node) => node.nodeName === "DIV" && (node as HTMLElement).getAttribute("data-type") === "callout",
    replacement: (content, node) => {
      const emoji = (node as HTMLElement).getAttribute("data-emoji") || "💡";
      const lines = content.replace(/^\n+|\n+$/g, "").split("\n");
      lines[0] = `${emoji} ${lines[0]}`;
      return `\n\n${lines.map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;
    },
  });
  // Toggle lists: the heading in bold, then what's inside.
  turndown.addRule("toggleSummary", {
    filter: ["summary"],
    replacement: (content) => `\n\n**${content.trim()}**\n\n`,
  });
  turndown.addRule("toggle", {
    filter: (node) => node.nodeName === "DETAILS" || (node.nodeName === "DIV" && ["details", "detailsContent"].includes((node as HTMLElement).getAttribute("data-type") ?? "")),
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });
  // Links to other notes: just the note's name.
  turndown.addRule("noteLink", {
    filter: (node) => node.nodeName === "A" && (node as HTMLElement).getAttribute("data-type") === "note-link",
    replacement: (content) => content.replace(/^↗\s*/, ""),
  });
  return turndown;
}

export function htmlToMarkdown(html: string): string {
  // The Editor wraps table cells in <p>; unwrap them so tables convert cleanly.
  // Column-width <colgroup>s stop the converter from recognising the header row.
  const cleaned = (html || "")
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/g, "")
    .replace(/<(t[hd])([^>]*)>\s*<p>([\s\S]*?)<\/p>\s*<\/\1>/g, "<$1$2>$3</$1>");
  return service().turndown(cleaned).trim() + "\n";
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
