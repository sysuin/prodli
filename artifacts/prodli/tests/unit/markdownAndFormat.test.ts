import { describe, expect, it } from "vitest";
import { htmlToMarkdown, noteToMarkdown, safeFileName } from "../../src/lib/markdownExport";
import { formatTimestamp, transcriptToText } from "../../src/recorder/format";

describe("note → Markdown", () => {
  it("converts Editor HTML", () => {
    const md = htmlToMarkdown(
      '<h1>Plan</h1><p><strong>Bold</strong>, <em>italic</em>, <s>gone</s>, <u>under</u> and <code>x</code>.</p><ul><li><p>One</p></li><li><p>Two</p></li></ul><ol><li><p>First</p></li></ol><pre><code>let a = 1;</code></pre><p><a href="https://example.com">link</a></p>',
    );
    expect(md).toContain("# Plan");
    expect(md).toContain("**Bold**, *italic*, ~~gone~~, under and `x`.");
    expect(md).toMatch(/-\s+One/);
    expect(md).toMatch(/1\.\s+First/);
    expect(md).toContain("```\nlet a = 1;\n```");
    expect(md).toContain("[link](https://example.com)");
  });

  it("adds the note title as a heading when the note has none", () => {
    expect(noteToMarkdown("Ideas", "<p>Hello</p>")).toBe("# Ideas\n\nHello\n");
    expect(noteToMarkdown("Ideas", "<h1>Already</h1><p>x</p>").startsWith("# Already")).toBe(true);
  });

  it("makes safe file names", () => {
    expect(safeFileName('Q4: plan / "draft"?', "md")).toBe("Q4 plan draft.md");
    expect(safeFileName("   ", "md")).toBe("note.md");
  });
});

describe("transcript formatting", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(65_000)).toBe("01:05");
    expect(formatTimestamp(3_725_000)).toBe("1:02:05");
  });

  it("formats a transcript for Claude", () => {
    expect(
      transcriptToText([
        { id: "1", speaker: "You", text: "Hi", startMs: 1000, endMs: 2000 },
        { id: "2", speaker: "Priya", text: "Hello", startMs: 61_000, endMs: 62_000 },
      ]),
    ).toBe("[00:01] You: Hi\n[01:01] Priya: Hello");
  });
});
