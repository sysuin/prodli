import { describe, expect, it } from "vitest";
import { highlightCode, languageForExt, MAX_HIGHLIGHT_CHARS } from "../../src/lib/highlight";

describe("syntax highlighting", () => {
  it("maps file extensions to languages", () => {
    expect(languageForExt("ts")).toBe("typescript");
    expect(languageForExt("PY")).toBe("python");
    expect(languageForExt("yml")).toBe("yaml");
    expect(languageForExt("unknownext")).toBeNull();
  });

  it("highlights code and escapes HTML in it", () => {
    const html = highlightCode('const x = "<script>alert(1)</script>"; // hi', "javascript")!;
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("skips unknown languages and very large files", () => {
    expect(highlightCode("x", null)).toBeNull();
    expect(highlightCode("a".repeat(MAX_HIGHLIGHT_CHARS + 1), "javascript")).toBeNull();
  });
});
