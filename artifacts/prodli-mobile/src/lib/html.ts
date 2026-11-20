// Notes are HTML written by the extension's editor (TipTap). The phone edits
// them with the same editor engine (TenTap = TipTap in a WebView), which knows
// everything the extension writes except tables. A note with a table (or
// anything else unknown) opens read-only, so editing on the phone can never
// drop content from the computer.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text of note HTML, one line per block. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<li[^>]*data-checked="true"[^>]*>/gi, "\n☑ ")
      .replace(/<li[^>]*data-checked="false"[^>]*>/gi, "\n☐ ")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h[1-6]|div|blockquote|pre|tr|li)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** A short preview for the notes list. */
export const preview = (html: string, max = 120): string => {
  const t = htmlToText(html).replace(/\n+/g, " · ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The note's title when it follows the first line (autoTitle), like the extension. */
export function deriveTitle(html: string): string {
  const first = htmlToText(html).split("\n").find((l) => l.replace(/^[☑☐•]\s*/, "").trim()) ?? "";
  const title = first.replace(/^[☑☐•]\s*/, "").trim();
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title || "Untitled";
}

/** Tags the phone's editor keeps intact. */
const EDITABLE_TAGS = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a", "hr", "mark", "span", "label", "input", "div", "img"]);

/** Why the note can't be edited on the phone, or null if it can. */
export function readOnlyReason(html: string): string | null {
  const tags = new Set([...html.matchAll(/<([a-z][a-z0-9]*)\b/gi)].map((m) => m[1].toLowerCase()));
  if (tags.has("table")) return "This note has a table. You can read it here; edit it on your computer, where tables are supported.";
  const unknown = [...tags].filter((t) => !EDITABLE_TAGS.has(t));
  return unknown.length ? "This note has formatting the phone app can't edit yet. You can read it here; edit it on your computer." : null;
}

/** Plain text (e.g. from Ask ProdLi) → note HTML. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = text.split("\n");
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li><p>${esc(l)}</p></li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[-•*]\s+/.test(l)) list.push(l.replace(/^[-•*]\s+/, ""));
    else {
      flush();
      if (l) out.push(`<p>${esc(l)}</p>`);
    }
  }
  flush();
  return out.join("") || "<p></p>";
}
