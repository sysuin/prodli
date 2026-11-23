// The find bar under the Editor's toolbar: find (Ctrl/⌘+F) and replace
// (Ctrl/⌘+Shift+F) inside the open note. Matching lives in findReplace.ts.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { findStatus } from "./findReplace";

/** Typing in the search field waits this long before searching (long notes stay smooth). */
const SEARCH_DEBOUNCE_MS = 120;

export interface FindBarHandle {
  /** Focus the search field (selecting its text), optionally with new text and Replace shown. */
  focus: (opts: { query?: string; replace?: boolean }) => void;
}

interface Props {
  editor: Editor;
  onClose: () => void;
  initialQuery: string;
  initialReplace: boolean;
}

const btn: React.CSSProperties = {
  border: "var(--nb-border)",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  minWidth: 28,
  height: 28,
  padding: "0 7px",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const field: React.CSSProperties = {
  border: "var(--nb-border)",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  height: 28,
  padding: "0 8px",
  fontSize: 13,
  fontFamily: "inherit",
  minWidth: 0,
  flex: "1 1 160px",
  maxWidth: 320,
};
const pressed = (on: boolean): React.CSSProperties => (on ? { background: "#FFD700", color: "#000" } : {});

export const FindBar = forwardRef<FindBarHandle, Props>(function FindBar({ editor, onClose, initialQuery, initialReplace }, ref) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(initialReplace);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingQuery = useRef<string | null>(null);

  const status = useEditorState({ editor, selector: ({ editor: ed }) => findStatus(ed) });

  const apply = useCallback(
    (q: string) => {
      clearTimeout(timer.current);
      pendingQuery.current = null;
      editor.commands.setFind({ query: q });
    },
    [editor],
  );
  /** Search now if typing is still waiting. Returns true if it searched. */
  const flush = () => {
    if (pendingQuery.current === null) return false;
    apply(pendingQuery.current);
    return true;
  };

  // First search when the bar opens; clear the highlights when it closes.
  useEffect(() => {
    editor.commands.setFind({ query: initialQuery, caseSensitive: false, wholeWord: false });
    searchRef.current?.focus();
    searchRef.current?.select();
    return () => {
      clearTimeout(timer.current);
      if (!editor.isDestroyed) editor.commands.clearFind();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useImperativeHandle(ref, () => ({
    focus: ({ query: q, replace }) => {
      if (replace) setShowReplace(true);
      if (q) {
        setQuery(q);
        apply(q);
      }
      setTimeout(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      }, 0);
    },
  }));

  const onQueryChange = (q: string) => {
    setQuery(q);
    pendingQuery.current = q;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(q), SEARCH_DEBOUNCE_MS);
  };

  const next = () => {
    if (!flush()) editor.commands.findNext();
  };
  const prev = () => {
    flush();
    editor.commands.findPrevious();
  };
  const replaceOne = () => {
    flush();
    editor.commands.replaceMatch(replacement);
  };
  const replaceAll = () => {
    flush();
    editor.commands.replaceAllMatches(replacement);
  };
  const toggleCase = () => {
    flush();
    setCaseSensitive(!caseSensitive);
    editor.commands.setFind({ caseSensitive: !caseSensitive });
  };
  const toggleWord = () => {
    flush();
    setWholeWord(!wholeWord);
    editor.commands.setFind({ wholeWord: !wholeWord });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, which: "find" | "replace") => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (which === "replace") {
        if (e.metaKey || e.ctrlKey) replaceAll();
        else replaceOne();
      } else if (e.shiftKey) prev();
      else next();
      return;
    }
    // Ctrl/⌘+F / Ctrl/⌘+Shift+F inside the bar: select the search text (and show Replace).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) setShowReplace(true);
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  const keep = (e: React.MouseEvent) => e.preventDefault(); // buttons don't take focus from the field
  const noMatches = !!status.query && status.count === 0;
  const countText = !status.query ? "" : status.count === 0 ? "No results" : `${status.current} of ${status.count}${status.count >= 5000 ? "+" : ""}`;

  return (
    <div
      role="search"
      aria-label="Find in note"
      data-testid="find-bar"
      className="editor-find-bar"
      style={{ borderBottom: "var(--nb-border)", padding: "5px 16px", display: "flex", flexDirection: "column", gap: 5, background: "hsl(var(--background))" }}
    >
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...btn, minWidth: 24, padding: 0, border: "none", background: "transparent" }}
          onMouseDown={keep}
          onClick={() => setShowReplace((v) => !v)}
          aria-expanded={showReplace}
          aria-controls="find-replace-row"
          title={showReplace ? "Hide replace" : "Show replace (Ctrl/⌘+Shift+F)"}
          aria-label={showReplace ? "Hide replace" : "Show replace"}
        >
          <span aria-hidden="true">{showReplace ? "▾" : "▸"}</span>
        </button>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => onKeyDown(e, "find")}
          placeholder="Find in note"
          aria-label="Find in note"
          aria-invalid={noMatches || undefined}
          data-testid="find-input"
          spellCheck={false}
          autoComplete="off"
          style={{ ...field, ...(noMatches ? { borderColor: "#E53935" } : {}) }}
        />
        <span role="status" aria-live="polite" data-testid="find-count" style={{ fontSize: 12, fontWeight: 700, minWidth: 74, textAlign: "center", color: noMatches ? "#E53935" : "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
          {countText}
        </span>
        <button type="button" style={btn} onMouseDown={keep} onClick={prev} disabled={!status.count} title="Previous match (Shift+Enter)" aria-label="Previous match">
          <span aria-hidden="true">↑</span>
        </button>
        <button type="button" style={btn} onMouseDown={keep} onClick={next} disabled={!status.count} title="Next match (Enter)" aria-label="Next match">
          <span aria-hidden="true">↓</span>
        </button>
        <button type="button" style={{ ...btn, ...pressed(caseSensitive) }} onMouseDown={keep} onClick={toggleCase} aria-pressed={caseSensitive} title="Match case" aria-label="Match case">
          <span aria-hidden="true">Aa</span>
        </button>
        <button type="button" style={{ ...btn, ...pressed(wholeWord) }} onMouseDown={keep} onClick={toggleWord} aria-pressed={wholeWord} title="Whole words only">
          Whole word
        </button>
        <button type="button" style={{ ...btn, marginLeft: "auto", border: "none", background: "transparent", fontSize: 15 }} onMouseDown={keep} onClick={onClose} title="Close (Esc)" aria-label="Close find">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {showReplace && (
        <div id="find-replace-row" style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", paddingLeft: 28 }}>
          <input
            ref={replaceRef}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, "replace")}
            placeholder="Replace with"
            aria-label="Replace with"
            data-testid="replace-input"
            spellCheck={false}
            autoComplete="off"
            style={field}
          />
          <button type="button" style={btn} onMouseDown={keep} onClick={replaceOne} disabled={!status.count} title="Replace this match (Enter in the Replace field)">
            Replace
          </button>
          <button type="button" style={btn} onMouseDown={keep} onClick={replaceAll} disabled={!status.count} title="Replace every match (Ctrl/⌘+Enter) — one undo puts them back">
            Replace all
          </button>
        </div>
      )}
    </div>
  );
});
