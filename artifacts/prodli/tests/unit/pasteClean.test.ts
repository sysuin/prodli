import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../src/sections/editor/extensions";
import { cleanPastedHtml, cleanStyle, isDefaultBackground, isDefaultTextColor } from "../../src/lib/pasteClean";

/** Pastes clipboard HTML into the real note editor (as EditorSection sets it up) and returns the note's HTML. */
function paste(html: string): string {
  const ed = new Editor({ extensions: buildExtensions(), content: "<p></p>", editorProps: { transformPastedHTML: (h) => cleanPastedHtml(h) } });
  ed.view.pasteHTML(html);
  const out = ed.getHTML().replace(/<p><\/p>$/, "");
  ed.destroy();
  return out;
}

// Shapes of what these apps put on the clipboard.
const GDOCS_SPAN = (style: string, text: string) => `<span style="font-size:11pt;font-family:Arial,sans-serif;${style}font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">${text}</span>`;
const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-9abcdef01234"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;">${GDOCS_SPAN("color:#000000;background-color:transparent;font-weight:400;font-style:normal;", "Launch plan")}</h2><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${GDOCS_SPAN("color:#000000;background-color:transparent;font-weight:700;font-style:normal;", "Owner:")}${GDOCS_SPAN("color:#000000;background-color:transparent;font-weight:400;font-style:italic;", " Sunny")}</p><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;color:#000000;background-color:transparent;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${GDOCS_SPAN("color:#000000;background-color:transparent;font-weight:400;font-style:normal;", "Store listing")}</p></li></ul><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${GDOCS_SPAN("color:#ff0000;background-color:#ffff00;font-weight:400;font-style:normal;", "Red on yellow")}</p></b><br class="Apple-interchange-newline">`;
const GDOCS_CHECKLIST = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-aa"><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" role="checkbox" aria-checked="true" style="list-style-type:none;color:#000000;" aria-level="1"><p dir="ltr" role="presentation">${GDOCS_SPAN("color:#000000;background-color:transparent;", "Book the venue")}</p></li><li dir="ltr" role="checkbox" aria-checked="false" style="list-style-type:none;color:#000000;" aria-level="1"><p dir="ltr" role="presentation">${GDOCS_SPAN("color:#000000;background-color:transparent;", "Send invites")}</p></li></ul></b>`;
const WORD_BULLET = (level: number, glyph: string, text: string, cls = "MsoListParagraphCxSpMiddle", list = "l0", lfo = "lfo1") =>
  `<p class=${cls} style='margin-left:${36 * level}.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:${list} level${level} ${lfo}'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>${glyph}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-GB>${text}<o:p></o:p></span></p>`;
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {margin:0cm; font-size:12.0pt;} --></style></head><body lang=EN-GB style='tab-interval:36.0pt'><!--StartFragment--><p class=MsoNormal><b><span lang=EN-GB>Agenda<o:p></o:p></span></b></p>${WORD_BULLET(1, "·", "Budget", "MsoListParagraphCxSpFirst")}${WORD_BULLET(2, "o", "Q1 numbers")}${WORD_BULLET(1, "·", "Hiring", "MsoListParagraphCxSpLast")}<p class=MsoNormal><span lang=EN-GB><o:p>&nbsp;</o:p></span></p>${WORD_BULLET(1, "1.", "First step", "MsoListParagraphCxSpFirst", "l1", "lfo2")}${WORD_BULLET(1, "2.", "Second step", "MsoListParagraphCxSpLast", "l1", "lfo2")}<p class=MsoNormal><span style='color:black;background:white;mso-themecolor:text1'>Plain end</span></p><!--EndFragment--></body></html>`;
const WEB_DEFAULT_GRAY = `<h2 style="color: rgb(55, 53, 47);">Ideas</h2><p><span style="color: rgb(55, 53, 47);">Plain</span> and <span style="color: rgb(212, 76, 71);">red</span> and <span style="color: rgb(120, 119, 116);">gray</span></p>`;

describe("pasting from other apps", () => {
  it("Google Docs: keeps headings, bold, italic, lists and real colours; drops the black text and transparent backgrounds", () => {
    expect(paste(GDOCS)).toBe('<h2>Launch plan</h2><p><strong>Owner:</strong><em> Sunny</em></p><ul><li><p>Store listing</p></li></ul><p><span style="color: #ff0000; background-color: #ffff00;">Red on yellow</span></p>');
  });

  it("Google Docs: checklists become ProdLi checklists", () => {
    const out = paste(GDOCS_CHECKLIST);
    expect(out).toContain('<ul data-type="taskList">');
    expect(out).toMatch(/data-checked="true"[^>]*>.*Book the venue/);
    expect(out).toMatch(/data-checked="false"[^>]*>.*Send invites/);
    expect(out).not.toContain("#000000");
  });

  it("Word: list paragraphs become real lists (nested and numbered), without the typed bullets or Office tags", () => {
    expect(paste(WORD)).toBe("<p><strong>Agenda</strong></p><ul><li><p>Budget</p><ul><li><p>Q1 numbers</p></li></ul></li><li><p>Hiring</p></li></ul><p></p><ol><li><p>First step</p></li><li><p>Second step</p></li></ol><p>Plain end</p>");
  });

  it("web pages and Notion: their default near-black text goes, real colours and mid-grays stay", () => {
    expect(paste(WEB_DEFAULT_GRAY)).toBe('<h2>Ideas</h2><p>Plain and <span style="color: rgb(212, 76, 71);">red</span> and <span style="color: rgb(120, 119, 116);">gray</span></p>');
  });

  it("copying inside ProdLi keeps its own colours", () => {
    expect(paste('<p><span style="color: var(--note-red);">mine</span> <span style="background-color: var(--note-yellow-bg);">bg</span></p>')).toBe('<p><span style="color: var(--note-red);">mine</span> <span style="background-color: var(--note-yellow-bg);">bg</span></p>');
  });

  it("leaves HTML with nothing to clean exactly as it was", () => {
    const plain = "<h1>Hi</h1><ul><li>a</li></ul>";
    expect(cleanPastedHtml(plain)).toBe(plain);
  });
});

describe("colour rules", () => {
  it.each(["#000", "#000000", "black", "windowtext", "rgb(0, 0, 0)", "rgb(55, 53, 47)", "#222222", "#ffffff", "rgba(255, 255, 255, 0.81)", "inherit", "transparent"])("%s is a default text colour", (c) => {
    expect(isDefaultTextColor(c)).toBe(true);
  });
  it.each(["#ff0000", "rgb(212, 76, 71)", "#666666", "rgb(120, 119, 116)", "var(--note-gray)", "red", "#1155cc"])("%s is kept as a text colour", (c) => {
    expect(isDefaultTextColor(c)).toBe(false);
  });
  it.each(["transparent", "white", "#fff", "#ffffff", "rgba(0, 0, 0, 0)", "none", "#000000"])("%s is no background", (c) => {
    expect(isDefaultBackground(c)).toBe(true);
  });
  it.each(["#ffff00", "yellow", "rgb(251, 243, 219)", "var(--note-yellow-bg)", "#cccccc"])("%s is kept as a background", (c) => {
    expect(isDefaultBackground(c)).toBe(false);
  });
  it("keeps only real colours and backgrounds in a style attribute", () => {
    expect(cleanStyle("font-size:11pt;font-family:Arial;color:#ff0000;background-color:#ffff00;white-space:pre-wrap")).toBe("color: #ff0000; background-color: #ffff00");
    expect(cleanStyle("font-weight:700;color:#000000;background-color:transparent;font-style:italic")).toBeNull();
    expect(cleanStyle("color:black;background:white;mso-themecolor:text1")).toBeNull();
    expect(cleanStyle("background:url(x.png)")).toBeNull();
  });

  it("bold, italic, underline and strike written as span styles become tags", () => {
    expect(paste('<p><span style="font-weight:700;text-decoration:underline">a</span> <span style="font-style:italic;text-decoration:line-through">b</span></p>')).toBe("<p><strong><u>a</u></strong> <em><s>b</s></em></p>");
  });
});
