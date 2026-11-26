import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// happy-dom breaks DOMPurify (it drops the first <p> and keeps <script>), so
// these tests check the readers with sanitizing switched off; the e2e suite
// (tests/e2e/noteImport.mjs) checks the real sanitizing in Chrome.
vi.mock("dompurify", () => ({ default: { isSupported: true, sanitize: (s: string) => s, addHook: () => {} } }));
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../src/sections/editor/extensions";
import { buildNotes, dropTitleHeading, normalizePath, resolveRelative, summarizeNotes, type ImageToDataUrl, type ParsedNotes } from "../../src/lib/noteImporters/core";
import { frontMatter, parseMarkdownFiles } from "../../src/lib/noteImporters/markdownFiles";
import { notionName, parseNotionFiles } from "../../src/lib/noteImporters/notion";
import { enexDate, parseEnex } from "../../src/lib/noteImporters/evernote";
import { parseKeepFiles } from "../../src/lib/noteImporters/keep";
import { md5Hex } from "../../src/lib/noteImporters/md5";
import { readNoteFiles } from "../../src/lib/noteImporters";
import { applyNotesImport, undoNotesImport } from "../../src/lib/noteImporters/apply";
import { zipFiles } from "../../src/lib/zip";
import { storageGet, storageSet } from "../../src/lib/storage";
import type { Note } from "../../src/types";

const enc = new TextEncoder();
const f = (path: string, text: string) => ({ path, bytes: enc.encode(text) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const fakeDataUrl: ImageToDataUrl = async (img) => `data:image/webp;base64,${img.name.length}`;
const dom = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
const ID1 = "0123456789abcdef0123456789abcdef";
const ID2 = "fedcba9876543210fedcba9876543210";
const ID3 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("paths", () => {
  it("normalizes and resolves relative links", () => {
    expect(normalizePath("a/./b/../c d.md")).toBe("a/c d.md");
    expect(resolveRelative("Export/Plan.md", "Plan/Sub%20page.md")).toBe("Export/Plan/Sub page.md");
    expect(resolveRelative("A/B/x.md", "../y.md#part")).toBe("A/y.md");
    expect(resolveRelative("x.md", "https://example.com")).toBeNull();
    expect(resolveRelative("x.md", "#top")).toBeNull();
  });

  it("drops a first heading that repeats the title, and only that", () => {
    expect(dropTitleHeading("# Plan\n\nText", "Plan")).toBe("Text");
    expect(dropTitleHeading("# Other\n\nText", "Plan")).toBe("# Other\n\nText");
  });
});

describe("md5", () => {
  it("matches Node's", () => {
    for (const n of [0, 3, 55, 56, 64, 1000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 7) & 255);
      expect(md5Hex(b)).toBe(createHash("md5").update(b).digest("hex"));
    }
  });
});

describe("Markdown folders (Obsidian, Bear)", () => {
  it("reads front matter", () => {
    expect(frontMatter("---\ntitle: My plan\ntags: [work, ideas]\ncreated: 2026-01-02\n---\nBody")).toMatchObject({ body: "Body", title: "My plan", tags: ["work", "ideas"] });
    expect(frontMatter("---\ntags:\n  - a\n  - '#b'\n---\nX").tags).toEqual(["a", "b"]);
    expect(frontMatter("No front matter").body).toBe("No front matter");
  });

  it("makes a note per file, with wiki links, relative links and pictures", () => {
    const parsed = parseMarkdownFiles([
      f("Vault/Plan.md", "# Plan\n\nSee [[Ideas]] and [[Ideas|the list]], [[Missing]], [rel](Notes/Meeting.md) and [web](https://example.com).\n\n![[shot.png]]\n\n- [ ] open\n- [x] done\n\n`[[not a link]]`"),
      f("Vault/Ideas.md", "---\ntags: [x]\n---\nOne idea"),
      f("Vault/Notes/Meeting.md", "Met."),
      { path: "Vault/assets/shot.png", bytes: PNG },
      f("Vault/.obsidian/app.json", "{}"),
      f("__MACOSX/Vault/._Plan.md", "junk"),
      f("Vault/file.pdf", "%PDF"),
    ]);
    expect(parsed.notes.map((n) => n.title)).toEqual(["Plan", "Ideas", "Meeting"]);
    const plan = dom(parsed.notes[0].html);
    expect(plan.querySelector("h1")).toBeNull();
    const links = [...plan.querySelectorAll("a[data-import-note]")].map((a) => [a.getAttribute("data-import-note"), a.textContent]);
    expect(links).toEqual([
      ["Vault/Ideas.md", "Ideas"],
      ["Vault/Ideas.md", "the list"],
      ["Vault/Notes/Meeting.md", "rel"],
    ]);
    expect(plan.textContent).toContain("Missing");
    expect(plan.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(plan.querySelector("img")?.getAttribute("data-import-src")).toBe("Vault/assets/shot.png");
    expect(plan.querySelector('ul[data-type="taskList"] li[data-checked="true"]')?.textContent?.trim()).toBe("done");
    expect(plan.querySelector("code")?.textContent).toBe("[[not a link]]");
    expect(parsed.notes[1].html).toContain("<p>Tags: x</p>");
    expect(parsed.images.get("Vault/assets/shot.png")?.mime).toBe("image/png");
    expect(parsed.dropped.join(" ")).toContain("1 other file");
  });

  it("turns pictures on the web into links, so a note never loads them by itself", () => {
    const parsed = parseMarkdownFiles([f("a.md", "![chart](https://example.com/c.png)")]);
    const body = dom(parsed.notes[0].html);
    expect(body.querySelector("img")).toBeNull();
    expect(body.querySelector('a[href="https://example.com/c.png"]')?.textContent).toBe("🖼 chart");
  });
});

describe("Notion", () => {
  it("reads page names", () => {
    expect(notionName(`Export/My Plan ${ID1}.md`)).toEqual({ title: "My Plan", id: ID1 });
    expect(notionName(`Tasks ${ID2}_all.csv`)).toEqual({ title: "Tasks", id: ID2 });
    expect(notionName("Plain.md")).toEqual({ title: "Plain" });
  });

  it("makes notes from pages and databases, with links between them", () => {
    const parsed = parseNotionFiles([
      f(`Home ${ID1}.md`, `# Home\n\nGo to [Tasks](Home%20${ID1}/Tasks%20${ID2}.csv) or [Write up](Home%20${ID1}/Write%20up%20${ID3}.md).\n\n<aside>\n💡 Remember this\n\n</aside>\n\n![x](Home%20${ID1}/pic.png)`),
      f(`Home ${ID1}/Tasks ${ID2}.csv`, "Name,Status\nWrite up,Done\n"),
      f(`Home ${ID1}/Tasks ${ID2}_all.csv`, "Name,Status\nWrite up,Done\nOld,Todo\n"),
      f(`Home ${ID1}/Tasks ${ID2}/Write up ${ID3}.md`, "# Write up\n\nStatus: Done\n\nText"),
      f(`Home ${ID1}/Write up ${ID3}.md`, "# Write up\n\nOther"),
      { path: `Home ${ID1}/pic.png`, bytes: PNG },
    ]);
    const byTitle = (t: string) => parsed.notes.filter((n) => n.title === t);
    expect(parsed.notes.map((n) => n.title).sort()).toEqual(["Home", "Tasks", "Write up", "Write up"]);
    const home = dom(byTitle("Home")[0].html);
    expect([...home.querySelectorAll("a[data-import-note]")].map((a) => a.getAttribute("data-import-note"))).toEqual([`Home ${ID1}/Tasks ${ID2}_all.csv`, `Home ${ID1}/Write up ${ID3}.md`]);
    expect(home.querySelector('[data-type="callout"]')?.getAttribute("data-emoji")).toBe("💡");
    expect(home.querySelector('[data-type="callout"]')?.textContent?.trim()).toBe("Remember this");
    expect(home.querySelector("img")?.getAttribute("data-import-src")).toBe(`Home ${ID1}/pic.png`);
    expect(byTitle("Home")[0].sourceId).toBe(ID1);
    // The database: every row (from _all.csv), names linked to their pages.
    const table = dom(byTitle("Tasks")[0].html);
    expect(table.querySelectorAll("tr").length).toBe(3);
    expect(table.querySelector("a[data-import-note]")?.getAttribute("data-import-note")).toBe(`Home ${ID1}/Tasks ${ID2}/Write up ${ID3}.md`);
  });

  it("reads the HTML export too", () => {
    const html = `<html><body><article><header><div class="page-header-icon"><span class="icon">🚀</span></div><h1 class="page-title">Launch</h1></header><div class="page-body"><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span>Ship</span></li><li><div class="checkbox checkbox-off"></div> <span>Tell</span></li></ul><ul class="toggle"><li><details open=""><summary>More</summary><p>Hidden</p></details></li></ul><figure class="callout"><div><span class="icon">⚠️</span></div><div>Careful</div></figure></div></article></body></html>`;
    const parsed = parseNotionFiles([f(`Launch ${ID1}.html`, html)]);
    const n = parsed.notes[0];
    expect(n).toMatchObject({ title: "Launch", icon: "🚀" });
    const body = dom(n.html);
    expect([...body.querySelectorAll('li[data-type="taskItem"]')].map((li) => [li.getAttribute("data-checked"), li.textContent])).toEqual([
      ["true", "Ship"],
      ["false", "Tell"],
    ]);
    expect(body.querySelector('details.note-toggle > div[data-type="detailsContent"]')?.textContent).toBe("Hidden");
    expect(body.querySelector('[data-type="callout"]')?.getAttribute("data-emoji")).toBe("⚠️");
  });
});

describe("Evernote", () => {
  const b64 = Buffer.from(PNG).toString("base64");
  const hash = createHash("md5").update(PNG).digest("hex");
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261101T120000Z" application="Evernote">
<note><title>Shopping &amp; more</title><created>20261101T093000Z</created><updated>20261102T100000Z</updated><tag>home</tag><tag>lists</tag>
<note-attributes><source-url>https://example.com/recipe</source-url></note-attributes>
<content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>First line</div><div><br/></div><div><en-todo checked="true"/>Milk</div><div><en-todo/>Bread</div><div>After</div><div><en-media hash="${hash}" type="image/png"/></div><div><en-media hash="0000" type="application/pdf"/></div><div style="-en-codeblock:true;"><div>let a = 1;</div><div>a++;</div></div><ul style="--en-todo:true;"><li style="--en-checked:true;"><div>New style</div></li></ul></en-note>]]></content>
<resource><data encoding="base64">${b64}</data><mime>image/png</mime><resource-attributes><file-name>photo.png</file-name></resource-attributes></resource>
</note>
<note><title>Second</title><content><![CDATA[<en-note><div>Two</div></en-note>]]></content></note>
</en-export>`;

  it("reads dates", () => {
    expect(enexDate("20261101T093000Z")).toBe("2026-11-01T09:30:00.000Z");
    expect(enexDate("bad")).toBeUndefined();
  });

  it("reads notes with checklists, pictures, code and tags", () => {
    const parsed = parseEnex([{ name: "Notebook.enex", text: enex }]);
    expect(parsed.notes.map((n) => n.title)).toEqual(["Shopping & more", "Second"]);
    const n = parsed.notes[0];
    expect(n.createdAt).toBe("2026-11-01T09:30:00.000Z");
    expect(n.updatedAt).toBe("2026-11-02T10:00:00.000Z");
    const body = dom(n.html);
    const lists = body.querySelectorAll('ul[data-type="taskList"]');
    expect(lists.length).toBe(2);
    expect([...lists[0].querySelectorAll("li")].map((li) => [li.getAttribute("data-checked"), li.textContent])).toEqual([
      ["true", "Milk"],
      ["false", "Bread"],
    ]);
    expect(lists[1].querySelector("li")?.getAttribute("data-checked")).toBe("true");
    expect(lists[1].textContent).toBe("New style");
    expect([...body.querySelectorAll(":scope > p")].map((p) => p.textContent)).toContain("First line");
    expect(body.querySelector("img")?.getAttribute("data-import-src")).toBe(hash);
    expect(parsed.images.get(hash)?.name).toBe("photo.png");
    expect(body.textContent).toContain("📎 attachment");
    expect(body.querySelector("pre code")?.textContent).toBe("let a = 1;\na++;");
    expect(body.querySelector('a[href="https://example.com/recipe"]')).not.toBeNull();
    expect(n.html).toContain("<p>Tags: home, lists</p>");
    expect(parsed.dropped.join(" ")).toContain("1 attachment");
  });
});

describe("Google Keep", () => {
  const note = (o: object) => JSON.stringify({ isTrashed: false, isPinned: false, isArchived: false, textContent: "", title: "", createdTimestampUsec: 1767225600000000, userEditedTimestampUsec: 1767312000000000, ...o });

  it("reads notes, lists, labels, pictures; leaves the bin out", () => {
    const parsed = parseKeepFiles([
      f("Takeout/Keep/Groceries.json", note({ title: "Groceries", listContent: [{ text: "Eggs", isChecked: true }, { text: "Rice", isChecked: false }], isPinned: true, labels: [{ name: "Home" }] })),
      f("Takeout/Keep/2026-01-01.json", note({ textContent: "Call the bank\nabout the card\n\nThen pay", createdTimestampUsec: 1767225600000001, attachments: [{ filePath: "2026-01-01.jpeg", mimetype: "image/jpeg" }, { filePath: "memo.3gp", mimetype: "audio/3gpp" }] })),
      { path: "Takeout/Keep/2026-01-01.jpg", bytes: PNG },
      f("Takeout/Keep/Old.json", note({ title: "Old", isArchived: true, textContent: "x", createdTimestampUsec: 3 })),
      f("Takeout/Keep/Gone.json", note({ title: "Gone", isTrashed: true, createdTimestampUsec: 4 })),
      f("Takeout/Keep/Groceries.html", "<html></html>"),
      f("Takeout/Keep/Labels.txt", "Home"),
    ]);
    expect(parsed.notes.map((n) => n.title)).toEqual(["Groceries", "Call the bank", "Old"]);
    const [g, bank, old] = parsed.notes;
    expect(g.pinned).toBe(true);
    expect(dom(g.html).querySelector('li[data-checked="true"]')?.textContent).toBe("Eggs");
    expect(g.html).toContain("<p>Tags: Home</p>");
    expect(g.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(bank.autoTitle).toBe(true);
    expect(dom(bank.html).querySelector("p")?.innerHTML).toBe("Call the bank<br>about the card");
    expect(dom(bank.html).querySelector("img")?.getAttribute("data-import-src")).toBe("Takeout/Keep/2026-01-01.jpg");
    expect(old.archived).toBe(true);
    expect(parsed.info.join(" ")).toContain("1 note in Keep's bin");
    expect(parsed.dropped.join(" ")).toContain("1 voice recording");
  });
});

describe("reading what was picked", () => {
  it("opens a .zip inside a .zip (Notion) and spots another app's export", async () => {
    const inner = new Uint8Array(await zipFiles([{ name: `Page ${ID1}.md`, text: "# Page\n\nHi" }]).arrayBuffer());
    const outer = new Uint8Array(await zipFiles([{ name: "Export-Part-1.zip", bytes: inner }]).arrayBuffer());
    const parsed = await readNoteFiles("markdown", [{ name: "Export.zip", bytes: outer }]);
    expect(parsed.app).toBe("notion");
    expect(parsed.notes[0].title).toBe("Page");
    expect(parsed.info[0]).toContain("Notion export");
  });

  it("reads several picked files, and says when there's nothing to import", async () => {
    const parsed = await readNoteFiles("markdown", [
      { name: "a.md", bytes: enc.encode("A") },
      { name: "b.txt", bytes: enc.encode("B") },
    ]);
    expect(parsed.notes.map((n) => n.title)).toEqual(["a", "b"]);
    const zip = new Uint8Array(await zipFiles([{ name: "x.pdf", text: "%PDF" }]).arrayBuffer());
    await expect(readNoteFiles("markdown", [{ name: "x.zip", bytes: zip }])).rejects.toThrow(/no notes/i);
  });
});

describe("building notes", () => {
  const parsed = (): ParsedNotes =>
    parseMarkdownFiles([
      f("Plan.md", "See [[Ideas]].\n\n![[shot.png]]"),
      f("Ideas.md", "Back to [[Plan]]"),
      { path: "shot.png", bytes: PNG },
    ]);

  it("links notes to each other by their new ids, and puts the pictures in", async () => {
    const built = await buildNotes(parsed(), { existing: [], includeArchived: true, toDataUrl: fakeDataUrl, now: new Date("2026-11-26T10:00:00Z") });
    expect(built.notes.length).toBe(2);
    const [plan, ideas] = built.notes;
    const link = dom(plan.content).querySelector('a[data-type="note-link"]')!;
    expect(link.getAttribute("data-note-id")).toBe(ideas.id);
    expect(link.getAttribute("href")).toBe(`#note-${ideas.id}`);
    expect(link.textContent).toBe("Ideas");
    expect(dom(ideas.content).querySelector("a")?.getAttribute("data-note-id")).toBe(plan.id);
    expect(dom(plan.content).querySelector("img")?.getAttribute("src")).toBe("data:image/webp;base64,8");
    expect(plan.content).not.toContain("data-import");
    expect(plan).toMatchObject({ title: "Plan", importedFrom: { app: "markdown", id: "Plan.md" }, createdAt: "2026-11-26T10:00:00.000Z", autoTitle: false });
  });

  it("skips notes imported before, and links to the copy already here", async () => {
    const first = await buildNotes(parsed(), { existing: [], includeArchived: true, toDataUrl: fakeDataUrl });
    const existing = [first.notes[1]]; // Ideas is already here; Plan was deleted.
    expect(summarizeNotes(parsed(), existing, true)).toMatchObject({ total: 2, toAdd: 1, duplicates: 1, pictures: 1 });
    const again = await buildNotes(parsed(), { existing, includeArchived: true, toDataUrl: fakeDataUrl });
    expect(again.skipped).toBe(1);
    expect(again.notes.map((n) => n.title)).toEqual(["Plan"]);
    expect(dom(again.notes[0].content).querySelector("a")?.getAttribute("data-note-id")).toBe(first.notes[1].id);
  });

  it("leaves out pictures that don't fit or can't be read, and notes that are too large", async () => {
    const big = "x".repeat(1_100_000);
    const p = parseMarkdownFiles([f("Big.md", big), f("Pic.md", "![[shot.png]]"), { path: "shot.png", bytes: PNG }]);
    expect(summarizeNotes(p, [], true).tooLarge).toEqual(["Big"]);
    const built = await buildNotes(p, { existing: [], includeArchived: true, toDataUrl: async () => Promise.reject(new Error("no")) });
    expect(built).toMatchObject({ tooLarge: 1, picturesDropped: 1 });
    expect(built.notes.map((n) => n.title)).toEqual(["Pic"]);
    expect(built.notes[0].content).not.toContain("<img");
  });

  it("leaves archived notes out when asked", async () => {
    const p = parseKeepFiles([f("Keep/a.json", JSON.stringify({ title: "A", textContent: "a", isTrashed: false, isArchived: true }))]);
    expect(summarizeNotes(p, [], false)).toMatchObject({ archived: 1, toAdd: 0 });
    expect((await buildNotes(p, { existing: [], includeArchived: false, toDataUrl: fakeDataUrl })).notes).toEqual([]);
  });

  it("imported notes open in the editor without losing anything", async () => {
    const enexBody = parseEnex([{ name: "a.enex", text: `<en-export><note><title>T</title><content><![CDATA[<en-note><div><en-todo checked="true"/>Done</div><div>Line</div><div style="-en-codeblock:true"><div>code</div></div></en-note>]]></content></note></en-export>` }]);
    const notion = parseNotionFiles([f(`P ${ID1}.md`, "<aside>\n🚀 Go\n\n</aside>\n\n| a | b |\n|---|---|\n| 1 | 2 |")]);
    const built = [
      ...(await buildNotes(parsed(), { existing: [], includeArchived: true, toDataUrl: fakeDataUrl })).notes,
      ...(await buildNotes(enexBody, { existing: [], includeArchived: true, toDataUrl: fakeDataUrl })).notes,
      ...(await buildNotes(notion, { existing: [], includeArchived: true, toDataUrl: fakeDataUrl })).notes,
    ];
    const ed = new Editor({ extensions: buildExtensions(), content: "<p></p>" });
    for (const n of built) {
      ed.commands.setContent(n.content);
      const out = dom(ed.getHTML());
      const before = dom(n.content);
      for (const sel of ['a[data-type="note-link"]', 'ul[data-type="taskList"]', '[data-type="callout"]', "table", "pre", "img"]) {
        expect([sel, out.querySelectorAll(sel).length]).toEqual([sel, before.querySelectorAll(sel).length]);
      }
      expect(out.textContent?.replace(/\s+/g, "")).toBe(before.textContent?.replace(/\s+/g, ""));
    }
    ed.destroy();
  });
});

describe("saving and Undo", () => {
  it("adds the notes on top, and Undo takes exactly them away", async () => {
    const mine: Note = { id: "mine", title: "Mine", content: "<p>x</p>", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    await storageSet("notes", [mine]);
    const p = parseMarkdownFiles([f("a.md", "A"), f("b.md", "B")]);
    const out = await applyNotesImport(p, { includeArchived: true, toDataUrl: fakeDataUrl });
    expect(out).toMatchObject({ added: 2, skipped: 0 });
    expect((await storageGet<Note[]>("notes", [])).map((n) => n.title)).toEqual(["a", "b", "Mine"]);
    const again = await applyNotesImport(p, { includeArchived: true, toDataUrl: fakeDataUrl });
    expect(again).toMatchObject({ added: 0, skipped: 2 });
    await undoNotesImport(out.undo);
    expect((await storageGet<Note[]>("notes", [])).map((n) => n.title)).toEqual(["Mine"]);
    expect(await storageGet<Record<string, unknown>>("prodli_tombstones", {})).toBeDefined();
  });
});
