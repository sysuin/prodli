import { describe, expect, it } from "vitest";
import { deriveTitle, htmlToText, preview, readOnlyReason, textToHtml } from "../../src/lib/html";

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

  it("opens notes with tables or unknown formatting read-only", () => {
    expect(readOnlyReason(TASKS)).toBeNull();
    expect(readOnlyReason("<p><mark>hi</mark> <a href='x'>link</a></p><pre><code>x</code></pre><hr>")).toBeNull();
    expect(readOnlyReason("<table><tbody><tr><td><p>1</p></td></tr></tbody></table>")).toMatch(/table/);
    expect(readOnlyReason("<details><summary>x</summary></details>")).toMatch(/can't edit/);
  });

  it("turns plain text with bullets into note HTML", () => {
    expect(textToHtml("Hello <you>\n- one\n- two\nBye")).toBe("<p>Hello &lt;you&gt;</p><ul><li><p>one</p></li><li><p>two</p></li></ul><p>Bye</p>");
  });
});
