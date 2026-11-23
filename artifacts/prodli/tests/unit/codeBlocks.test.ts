import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { CodeBlock, CodeBlockBase } from "../../src/sections/editor/codeBlock";
import { CODE_LANGUAGES, pickerLanguage } from "../../src/sections/editor/codeLanguages";
import { htmlToMarkdown } from "../../src/lib/markdownExport";
import { markdownToNoteHtml } from "../../src/lib/editorHtml";

// The React header only renders inside the app's React editor; here the plain
// node (same schema, options and colouring plugin) is enough.
const PlainCodeBlock = CodeBlockBase;

let editor: Editor | null = null;
const make = (content: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit.configure({ codeBlock: false }), PlainCodeBlock], content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const firstCodeBlock = (e: Editor) => {
  let found: { language: string | null; text: string } | null = null;
  e.state.doc.descendants((n) => {
    if (!found && n.type.name === "codeBlock") found = { language: n.attrs.language as string | null, text: n.textContent };
    return !found;
  });
  return found as { language: string | null; text: string } | null;
};

describe("code block languages", () => {
  it("offers Auto-detect, Plain text and the common languages", () => {
    const labels = CODE_LANGUAGES.map((c) => c.label);
    for (const l of ["Auto-detect", "Plain text", "JavaScript", "TypeScript", "Python", "JSON", "HTML", "CSS", "Bash / Shell", "SQL", "Go", "Rust", "Java", "C", "C++", "C#", "PHP", "Ruby", "Swift", "Kotlin", "YAML", "Markdown"]) {
      expect(labels).toContain(l);
    }
    expect(new Set(CODE_LANGUAGES.map((c) => c.id)).size).toBe(CODE_LANGUAGES.length);
    expect(CODE_LANGUAGES[0]).toEqual({ id: null, label: "Auto-detect" });
  });

  it("the editor's code block auto-detects (no default language) and keeps Tab as before", () => {
    expect(CodeBlock.name).toBe("codeBlock");
    expect(CodeBlock.options.defaultLanguage).toBeNull();
    expect(CodeBlock.options.enableTabIndentation).toBe(false);
  });

  it("every language in the picker has a grammar", () => {
    const lowlight = createLowlight(common);
    for (const c of CODE_LANGUAGES) if (c.id) expect(lowlight.registered(c.id), c.id).toBe(true);
  });

  it("maps fence aliases to the picker's languages", () => {
    expect(pickerLanguage("js")).toBe("javascript");
    expect(pickerLanguage("PY")).toBe("python");
    expect(pickerLanguage("sh")).toBe("bash");
    expect(pickerLanguage("yml")).toBe("yaml");
    expect(pickerLanguage("c++")).toBe("cpp");
    expect(pickerLanguage("plaintext")).toBe("text");
    expect(pickerLanguage("")).toBeNull();
    expect(pickerLanguage(null)).toBeNull();
    expect(pickerLanguage("mermaid")).toBe("mermaid");
  });
});

describe("code blocks in the editor", () => {
  it("colours code with highlight.js classes (set language or auto-detected)", () => {
    const e = make('<pre><code class="language-python">def add(a, b):\n    return a + b  # sum</code></pre><pre><code>const x = { "a": 1 };\nfunction f() { return x; }</code></pre>');
    const html = e.view.dom.innerHTML;
    expect(html).toMatch(/class="hljs-keyword"[^>]*>def</);
    expect(html).toContain("hljs-comment");
    expect(firstCodeBlock(e)?.language).toBe("python");
    // Colours are display-only: the saved HTML stays plain.
    expect(e.getHTML()).not.toContain("hljs");
    expect(e.getHTML()).toContain('<pre><code class="language-python">');
  });

  it("``` input rule and toggleCodeBlock still make code blocks", () => {
    const e = make("<p>hello</p>");
    e.commands.toggleCodeBlock();
    expect(firstCodeBlock(e)).toEqual({ language: null, text: "hello" });
    e.commands.updateAttributes("codeBlock", { language: "rust" });
    expect(e.getHTML()).toContain('<code class="language-rust">');
  });
});

describe("code blocks in Markdown", () => {
  it("export keeps the language on the fence", () => {
    const md = htmlToMarkdown('<p>Before</p><pre><code class="language-python">print("hi")\nx = 1</code></pre>');
    expect(md).toContain('```python\nprint("hi")\nx = 1\n```');
    expect(htmlToMarkdown("<pre><code>plain</code></pre>")).toContain("```\nplain\n```");
  });

  it("import keeps the language (```python → language=python)", () => {
    const html = markdownToNoteHtml('# Title\n\n```python\nprint("hi")\n```\n');
    expect(html).toContain('class="language-python"');
    expect(html).not.toContain('print("hi")\n<'); // no stray blank last line
    const e = make(html);
    expect(firstCodeBlock(e)).toEqual({ language: "python", text: 'print("hi")' });
  });

  it("round-trips a fenced block through the editor", () => {
    // (Text first: happy-dom's parser drops a <pre> at the very start; browsers don't.)
    const source = "Intro\n\n```ts\nconst n: number = 1;\n```";
    const e = make(markdownToNoteHtml(source));
    expect(firstCodeBlock(e)?.language).toBe("ts");
    expect(htmlToMarkdown(e.getHTML()).trim()).toBe(source);
  });
});
