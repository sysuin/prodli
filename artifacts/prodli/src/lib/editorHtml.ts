// Turns sanitized HTML (from Markdown, files, meeting notes) into the shape the
// Editor's extensions understand, so checklists and tables survive.

import { markdownToSafeHtml } from "./filePreview";

/**
 * Markdown task lists render as `<li><input type="checkbox"> text</li>`.
 * The Editor's checklist expects `<ul data-type="taskList"><li data-type="taskItem" data-checked="…">`.
 */
export function toEditorHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("ul").forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === "LI");
    const isTaskList = items.length > 0 && items.every((li) => li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]"));
    if (!isTaskList) return;
    ul.setAttribute("data-type", "taskList");
    for (const li of items) {
      const box = li.querySelector<HTMLInputElement>(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", box?.hasAttribute("checked") ? "true" : "false");
      box?.remove();
    }
  });
  // Fenced code ends with a newline (```lang\ncode\n```); in the Editor that
  // would show as an empty last line. The language stays on <code class="language-…">.
  doc.querySelectorAll("pre > code").forEach((code) => {
    const last = code.lastChild;
    if (last?.nodeType === 3 && last.textContent?.endsWith("\n")) last.textContent = last.textContent.slice(0, -1);
  });
  return doc.body.innerHTML;
}

/** Markdown → safe HTML ready for a note. */
export function markdownToNoteHtml(markdown: string): string {
  return toEditorHtml(markdownToSafeHtml(markdown));
}

export { looksLikeMarkdown } from "./markdownDetect";

/** CSV/TSV rows → an HTML table the Editor can edit. */
export function rowsToTableHtml(rows: string[][], header = true): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cell = (tag: "th" | "td", v: string) => `<${tag}><p>${esc(v)}</p></${tag}>`;
  const line = (r: string[], tag: "th" | "td") => `<tr>${Array.from({ length: cols }, (_, i) => cell(tag, r[i] ?? "")).join("")}</tr>`;
  const [first, ...rest] = rows;
  const body = header && first ? [line(first, "th"), ...rest.map((r) => line(r, "td"))] : rows.map((r) => line(r, "td"));
  return `<table><tbody>${body.join("")}</tbody></table>`;
}
