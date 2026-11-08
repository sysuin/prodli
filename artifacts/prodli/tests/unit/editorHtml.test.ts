// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, markdownToNoteHtml, rowsToTableHtml, toEditorHtml } from "../../src/lib/editorHtml";
import { htmlToMarkdown } from "../../src/lib/markdownExport";
import { fileToNoteHtml } from "../../src/lib/filePreview";

describe("Markdown → Editor HTML", () => {
  it("turns Markdown task lists into Editor checklists", () => {
    const html = markdownToNoteHtml("- [x] done\n- [ ] todo");
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('data-type="taskItem" data-checked="true"');
    expect(html).toContain('data-checked="false"');
    expect(html).not.toContain("<input");
  });

  it("leaves normal lists alone", () => {
    expect(toEditorHtml("<ul><li>a</li><li>b</li></ul>")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("detects Markdown worth converting on paste", () => {
    expect(looksLikeMarkdown("# Title\n\ntext")).toBe(true);
    expect(looksLikeMarkdown("- [ ] task\n- [x] done")).toBe(true);
    expect(looksLikeMarkdown("see **this**")).toBe(true);
    expect(looksLikeMarkdown("just a plain sentence")).toBe(false);
    expect(looksLikeMarkdown("line one\nline two")).toBe(false);
  });

  it("builds editable tables from CSV rows and escapes cells", () => {
    const html = rowsToTableHtml([["Name", "Role"], ["<Priya>", "PM"]]);
    expect(html).toBe("<table><tbody><tr><th><p>Name</p></th><th><p>Role</p></th></tr><tr><td><p>&lt;Priya&gt;</p></td><td><p>PM</p></td></tr></tbody></table>");
    expect(fileToNoteHtml({ name: "a.csv", size: 0, kind: "csv", ext: "csv", text: "a,b\n1,2\n", lastModified: 0 })).toContain("<th><p>a</p></th>");
  });
});

describe("Editor HTML → Markdown", () => {
  it("exports checklists, highlights and tables", () => {
    const md = htmlToMarkdown(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Done</p></div></li><li data-type="taskItem" data-checked="false"><div><p>Open</p></div></li></ul>' +
        "<p><mark>hi</mark></p>" +
        '<table style="min-width: 75px"><colgroup><col><col></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th><th><p>Role</p></th></tr><tr><td><p>Priya</p></td><td><p>PM</p></td></tr></tbody></table>',
    );
    expect(md).toContain("- [x] Done");
    expect(md).toContain("- [ ] Open");
    expect(md).toContain("==hi==");
    expect(md).toMatch(/\|\s*Name\s*\|\s*Role\s*\|/);
    expect(md).toMatch(/\|\s*Priya\s*\|\s*PM\s*\|/);
  });
});
