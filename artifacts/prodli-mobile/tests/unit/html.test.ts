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

  // The HTML below is what the extension's editor writes (sections/editor/*.ts renderHTML).
  it.each([
    ["<table><tbody><tr><td><p>1</p></td></tr></tbody></table>", "a table"],
    ['<pre><code class="language-js">let x = 1</code></pre>', "a code block"],
    ["<p>a</p><hr><p>b</p>", "a divider"],
    ['<div data-emoji="💡" data-color="blue" data-type="callout"><p>Remember</p></div>', "a callout"],
    ['<details class="note-toggle" open=""><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details>', "a toggle"],
    ['<p>See <a data-note-id="n1" data-type="note-link" href="#note-n1">Plan</a></p>', "a link to another note"],
    ['<figure data-type="note-image" data-width="m"><img src="data:image/webp;base64,AAA"><figcaption>Cap</figcaption></figure>', "a picture"],
    ['<p><span style="background-color: #fef3c7">yellow</span></p>', "a background colour"],
    ['<p><span style="color: #dc2626; background-color: #fef3c7">both</span></p>', "a background colour"],
  ])("opens %s read-only (%s)", (html, what) => {
    const reason = readOnlyReason(html);
    expect(reason).toContain(what);
    expect(reason).toMatch(/edit it on your computer/);
  });

  it("names several things at once, and unknown formatting generically", () => {
    expect(readOnlyReason('<pre><code>x</code></pre><div data-type="callout"><p>c</p></div>')).toMatch(/^This note has a code block and a callout the phone app can't edit yet/);
    expect(readOnlyReason("<p><sup>2</sup></p>")).toMatch(/^This note has formatting the phone app can't edit yet/);
    expect(readOnlyReason('<p style="text-align: center">x</p>')).toMatch(/formatting/);
    expect(unsupportedFormatting('<p><span style="font-size: 20px">x</span></p>')).toEqual(["other formatting"]);
  });

  it("turns plain text with bullets into note HTML", () => {
    expect(textToHtml("Hello <you>\n- one\n- two\nBye")).toBe("<p>Hello &lt;you&gt;</p><ul><li><p>one</p></li><li><p>two</p></li></ul><p>Bye</p>");
  });
});
