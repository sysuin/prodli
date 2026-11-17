// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { buildExtensions } from "../../src/sections/editor/extensions";
import { captureSelection, insertHtmlBelow, replaceWithHtml, targetIntact, type Target } from "../../src/sections/editor/ImproveMenu";
import { MAX_REWRITE_CHARS, plainText, rewriteText, rewriteToHtml, RewriteError, SIGN_IN_FOR_WRITING, wordDiff } from "../../src/lib/write";
import { storageSet } from "../../src/lib/storage";

describe("writing help: text helpers", () => {
  it("strips Markdown to plain text for previews and Copy", () => {
    expect(plainText("# Plan\n\n- [ ] **Ship** the [beta](https://x.test)\n- ==Now== and `code`\n1. ~~old~~ new\n> quoted")).toBe("Plan\n\nShip the beta\nNow and code\nold new\nquoted");
    expect(plainText("Price is 5 \\* 2")).toBe("Price is 5 * 2");
  });

  it("marks changed words", () => {
    expect(wordDiff("I saw teh plan yesterday", "I saw the plan yesterday")).toEqual([
      { kind: "same", text: "I saw " },
      { kind: "removed", text: "teh" },
      { kind: "added", text: "the" },
      { kind: "same", text: " plan yesterday" },
    ]);
    expect(wordDiff("same text", "same text")).toEqual([{ kind: "same", text: "same text" }]);
    // Whitespace-only differences aren't marked.
    expect(wordDiff("a  b", "a b")!.every((p) => p.kind === "same")).toBe(true);
  });

  it("gives up on comparing very long texts instead of freezing", () => {
    const long = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(" ");
    expect(wordDiff(long, `${long} more`)).toBeNull();
  });

  it("turns the reply back into Editor HTML, keeping highlights, checklists, bold and links", async () => {
    const html = await rewriteToHtml("- [x] **Done** with ==this==\n- [ ] see [docs](https://docs.test)");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain("<strong>Done</strong>");
    expect(html).toContain("<mark>this</mark>");
    expect(html).toContain('href="https://docs.test"');
    expect(await rewriteToHtml("<img src=x onerror=alert(1)> hi")).not.toMatch(/onerror/);
  });
});

describe("writing help: requests", () => {
  beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const signIn = () => storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });

  it("checks the text before sending anything", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(rewriteText("fix", "   ")).rejects.toThrow(RewriteError);
    await expect(rewriteText("fix", "x".repeat(MAX_REWRITE_CHARS + 1))).rejects.toThrow(/too much text/);
    await expect(rewriteText("fix", "hello")).rejects.toThrow(SIGN_IN_FOR_WRITING);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends the action and text and returns the suggestion", async () => {
    await signIn();
    let sent: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/api/ai/rewrite");
      sent = JSON.parse(String(init?.body));
      return Response.json({ text: "Hello there.", changed: true, usage: { used: 3, limit: 200 } });
    }) as typeof fetch;
    expect(await rewriteText("formal", "  hey there  ")).toEqual({ text: "Hello there.", changed: true, usage: { used: 3, limit: 200 } });
    expect(sent).toEqual({ action: "formal", text: "hey there" });
  });

  it("explains server errors in writing-help words", async () => {
    await signIn();
    const reply = (status: number, error: string) => (globalThis.fetch = vi.fn(async () => Response.json({ error }, { status })) as typeof fetch);
    reply(429, "write_quota_exceeded");
    await expect(rewriteText("fix", "a")).rejects.toThrow(/used this month's writing help/);
    reply(502, "ai_failed");
    await expect(rewriteText("fix", "a")).rejects.toThrow("Something went wrong. Try again.");
    reply(503, "ai_busy");
    await expect(rewriteText("fix", "a")).rejects.toThrow(/Writing help is busy/);
  });
});

describe("writing help: applying a suggestion in the Editor", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ extensions: buildExtensions(), content: "<p>Hello <strong>wrold</strong>, how are you?</p><p>Second line</p>" });
  });
  afterEach(() => editor.destroy());

  const select = (text: string) => {
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text!.includes(text)) from = pos + node.text!.indexOf(text);
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + text.length)));
  };
  const mdSelect = async (from: number, to: number) => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    return (await captureSelection(editor)) as Target;
  };

  it("sends the selection as Markdown, keeping formatting", async () => {
    const t = await mdSelect(1, 26); // "Hello wrold, how are you?"
    expect(t.markdown).toBe("Hello **wrold**, how are you?");
    expect(t.docText).toBe("Hello wrold, how are you?");
  });

  it("explains why some selections can't be improved", async () => {
    expect(await captureSelection(editor)).toMatch(/Select some text first/);
    editor.commands.setContent("<pre><code>let x = 1</code></pre>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(await captureSelection(editor)).toMatch(/code blocks/);
  });

  it("replaces inside the paragraph without splitting it, in one undo step", async () => {
    select("wrold");
    const t = (await captureSelection(editor)) as Target;
    replaceWithHtml(editor, t, await rewriteToHtml("**world**"));
    expect(editor.getHTML()).toBe("<p>Hello <strong>world</strong>, how are you?</p><p>Second line</p>");
    editor.commands.undo();
    expect(editor.getHTML()).toBe("<p>Hello <strong>wrold</strong>, how are you?</p><p>Second line</p>");
  });

  it("can replace one paragraph with several", async () => {
    const t = await mdSelect(1, 26);
    replaceWithHtml(editor, t, await rewriteToHtml("Hello **world**.\n\nHow are you?"));
    expect(editor.getHTML()).toBe("<p>Hello <strong>world</strong>.</p><p>How are you?</p><p>Second line</p>");
  });

  it("inserts below the paragraph and leaves the original alone", async () => {
    select("wrold");
    const t = (await captureSelection(editor)) as Target;
    insertHtmlBelow(editor, t, await rewriteToHtml("Hello world, how are you?"));
    expect(editor.getHTML()).toBe("<p>Hello <strong>wrold</strong>, how are you?</p><p>Hello world, how are you?</p><p>Second line</p>");
  });

  it("notices when the note changed since the request", async () => {
    select("wrold");
    const t = (await captureSelection(editor)) as Target;
    expect(targetIntact(editor, t)).toBe(true);
    editor.commands.insertContentAt(1, "Oh! ");
    expect(targetIntact(editor, t)).toBe(false);
  });
});
