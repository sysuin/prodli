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

// What the phone's editor keeps. TenTap's start kit (the bridges in
// NoteEditor.native.tsx) has paragraphs, headings, bold/italic/underline/strike,
// inline code, links, lists and checklists, quotes, line breaks, images, text
// colour and highlights. It has no code blocks, dividers, tables, toggles,
// callouts, pictures (saved as <figure>), links to other notes or background colours:
// TipTap would quietly drop those on the first edit, so such notes open read-only.
const EDITABLE_TAGS = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "blockquote", "ul", "ol", "li", "a", "mark", "span", "label", "input", "div", "img"]);
const KNOWN_TYPES = new Set(["taskList", "taskItem"]);
const NAMED: Record<string, string> = { table: "a table", pre: "a code block", hr: "a divider", figure: "a picture", details: "a toggle", summary: "a toggle", callout: "a callout", "note-link": "a link to another note", detailsContent: "a toggle", "note-image": "a picture" };

const attr = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};

/** What in this note the phone's editor would drop, in plain words (empty: it can be edited). */
export function unsupportedFormatting(html: string): string[] {
  const found = new Set<string>();
  for (const [, rawTag, attrs] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const tag = rawTag.toLowerCase();
    if (NAMED[tag]) found.add(NAMED[tag]);
    else if (!EDITABLE_TAGS.has(tag)) found.add("other formatting");
    const type = attr(attrs, "data-type");
    if (type !== null && !KNOWN_TYPES.has(type)) found.add(NAMED[type] ?? "other formatting");
    const style = attr(attrs, "style");
    if (style !== null && tag !== "mark") {
      const decls = style.split(";").map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim().toLowerCase()]).filter(([k]) => k);
      // "background-color: transparent" (old Google Docs pastes) is no background: losing it changes nothing.
      const real = decls.filter(([k, v]) => !(k.startsWith("background") && /^(transparent|none|initial|inherit|unset|rgba\(0,\s*0,\s*0,\s*0\))$/.test(v)));
      if (real.some(([k]) => k.startsWith("background"))) found.add("a background colour");
      if (tag !== "span" ? real.length > 0 : real.some(([k]) => k !== "color" && !k.startsWith("background"))) found.add("other formatting");
    }
  }
  return [...found];
}

/** Why the note can't be edited on the phone, or null if it can. */
export function readOnlyReason(html: string): string | null {
  const found = unsupportedFormatting(html);
  if (!found.length) return null;
  const named = found.filter((f) => f !== "other formatting");
  const what = named.length ? (named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`) : "formatting";
  return `This note has ${what} the phone app can't edit yet. You can read it here; edit it on your computer, so nothing is lost.`;
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
