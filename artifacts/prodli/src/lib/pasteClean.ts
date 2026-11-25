// Pasting from Google Docs, Word, Notion and web pages. Their HTML puts the
// source's default text colour on every run (Google Docs color:#000000, Notion
// rgb(55, 53, 47), Word black), adds white or transparent backgrounds, writes
// Word lists as paragraphs with a typed bullet, and carries Office-only tags.
// Left in, pasted text turns black in dark mode (and the phone app opens the
// note read-only over the backgrounds), and Word lists come in as paragraphs.
// cleanPastedHtml runs on the clipboard HTML before the editor reads it
// (transformPastedHTML in EditorSection). Colours picked in ProdLi are saved
// as var(--note-…) and are never touched; real colours from other apps (red
// text, a yellow highlight) are kept.

type Rgb = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  windowtext: { r: 0, g: 0, b: 0, a: 1 },
  window: { r: 255, g: 255, b: 255, a: 1 },
};

/** #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and a few names; null when it can't tell. */
export function parseColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = "f"] = h.split("");
      return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: parseInt(a + a, 16) / 255 };
    }
    if (h.length === 6 || h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: alpha };
  }
  return null;
}

const luma = ({ r, g, b }: Rgb) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const neutral = ({ r, g, b }: Rgb) => Math.max(r, g, b) - Math.min(r, g, b) < 24;

/** A source app's default text colour (black, near-black, white): drop it so the note's own colour shows. */
export function isDefaultTextColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.includes("var(--note-")) return false;
  if (["inherit", "initial", "unset", "currentcolor", "auto"].includes(v)) return true;
  const c = parseColor(v);
  return !!c && (c.a === 0 || (neutral(c) && (luma(c) < 0.35 || luma(c) > 0.85)));
}

/** A background that's really "no background" (transparent, white, black): drop it. */
export function isDefaultBackground(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.includes("var(--note-")) return false;
  if (["none", "inherit", "initial", "unset", "transparent"].includes(v)) return true;
  const c = parseColor(v);
  return !!c && (c.a === 0 || (neutral(c) && (luma(c) > 0.9 || luma(c) < 0.1)));
}

/** The style attribute with only real colours and backgrounds left (fonts, sizes, spacing and defaults go); null when nothing is left. */
export function cleanStyle(style: string): string | null {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    if (prop === "color" && !isDefaultTextColor(value)) kept.push(`color: ${value}`);
    else if ((prop === "background-color" || prop === "background") && !isDefaultBackground(value) && parseColorOrVar(value)) kept.push(`background-color: ${value}`);
  }
  return kept.length ? kept.join("; ") : null;
}

/** A background value that's a single colour (not an image or gradient). */
const parseColorOrVar = (v: string) => v.includes("var(--note-") || !!parseColor(v) || /^[a-z]+$/i.test(v.trim());

/** Bold / italic / underline / strike written as span styles (Google Docs does this) → real tags. */
function styleFormatting(style: string): string[] {
  const get = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(style)?.[1].trim().toLowerCase() ?? "";
  const tags: string[] = [];
  const weight = get("font-weight");
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) tags.push("strong");
  if (get("font-style") === "italic" || get("font-style") === "oblique") tags.push("em");
  const deco = `${get("text-decoration")} ${get("text-decoration-line")}`;
  if (deco.includes("underline")) tags.push("u");
  if (deco.includes("line-through")) tags.push("s");
  return tags;
}

const WORD_ORDERED = /^\(?([0-9]{1,3}|[a-z]{1,2}|[ivxlc]{1,5})[.)]/i;

/** Word writes list items as <p style="mso-list:l0 level1 lfo1"> with a typed bullet in a mso-list:Ignore span. */
function fixWordLists(doc: Document): void {
  const items = [...doc.querySelectorAll("p")].filter((p) => /mso-list:\s*l\d+\s+level\d+/i.test(p.getAttribute("style") ?? ""));
  const done = new Set<Element>();
  for (const first of items) {
    if (done.has(first)) continue;
    // A run of list paragraphs that follow each other (only whitespace between).
    const run: Element[] = [];
    for (let el: Element | null = first; el && items.includes(el as HTMLParagraphElement); ) {
      run.push(el);
      let next: ChildNode | null = el.nextSibling;
      while (next && next.nodeType === 3 && !next.textContent?.trim()) next = next.nextSibling;
      el = next && next.nodeType === 1 ? (next as Element) : null;
    }
    run.forEach((el) => done.add(el));
    const root = doc.createElement("div");
    const stack: { level: number; list: HTMLElement }[] = [];
    for (const p of run) {
      const level = Number(/level(\d+)/i.exec(p.getAttribute("style") ?? "")?.[1] ?? 1);
      const marker = [...p.querySelectorAll("[style]")].find((s) => /mso-list:\s*ignore/i.test(s.getAttribute("style") ?? ""));
      const ordered = WORD_ORDERED.test((marker?.textContent ?? "").trim());
      marker?.remove();
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const list = doc.createElement(ordered ? "ol" : "ul");
        if (top) (top.list.lastElementChild ?? top.list).appendChild(list);
        else root.appendChild(list);
        top = { level, list };
        stack.push(top);
      }
      const li = doc.createElement("li");
      const para = doc.createElement("p");
      while (p.firstChild) para.appendChild(p.firstChild);
      li.appendChild(para);
      top.list.appendChild(li);
    }
    first.replaceWith(...[...root.childNodes]);
    run.slice(1).forEach((el) => el.remove());
  }
}

/** Google Docs checklists: <li role="checkbox" aria-checked="…"> → ProdLi checklist items. */
function fixCheckboxLists(doc: Document): void {
  for (const ul of doc.querySelectorAll("ul")) {
    const lis = [...ul.children].filter((c) => c.tagName === "LI");
    if (!lis.length || !lis.every((li) => li.getAttribute("role") === "checkbox")) continue;
    ul.setAttribute("data-type", "taskList");
    for (const li of lis) {
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", li.getAttribute("aria-checked") === "true" ? "true" : "false");
    }
  }
}

/** Clipboard HTML from other apps → HTML the note editor reads cleanly. */
export function cleanPastedHtml(html: string): string {
  if (!/style=|mso-|role="?checkbox|<o:p|<!--\[if/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Office-only tags and conditional comments (Word's bullet glyphs live in them too).
  for (const el of [...doc.querySelectorAll("style, meta, link, title, xml, script")]) el.remove();
  for (const el of [...doc.body.getElementsByTagName("*")]) {
    if (/^[a-z]+:/i.test(el.tagName)) el.replaceWith(...[...el.childNodes].filter((n) => n.textContent?.replace(/ /g, "").trim()));
  }
  const walker = doc.createTreeWalker(doc.body, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  // Google Docs wraps everything in <b style="font-weight:normal">: not bold.
  for (const el of [...doc.querySelectorAll("b")]) {
    if (/font-weight\s*:\s*(normal|400)/i.test(el.getAttribute("style") ?? "")) el.replaceWith(...[...el.childNodes]);
  }
  fixWordLists(doc);
  fixCheckboxLists(doc);
  for (const el of [...doc.body.querySelectorAll("[style]")]) {
    const raw = el.getAttribute("style") ?? "";
    if (el.tagName === "SPAN" || el.tagName === "FONT") {
      for (const tag of styleFormatting(raw)) {
        const wrap = doc.createElement(tag);
        while (el.firstChild) wrap.appendChild(el.firstChild);
        el.appendChild(wrap);
      }
    }
    const style = cleanStyle(raw);
    if (style) el.setAttribute("style", style);
    else el.removeAttribute("style");
  }
  return doc.body.innerHTML;
}
