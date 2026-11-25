import { describe, expect, it } from "vitest";
import { deriveTitle, htmlToText, preview, readOnlyReason, textToHtml, unsupportedFormatting } from "../../src/lib/html";

const TASKS = '<h1>Plan</h1><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done thing</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Open &amp; next</p></div></li></ul>';

describe("note HTML", () => {
  it("turns editor HTML into readable text", () => {
    expect(htmlToText(TASKS)).toBe("Plan\n☑ Done thing\n☐ Open & next");
    expect(htmlToText("<p>a<br>b</p><ul><li><p>x</p></li></ul>")).toBe("a\nb\n• x");
  });

  it("previews on one line and derives a title from the first line", () => {
    expect(preview(TASKS)).toBe("Plan · ☑ Done thing · ☐ Open & next");
    expect(deriveTitle(TASKS)).toBe("Plan");
    expect(deriveTitle("<ul><li><p>Milk</p></li></ul>")).toBe("Milk");
    expect(deriveTitle("")).toBe("Untitled");
    expect(deriveTitle(`<p>${"x".repeat(80)}</p>`)).toHaveLength(58);
  });

  it("keeps notes editable when the phone's editor keeps everything in them", () => {
    expect(readOnlyReason(TASKS)).toBeNull();
    // Highlights (multicolour), text colour, links, inline code, quotes, nested lists, plain images.
    expect(readOnlyReason('<p><mark data-color="#fde68a" style="background-color: #fde68a; color: inherit">hi</mark> <span style="color: #dc2626">red</span> <a target="_blank" rel="noopener noreferrer" href="https://x.com">link</a> <code>x</code></p><blockquote><p>q</p></blockquote><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><img src="data:image/webp;base64,AAA">')).toBeNull();
  });

  // What the computer's editor writes (artifacts/prodli sections/editor/*); the phone's editor keeps all of it
  // (round trip checked in artifacts/prodli/tests/unit/phoneEditable.test.ts).
  it.each([
    ["a table", '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>H</p></th><td colspan="1" rowspan="1"><p>1</p></td></tr></tbody></table>'],
    ["a code block", '<pre><code class="language-js">let x = 1</code></pre>'],
    ["a divider", "<p>a</p><hr><p>b</p>"],
    ["a callout", '<div data-emoji="💡" data-color="blue" data-type="callout"><p>Remember</p></div>'],
    ["a toggle", '<details class="note-toggle" open=""><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details>'],
    ["a link to another note", '<p>See <a data-note-id="n1" title="Plan" data-type="note-link" href="#note-n1">Plan</a></p>'],
    ["a picture with a caption and size", '<figure data-type="note-image" class="note-figure" data-width="60"><img src="data:image/webp;base64,AAA" class="note-image" style="width:60%" data-width="60"><figcaption>Cap</figcaption></figure>'],
    ["a background colour", '<p><span style="color: #dc2626; background-color: var(--note-yellow-bg)">both</span></p>'],
    ["an old Google Docs paste", '<p><span style="color: #000000; background-color: transparent;">old paste</span></p>'],
  ])("lets %s be edited", (_what, html) => {
    expect(readOnlyReason(html)).toBeNull();
  });

  it("opens anything else read-only (pasted from elsewhere, or from a newer ProdLi)", () => {
    for (const html of ["<p><sup>2</sup></p>", '<p style="text-align: center">x</p>', '<p><span style="font-size: 20px">x</span></p>', '<div data-type="something-new"><p>x</p></div>', "<iframe src=x></iframe>", '<td style="background: red"><p>x</p></td>']) {
      expect(readOnlyReason(html)).toMatch(/^This note has formatting the phone app can't edit yet.*edit it on your computer/);
    }
    expect(unsupportedFormatting("<p><sup>2</sup></p>")).toEqual(["formatting"]);
  });

  it("turns plain text with bullets into note HTML", () => {
    expect(textToHtml("Hello <you>\n- one\n- two\nBye")).toBe("<p>Hello &lt;you&gt;</p><ul><li><p>one</p></li><li><p>two</p></li></ul><p>Bye</p>");
  });
});
