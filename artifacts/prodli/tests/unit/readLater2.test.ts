// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { appendHighlight, findPageNote, highlightHtml, highlightNoteHtml, saveHighlight } from "../../src/lib/readLater";
import { clampRate, htmlToSpeechText, splitForSpeech, startReading, stopReading, readAloudStatus } from "../../src/lib/readAloud";
import { storageGet, storageSet } from "../../src/lib/storage";
import type { Note } from "../../src/types";

describe("read aloud text", () => {
  it("strips HTML, skips code blocks and pauses between blocks", () => {
    const html = `<h1>Pricing guide</h1><p>Plans &amp; prices for <strong>teams</strong>.</p><pre><code>const secret = 1;</code></pre><ul><li><p>Free tier</p></li><li><p>Pro is $8</p></li></ul><blockquote><p>Worth it</p></blockquote><p>Line one<br>Line two</p><p></p>`;
    const text = htmlToSpeechText(html);
    expect(text).toBe("Pricing guide. Plans & prices for teams. Free tier. Pro is $8. Worth it. Line one. Line two.");
    expect(text).not.toContain("secret");
    expect(htmlToSpeechText("<p>It&#39;s &lt;fine&gt; &#x263A;</p>")).toBe("It's <fine> ☺.");
    expect(htmlToSpeechText("<p></p>")).toBe("");
  });

  it("keeps the speed between 0.75× and 2×", () => {
    expect(clampRate(0.5)).toBe(0.75);
    expect(clampRate(3)).toBe(2);
    expect(clampRate(1.25)).toBe(1.25);
    expect(clampRate("fast")).toBe(1);
  });

  it("splits long text into short pieces without losing words", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = splitForSpeech(text, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
    const long = "word ".repeat(100).trim();
    expect(splitForSpeech(long, 50).every((p) => p.length <= 50)).toBe(true);
    expect(splitForSpeech(long, 50).join(" ")).toBe(long);
  });

  it("speaks through speechSynthesis and stops", () => {
    const spoken: string[] = [];
    const cancel = vi.fn();
    class Utterance {
      text: string;
      rate = 1;
      onend: (() => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: (u: Utterance) => spoken.push(u.text), cancel, pause: vi.fn(), resume: vi.fn(), getVoices: () => [] } });
    expect(startReading("Hello there. Second line.", "a")).toBe(true);
    expect(spoken.join(" ")).toBe("Hello there. Second line.");
    expect(readAloudStatus()).toEqual({ owner: "a", state: "playing" });
    stopReading("b"); // not the one speaking
    expect(readAloudStatus().state).toBe("playing");
    stopReading("a");
    expect(readAloudStatus()).toEqual({ owner: null, state: "idle" });
    expect(cancel).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("highlights", () => {
  const page = { title: "Deep <work>", url: "https://www.example.com/post" };

  it("writes a quote with the page title and link", () => {
    expect(highlightHtml("Focus is a skill & a habit.", page)).toBe('<blockquote><p>Focus is a skill &amp; a habit.</p><p>— <a href="https://www.example.com/post">Deep &lt;work&gt;</a></p></blockquote>');
    expect(highlightHtml("a\n\nb\nc", page)).toContain("<p>a</p><p>b<br>c</p>");
    expect(highlightHtml("x", { title: "T", url: "javascript:alert(1)" })).toBe("<blockquote><p>x</p><p>— T</p></blockquote>");
  });

  it("appends under one Highlights heading, dropping empty trailing paragraphs", () => {
    const summary = '<h1>Deep work</h1><p>Source: <a href="https://www.example.com/post">example.com</a></p><h2>Summary</h2><p>Short.</p><p></p>';
    const once = appendHighlight(summary, "First", page);
    expect(once.startsWith(summary.replace(/<p><\/p>$/, "") + "<h2>Highlights</h2><blockquote><p>First</p>")).toBe(true);
    const twice = appendHighlight(once, "Second", page);
    expect(twice.match(/<h2>Highlights<\/h2>/g)).toHaveLength(1);
    expect(twice.endsWith("<blockquote><p>Second</p><p>— <a href=\"https://www.example.com/post\">Deep &lt;work&gt;</a></p></blockquote>")).toBe(true);
    expect(highlightNoteHtml("Q", page)).toMatch(/^<h1>Highlights: Deep &lt;work&gt;<\/h1><p>Source: <a href="https:\/\/www.example.com\/post">example.com<\/a><\/p><h2>Highlights<\/h2><blockquote>/);
  });

  it("finds a page's note by its link, including older summary notes", () => {
    const notes = [
      { id: "t", content: '<p>Source: <a href="https://a.com/">a</a></p>', template: true },
      { id: "old", content: '<h1>A</h1><p>Source: <a href="https://a.com/">a.com</a></p>' },
      { id: "new", content: "<h1>B</h1>", sourceUrl: "https://b.com/x" },
    ] as Note[];
    expect(findPageNote(notes, "https://a.com")?.id).toBe("old");
    expect(findPageNote(notes, "https://b.com/x")?.id).toBe("new");
    expect(findPageNote(notes, "https://c.com")).toBeUndefined();
    expect(findPageNote(notes, "chrome://settings")).toBeUndefined();
  });

  it("saves one note per page: a new Highlights note, then appends to it", async () => {
    await storageSet("notes", []);
    const first = await saveHighlight({ quote: " First quote ", url: "https://blog.example.com/a", title: "A post" });
    expect(first?.created).toBe(true);
    expect(first?.note.title).toBe("Highlights: A post");
    const second = await saveHighlight({ quote: "Second quote", url: "https://blog.example.com/a", title: "A post" });
    expect(second?.created).toBe(false);
    const notes = await storageGet<Note[]>("notes", []);
    expect(notes).toHaveLength(1);
    expect(notes[0].sourceUrl).toBe("https://blog.example.com/a");
    expect(notes[0].content).toContain("<p>First quote</p>");
    expect(notes[0].content).toContain("<p>Second quote</p>");
    expect(await saveHighlight({ quote: "x", url: "chrome://newtab", title: "" })).toBeNull();
    expect(await saveHighlight({ quote: "  ", url: "https://x.com", title: "" })).toBeNull();
  });

  it("adds highlights to the page's summary note when there is one", async () => {
    const summary: Note = { id: "s1", title: "A post", content: '<h1>A post</h1><p>Source: <a href="https://blog.example.com/b">example.com</a></p><h2>Summary</h2><p>Short.</p>', createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    await storageSet("notes", [summary]);
    const r = await saveHighlight({ quote: "Quote", url: "https://blog.example.com/b", title: "A post" }, new Date("2026-11-23T10:00:00Z"));
    expect(r?.note.id).toBe("s1");
    const [n] = await storageGet<Note[]>("notes", []);
    expect(n.content).toContain("<h2>Summary</h2><p>Short.</p><h2>Highlights</h2><blockquote><p>Quote</p>");
    expect(n.updatedAt).toBe("2026-11-23T10:00:00.000Z");
    expect(n.sourceUrl).toBe("https://blog.example.com/b");
  });
});
