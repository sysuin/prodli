// @vitest-environment jsdom
// jsdom (not happy-dom) so DOMPurify runs exactly as in a real browser.
import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  fileToNoteHtml,
  findJsonErrorPosition,
  kindFor,
  markdownToSafeHtml,
  parseDelimited,
  parseJson,
  parseJsonLines,
  readPreviewFile,
  type OpenedFile,
} from "../../src/lib/filePreview";

describe("kindFor", () => {
  it("detects file types by extension", () => {
    expect(kindFor("README.md")).toBe("markdown");
    expect(kindFor("data.JSON")).toBe("json");
    expect(kindFor("events.ndjson")).toBe("jsonl");
    expect(kindFor("table.tsv")).toBe("csv");
    expect(kindFor("app.log")).toBe("text");
    expect(kindFor("Makefile")).toBe("text");
  });
});

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const rows = parseDelimited('name,notes\n"Shah, Priya","Says ""hi""\nline 2"\nAlex,\n', ",");
    expect(rows).toEqual([
      ["name", "notes"],
      ["Shah, Priya", 'Says "hi"\nline 2'],
      ["Alex", ""],
    ]);
  });

  it("handles Windows line endings and a missing final newline", () => {
    expect(parseDelimited("a,b\r\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects the separator", () => {
    expect(detectDelimiter("a;b;c\n1;2;3", "csv")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2", "csv")).toBe("\t");
    expect(detectDelimiter('"x,y";z\n', "csv")).toBe(";"); // comma inside quotes ignored
    expect(detectDelimiter("a,b", "tsv")).toBe("\t");
  });
});

describe("JSON", () => {
  it("parses valid JSON", () => {
    expect(parseJson('{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
  });

  it("reports the line and column of an error", () => {
    const r = parseJson('{\n  "a": 1,\n  "b": [1, 2,\n}\n');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(4);
      expect(r.column).toBe(1);
    }
  });

  it("finds error positions for common mistakes", () => {
    expect(findJsonErrorPosition('{"a": 1,}')).toBe(8); // trailing comma
    expect(findJsonErrorPosition("{'a': 1}")).toBe(1); // single quotes
    expect(findJsonErrorPosition('{"a": tru}')).toBe(6);
    expect(findJsonErrorPosition('{"a": 1} extra')).toBe(9);
    expect(findJsonErrorPosition('{"a": [1, 2]}')).toBeNull();
  });

  it("parses JSON Lines and reports the bad line", () => {
    expect(parseJsonLines('{"a":1}\n\n{"a":2}\n')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2 }] });
    const bad = parseJsonLines('{"a":1}\n{oops}\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.line).toBe(2);
  });
});

describe("Markdown sanitizing", () => {
  it("renders GitHub-flavored Markdown", () => {
    const html = markdownToSafeHtml("# Title\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<table>");
    expect(html).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*disabled)[^>]*>/);
  });

  it("removes scripts, event handlers and javascript: links", () => {
    const html = markdownToSafeHtml(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[x](javascript:alert(3))\n\n<a href="javascript:alert(4)">y</a>\n\n<iframe src="https://evil.example"></iframe>',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/<iframe/i);
  });

  it("opens links in a new tab without opener access", () => {
    const html = markdownToSafeHtml("[site](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("files", () => {
  const file = (name: string, text: string, ext: string, kind: OpenedFile["kind"]): OpenedFile => ({ name, size: text.length, kind, ext, text, lastModified: 0 });

  it("rejects binary files and oversized files", async () => {
    await expect(readPreviewFile(new File([new Uint8Array([0, 1, 2, 0])], "x.bin"))).rejects.toThrow(/binary/);
    const big = new File(["x"], "big.txt");
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await expect(readPreviewFile(big)).rejects.toThrow(/up to 10/);
  });

  it("strips a byte-order mark", async () => {
    const f = await readPreviewFile(new File(["﻿# Hi"], "a.md"));
    expect(f.text).toBe("# Hi");
    expect(f.kind).toBe("markdown");
  });

  it("converts files to note HTML safely", () => {
    expect(fileToNoteHtml(file("a.json", '{"a":1}', "json", "json"))).toBe("<pre><code>{\n  &quot;a&quot;: 1\n}</code></pre>");
    expect(fileToNoteHtml(file("a.txt", "one\ntwo\n\nthree <b>", "txt", "text"))).toBe("<p>one<br>two</p><p>three &lt;b&gt;</p>");
    expect(fileToNoteHtml(file("a.js", "if (a < b) {}", "js", "text"))).toBe("<pre><code>if (a &lt; b) {}</code></pre>");
  });
});
