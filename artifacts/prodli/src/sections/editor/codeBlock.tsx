// Code blocks with syntax colours (lowlight = highlight.js grammars) and a small
// header: a language picker and a Copy button. The header isn't part of the
// note's text: it isn't saved, exported or printed.

import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef, useState } from "react";
import { CODE_LANGUAGES, pickerLanguage } from "./codeLanguages";

const lowlight = createLowlight(common);

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const raw = (node.attrs.language as string | null) || null;
  const language = pickerLanguage(raw); // "js" → "javascript" for the picker
  const known = CODE_LANGUAGES.some((c) => c.id === language);

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(node.textContent);
    } catch {
      ok = false;
    }
    setCopied(ok ? "ok" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 2000);
  };

  return (
    <NodeViewWrapper as="div" className="note-code" data-language={language ?? undefined}>
      <div className="note-code-head" contentEditable={false}>
        <select
          aria-label="Code language"
          title="Code language"
          value={language ?? ""}
          disabled={!editor.isEditable}
          onChange={(e) => updateAttributes({ language: e.target.value || null })}
        >
          {!known && language && <option value={language}>{language}</option>}
          {CODE_LANGUAGES.map((c) => (
            <option key={c.id ?? ""} value={c.id ?? ""}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="note-code-copy" onMouseDown={(e) => e.preventDefault()} onClick={() => void copy()} title="Copy the code">
          {copied === "ok" ? "Copied ✓" : copied === "failed" ? "Couldn't copy" : "Copy"}
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {copied === "ok" ? "Code copied" : ""}
        </span>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" className={raw ? `language-${raw}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}

/** StarterKit's code block plus colours (auto-detected when no language is set). */
export const CodeBlockBase = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null });

/** …with the header (language picker, Copy). */
export const CodeBlock = CodeBlockBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
