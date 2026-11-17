// "✨ Improve" for selected text in Notes: pick an action, see the suggestion
// (with changed words marked for "Fix"), then Replace, Insert below or Copy.
// Nothing in the note changes until the user clicks, and Replace is one undo
// step. Network and text helpers: lib/write.ts.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { DOMParser as PMDOMParser, DOMSerializer } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { plainText, REWRITE_ACTIONS, rewriteText, rewriteToHtml, RewriteError, TOO_LONG, MAX_REWRITE_CHARS, wordDiff, type RewriteAction, type RewriteResult } from "../../lib/write";

const BUBBLE_KEY = "formatBubble";
const PANEL_WIDTH = 460;

export interface Target {
  from: number;
  to: number;
  /** The selection as Markdown (what's sent). */
  markdown: string;
  /** The note's text in that range when it was captured, to notice edits made since. */
  docText: string;
}

type Phase =
  | { kind: "menu" }
  | { kind: "loading"; action: RewriteAction }
  | { kind: "result"; action: RewriteAction; result: RewriteResult; plain: string }
  | { kind: "error"; message: string; action?: RewriteAction };

interface OpenState {
  target: Target;
  phase: Phase;
  pos: { top: number; left: number; width: number };
  /** Opened from the keyboard (Ctrl/⌘+J, command palette): move focus into the panel. */
  keyboard: boolean;
}

export interface OpenOptions {
  keyboard?: boolean;
  action?: RewriteAction;
}

const label = (a: RewriteAction) => REWRITE_ACTIONS.find((x) => x.id === a)?.label ?? a;

/** The selection, or a message saying why it can't be improved. */
export async function captureSelection(editor: Editor): Promise<Target | string> {
  const sel = editor.state.selection;
  if (sel.empty) return "Select some text first, then press Ctrl/⌘+J or click ✨ Improve.";
  if (!(sel instanceof TextSelection)) return "Select text (not whole table cells) to improve it.";
  if (editor.isActive("codeBlock")) return "Writing help doesn't work inside code blocks.";
  const { from, to } = sel;
  const docText = editor.state.doc.textBetween(from, to, "\n", " ");
  if (!docText.trim()) return "Select some words to improve.";
  const div = document.createElement("div");
  div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.slice(from, to).content));
  const { htmlToMarkdown } = await import("../../lib/markdownExport");
  const markdown = htmlToMarkdown(div.innerHTML).trim();
  if (markdown.length > MAX_REWRITE_CHARS) return TOO_LONG;
  return { from, to, markdown, docText };
}

/** Editor HTML → a parsed body in an inert document (nothing loads or runs). */
const inertBody = (html: string) => new window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;

/** True when the note still has the same text where the selection was. */
export const targetIntact = (editor: Editor, t: Target) => t.to <= editor.state.doc.content.size && editor.state.doc.textBetween(t.from, t.to, "\n", " ") === t.docText;

/** Replaces the target with `html` like a paste: one paragraph merges into the line, and it's one undo step. */
export function replaceWithHtml(editor: Editor, t: Target, html: string): void {
  const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(inertBody(html));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, t.from, t.to)).replaceSelection(slice).scrollIntoView());
}

/** Inserts `html` as new blocks after the top-level block where the target ends. */
export function insertHtmlBelow(editor: Editor, t: Target, html: string): void {
  const content = PMDOMParser.fromSchema(editor.schema).parse(inertBody(html)).content;
  const $to = editor.state.doc.resolve(t.to);
  const at = $to.depth >= 1 ? $to.after(1) : t.to;
  editor.view.dispatch(editor.state.tr.insert(at, content).scrollIntoView());
}

export function useImprove(editor: Editor | null, pageRef: RefObject<HTMLDivElement | null>, toast: (text: string, undo?: () => void) => void) {
  const [state, setState] = useState<OpenState | null>(null);
  const openRef = useRef(false);
  openRef.current = !!state;
  const request = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (refocus = false) => {
      request.current++;
      setState(null);
      if (refocus) editor?.commands.focus();
    },
    [editor],
  );

  const run = useCallback(
    async (action: RewriteAction, target: Target) => {
      const id = ++request.current;
      setState((s) => (s ? { ...s, phase: { kind: "loading", action } } : s));
      try {
        const result = await rewriteText(action, target.markdown);
        if (id !== request.current) return;
        setState((s) => (s ? { ...s, phase: { kind: "result", action, result, plain: plainText(result.text) } } : s));
      } catch (err) {
        if (id !== request.current) return;
        const message = err instanceof RewriteError ? err.message : "Something went wrong. Try again.";
        setState((s) => (s ? { ...s, phase: { kind: "error", message, action } } : s));
      }
    },
    [],
  );

  const open = useCallback(
    async ({ keyboard = false, action }: OpenOptions = {}) => {
      if (!editor || editor.isDestroyed) return;
      const target = await captureSelection(editor);
      if (typeof target === "string") {
        toast(target);
        return;
      }
      const page = pageRef.current;
      // Under the end of the selection, lined up with where it starts.
      const start = editor.view.coordsAtPos(target.from);
      const end = editor.view.coordsAtPos(target.to);
      const rect = page?.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, rect?.width ?? PANEL_WIDTH);
      const left = rect ? Math.max(0, Math.min(Math.min(start.left, end.left) - rect.left, rect.width - width)) : 0;
      const top = rect ? end.bottom - rect.top + 10 : 0;
      editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, "hide"));
      setState({ target, phase: { kind: "menu" }, pos: { top, left, width }, keyboard });
      if (action) void run(action, target);
    },
    [editor, pageRef, toast, run],
  );

  const changedMessage = "The note changed since you asked. Select the text again.";

  const undoToast = (text: string) =>
    toast(text, () => {
      editor?.chain().focus().undo().run();
    });

  const replace = async () => {
    if (!editor || state?.phase.kind !== "result") return;
    const { target } = state;
    const html = await rewriteToHtml(state.phase.result.text);
    if (!targetIntact(editor, target)) {
      setState({ ...state, phase: { kind: "error", message: changedMessage } });
      return;
    }
    replaceWithHtml(editor, target, html);
    close(true);
    undoToast("Text replaced");
  };

  const insertBelow = async () => {
    if (!editor || state?.phase.kind !== "result") return;
    const { target } = state;
    const html = await rewriteToHtml(state.phase.result.text);
    if (!targetIntact(editor, target)) {
      setState({ ...state, phase: { kind: "error", message: changedMessage } });
      return;
    }
    insertHtmlBelow(editor, target, html);
    close(true);
    undoToast("Added below");
  };

  const copy = async () => {
    if (state?.phase.kind !== "result") return;
    try {
      await navigator.clipboard.writeText(state.phase.plain);
      toast("Copied");
    } catch {
      toast("Couldn't copy. Select the text and copy it instead.");
    }
  };

  // Close when clicking elsewhere, except while waiting or showing a suggestion (those cost an AI use).
  useEffect(() => {
    if (!state || state.phase.kind === "loading" || state.phase.kind === "result") return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [state, close]);

  // Keyboard flow: put focus on the first thing to do in each step.
  useEffect(() => {
    if (!state?.keyboard) return;
    const el = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus();
  }, [state?.keyboard, state?.phase.kind]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  };

  const panel = state ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Improve writing"
      data-testid="improve-panel"
      className="improve-panel"
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        top: state.pos.top,
        left: state.pos.left,
        width: state.pos.width,
        zIndex: 40,
        background: "hsl(var(--card))",
        color: "hsl(var(--foreground))",
        border: "var(--nb-border)",
        boxShadow: "var(--nb-shadow)",
        padding: 10,
        fontFamily: "var(--app-font-sans)",
        fontSize: 13,
      }}
    >
      <Body
        state={state}
        onPick={(a) => void run(a, state.target)}
        onReplace={() => void replace()}
        onInsert={() => void insertBelow()}
        onCopy={() => void copy()}
        onRetry={(a) => void run(a, state.target)}
        onBack={() => setState({ ...state, phase: { kind: "menu" } })}
        onClose={() => close(true)}
      />
    </div>
  ) : null;

  return { open, close, openRef, panel };
}

const btnStyle = (primary = false): React.CSSProperties => ({
  border: "var(--nb-border)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  boxShadow: "var(--nb-shadow-sm)",
  fontWeight: 800,
  fontSize: 12,
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
});

const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the editor's selection

interface BodyProps {
  state: OpenState;
  onPick: (a: RewriteAction) => void;
  onReplace: () => void;
  onInsert: () => void;
  onCopy: () => void;
  onRetry: (a: RewriteAction) => void;
  onBack: () => void;
  onClose: () => void;
}

function Body({ state, onPick, onReplace, onInsert, onCopy, onRetry, onBack, onClose }: BodyProps) {
  const { phase } = state;
  const heading = (text: string) => <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{text}</div>;

  if (phase.kind === "menu") {
    return (
      <div role="menu" aria-label="Improve writing">
        {heading("✨ Improve writing")}
        {REWRITE_ACTIONS.map((a, i) => (
          <button
            key={a.id}
            role="menuitem"
            data-autofocus={i === 0 ? "" : undefined}
            onMouseDown={keep}
            onClick={() => onPick(a.id)}
            style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: "7px 8px", border: "none", background: "transparent", color: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >
            <span aria-hidden="true" style={{ width: 18, textAlign: "center" }}>{a.icon}</span>
            {a.label}
          </button>
        ))}
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>Only the selected text is sent to ProdLi's AI. You'll see the suggestion before anything changes.</div>
      </div>
    );
  }

  if (phase.kind === "loading") {
    return (
      <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700 }}>✨ {label(phase.action)}…</span>
        <button data-autofocus="" onMouseDown={keep} onClick={onClose} style={btnStyle()}>Cancel</button>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div>
        <div role="alert" style={{ fontWeight: 700, marginBottom: 10 }}>{phase.message}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {phase.action && <button data-autofocus="" onMouseDown={keep} onClick={() => onRetry(phase.action!)} style={btnStyle(true)}>Try again</button>}
          <button data-autofocus={phase.action ? undefined : ""} onMouseDown={keep} onClick={onClose} style={btnStyle()}>Close</button>
        </div>
      </div>
    );
  }

  const { result, plain, action } = phase;
  const diff = action === "fix" && result.changed ? wordDiff(plainText(state.target.markdown), plain) : null;
  const left = result.usage ? Math.max(0, result.usage.limit - result.usage.used) : null;
  return (
    <div>
      {heading(`✨ ${label(action)}`)}
      {!result.changed ? (
        <div role="status" style={{ fontWeight: 700, marginBottom: 10 }}>{action === "fix" ? "No mistakes found. 👍" : "No changes suggested."}</div>
      ) : (
        <div
          data-testid="improve-suggestion"
          aria-live="polite"
          style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 260, overflowY: "auto", padding: 8, border: "1px solid var(--nb-section-border)", background: "hsl(var(--background))", marginBottom: 10 }}
        >
          {diff
            ? diff.map((p, i) =>
                p.kind === "same" ? (
                  <span key={i}>{p.text}</span>
                ) : p.kind === "added" ? (
                  <mark key={i} style={{ background: "#FFD700", color: "#000", padding: "0 1px" }}>{p.text}</mark>
                ) : (
                  <del key={i} style={{ color: "hsl(var(--muted-foreground))" }}>{p.text}</del>
                ),
              )
            : plain}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {result.changed && (
          <>
            <button data-autofocus="" onMouseDown={keep} onClick={onReplace} style={btnStyle(true)}>Replace</button>
            <button onMouseDown={keep} onClick={onInsert} style={btnStyle()}>Insert below</button>
            <button onMouseDown={keep} onClick={onCopy} style={btnStyle()}>Copy</button>
          </>
        )}
        <button onMouseDown={keep} onClick={onBack} style={btnStyle()} title="Pick another way to improve it">Other options</button>
        <button data-autofocus={result.changed ? undefined : ""} onMouseDown={keep} onClick={onClose} style={btnStyle()}>{result.changed ? "Discard" : "Close"}</button>
      </div>
      {left !== null && <div style={{ fontSize: 11, opacity: 0.75, marginTop: 8 }}>{left} of {result.usage!.limit} left this month</div>}
    </div>
  );
}
