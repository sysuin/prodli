// Evernote: select notes or a notebook → Export → "ENEX format (.enex)". One
// XML file holds the notes, each with its content (ENML, a kind of HTML), its
// tags and its pictures (base64; a note refers to each by the MD5 of its
// data). Checkboxes become checklists, code blocks stay code blocks.

import { escapeHtml, htmlNoteHtml, imageMime, plural, tagsLine, type ImportImage, type ImportNote, type ParsedNotes } from "./core";
import { hashString } from "../importers/core";
import { md5Hex } from "./md5";

export const isEnex = (text: string) => /<en-export[\s>]/.test(text.slice(0, 4000));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()],
    )
    .trim();

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1] : undefined;
};
const tags = (xml: string, name: string) => Array.from(xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g")), (m) => m[1]);

/** "20231101T120000Z" → ISO. */
export function enexDate(s?: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec((s ?? "").trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : undefined;
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE)$/;

/** ENML → plain HTML: checkboxes, pictures, code blocks and Evernote's line-per-div layout. */
export function enmlToHtml(enml: string, media: Map<string, { key?: string; name: string }>): { html: string; attachments: number } {
  let attachments = 0;
  const doc = new DOMParser().parseFromString(`<body>${enml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, "").replace(/<(\/?)en-note[^>]*>/g, "<$1div>")
    // <en-todo/> and <en-media/> aren't void elements in HTML: close them, or they'd swallow the text after them.
    .replace(/<(en-todo|en-media)\b([^>]*?)\s*\/>/g, "<$1$2></$1>")}</body>`, "text/html");
  // Pictures and attachments.
  doc.querySelectorAll("en-media").forEach((m) => {
    const hit = media.get((m.getAttribute("hash") ?? "").toLowerCase());
    if (hit?.key) {
      const img = doc.createElement("img");
      img.setAttribute("data-import-src", hit.key);
      img.setAttribute("alt", hit.name);
      m.replaceWith(img);
    } else {
      attachments++;
      m.replaceWith(doc.createTextNode(`📎 ${hit?.name ?? "attachment"}`));
    }
  });
  doc.querySelectorAll("en-crypt").forEach((c) => c.replaceWith(doc.createTextNode("🔒 (encrypted text)")));
  // Code blocks: <div style="-en-codeblock:true">…lines…</div>.
  doc.querySelectorAll('div[style*="-en-codeblock"]').forEach((d) => {
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    const lines = Array.from(d.children).length ? Array.from(d.children).map((c) => c.textContent ?? "") : [d.textContent ?? ""];
    code.textContent = lines.join("\n");
    pre.appendChild(code);
    d.replaceWith(pre);
  });
  // Checklists from Evernote 10: <ul style="--en-todo:true"><li style="--en-checked:true">.
  doc.querySelectorAll('ul[style*="--en-todo"]').forEach((ul) => {
    ul.setAttribute("data-type", "taskList");
    ul.removeAttribute("style");
    ul.querySelectorAll(":scope > li").forEach((li) => {
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", /--en-checked:\s*true/.test(li.getAttribute("style") ?? "") ? "true" : "false");
      li.removeAttribute("style");
      const p = doc.createElement("p");
      p.innerHTML = Array.from(li.childNodes).filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName))).map((n) => (n.nodeType === 1 ? (n as Element).innerHTML : n.textContent ?? "")).join(" ").trim();
      const nested = Array.from(li.children).filter((c) => /^(UL|OL)$/.test(c.tagName));
      li.replaceChildren(p, ...nested);
    });
  });
  // Checkboxes: each line holding an <en-todo> becomes a checklist item; neighbours share a list.
  const todoBlocks: Element[] = [];
  doc.querySelectorAll("en-todo").forEach((t) => {
    let block: Element | null = t.parentElement;
    while (block && !BLOCK.test(block.tagName)) block = block.parentElement;
    if (block && block !== doc.body && !todoBlocks.includes(block)) todoBlocks.push(block);
  });
  const ours = new Set<Element>();
  for (const block of todoBlocks) {
    const checked = block.querySelector("en-todo")?.getAttribute("checked") === "true";
    block.querySelectorAll("en-todo").forEach((t) => t.remove());
    const li = doc.createElement("li");
    li.setAttribute("data-type", "taskItem");
    li.setAttribute("data-checked", checked ? "true" : "false");
    const p = doc.createElement("p");
    p.innerHTML = block.innerHTML.trim();
    li.appendChild(p);
    const prev = block.previousElementSibling;
    let ul = prev && ours.has(prev) ? prev : null;
    if (!ul) {
      ul = doc.createElement("ul");
      ul.setAttribute("data-type", "taskList");
      ours.add(ul);
      block.before(ul);
    }
    ul.appendChild(li);
    block.remove();
  }
  // Evernote writes one <div> per line: lines become paragraphs, nested layout divs are unwrapped.
  const unwrap = (el: Element) => el.replaceWith(...Array.from(el.childNodes));
  for (const div of Array.from(doc.body.querySelectorAll("div")).reverse()) {
    if (div.getAttribute("data-type")) continue;
    const hasBlocks = Array.from(div.children).some((c) => /^(DIV|P|UL|OL|TABLE|PRE|BLOCKQUOTE|H[1-6]|HR)$/.test(c.tagName) || c.getAttribute("data-type"));
    if (hasBlocks) unwrap(div);
    else {
      const p = doc.createElement("p");
      p.innerHTML = div.innerHTML === "<br>" ? "" : div.innerHTML;
      div.replaceWith(p);
    }
  }
  return { html: doc.body.innerHTML, attachments };
}

export function parseEnex(files: { name: string; text: string }[]): ParsedNotes {
  const images = new Map<string, ImportImage>();
  const notes: ImportNote[] = [];
  let attachments = 0;
  let tagged = 0;
  for (const file of files) {
    for (const m of file.text.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      const xml = m[1];
      const title = xmlText(tag(xml, "title") ?? "") || "Untitled";
      const created = enexDate(tag(xml, "created"));
      const updated = enexDate(tag(xml, "updated"));
      const media = new Map<string, { key?: string; name: string }>();
      for (const r of tags(xml, "resource")) {
        const data = tag(r, "data");
        const mime = xmlText(tag(r, "mime") ?? "");
        const name = xmlText(tag(r, "file-name") ?? "") || "attachment";
        if (!data) continue;
        let bytes: Uint8Array;
        try {
          bytes = base64Bytes(xmlText(data));
        } catch {
          continue;
        }
        const hash = md5Hex(bytes);
        const isImage = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(mime) || (!mime && imageMime(name));
        if (isImage) images.set(hash, { name, mime: mime || imageMime(name)!, bytes });
        media.set(hash, { key: isImage ? hash : undefined, name });
      }
      const content = xmlText(tag(xml, "content") ?? "");
      const conv = enmlToHtml(content, media);
      attachments += conv.attachments;
      const noteTags = tags(xml, "tag").map(xmlText).filter(Boolean);
      if (noteTags.length) tagged++;
      const sourceUrl = xmlText(tag(tag(xml, "note-attributes") ?? "", "source-url") ?? "");
      const source = /^https?:\/\//i.test(sourceUrl) ? `<p>Source: <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>` : "";
      notes.push({
        key: `${file.name}#${notes.length}`,
        sourceId: `h:${hashString(`${title}\u0000${created ?? ""}`)}`,
        title,
        html: htmlNoteHtml(conv.html + source, "", { note: () => undefined, image: () => undefined }) + tagsLine(noteTags),
        ...(created ? { createdAt: created } : {}),
        ...(updated ? { updatedAt: updated } : {}),
      });
    }
  }
  const dropped: string[] = [];
  if (attachments) dropped.push(`${plural(attachments, "attachment")} other than pictures (PDFs, audio; their names stay in the note)`);
  dropped.push("notebooks and reminders");
  const info = tagged ? ["Tags are kept as a “Tags:” line at the end of each note."] : [];
  return { app: "evernote", notes, images, dropped, info };
}
