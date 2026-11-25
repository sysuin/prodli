// Notes are HTML written by the extension's editor (TipTap). The phone edits
// them with the same editor engine (TenTap = TipTap in a WebView), which knows
// most of what the extension writes. A note with anything it doesn't know
// (tables, code blocks, toggles, callouts…; see unsupportedFormatting) opens
// read-only, so editing on the phone can never drop content from the computer.

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

// What the phone's editor keeps: TenTap's start kit plus ProdLi's blocks
// (editor-web, artifacts/prodli sections/editor/phoneExtensions.ts): paragraphs,
// headings, bold/italic/underline/strike, inline code, links, lists and
// checklists, quotes, line breaks, text and background colours, highlights,
// tables, code blocks, dividers, toggles, callouts, pictures with captions and
// links to other notes. Anything else (pasted from elsewhere, or from a newer
// ProdLi) opens read-only, so editing on the phone can never drop it.
const EDITABLE_TAGS = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "blockquote", "ul", "ol", "li", "a", "mark", "span", "label", "input", "div", "img", "pre", "hr", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "details", "summary"]);
const KNOWN_TYPES = new Set(["taskList", "taskItem", "callout", "note-link", "detailsContent", "note-image"]);
/** Style properties the phone's editor keeps, by tag (tables and pictures write their widths). */
const KEPT_STYLE: Record<string, (prop: string) => boolean> = {
  span: (p) => p === "color" || p === "background-color",
  table: (p) => p === "width" || p === "min-width",
  col: (p) => p === "width" || p === "min-width",
  img: (p) => p === "width",
};

const attr = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};

/** What in this note the phone's editor would drop, in plain words (empty: it can be edited). */
export function unsupportedFormatting(html: string): string[] {
  const found = new Set<string>();
  for (const [, rawTag, attrs] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const tag = rawTag.toLowerCase();
    if (!EDITABLE_TAGS.has(tag)) found.add("formatting");
    const type = attr(attrs, "data-type");
    if (type !== null && !KNOWN_TYPES.has(type)) found.add("formatting");
    const style = attr(attrs, "style");
    if (style !== null && tag !== "mark") {
      const kept = KEPT_STYLE[tag] ?? (() => false);
      const decls = style.split(";").map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim().toLowerCase()] as const).filter(([p]) => p);
      // "background-color: transparent" (old Google Docs pastes) loses nothing when dropped.
      const real = decls.filter(([p, v]) => !(p.startsWith("background") && /^(transparent|none|initial|inherit|unset)$/.test(v)));
      if (real.some(([p]) => !kept(p))) found.add("formatting");
    }
  }
  return [...found];
}

/** Why the note can't be edited on the phone, or null if it can. */
export function readOnlyReason(html: string): string | null {
  return unsupportedFormatting(html).length ? "This note has formatting the phone app can't edit yet. You can read it here; edit it on your computer, so nothing is lost." : null;
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
