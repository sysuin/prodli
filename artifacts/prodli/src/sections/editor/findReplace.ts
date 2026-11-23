// Find & replace inside the open note (the find bar is FindBar.tsx).
//
// A ProseMirror plugin keeps the query and options in its state, finds the
// matches whenever the query or the note changes, and draws them as
// decorations (all matches, and the current one stronger). Text is searched
// per textblock, across marks (bold, links…) but never across blocks.
// Replace all is one transaction, so one undo puts everything back.

import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode, Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}
export interface FindRange {
  from: number;
  to: number;
}
export interface FindState extends FindOptions {
  query: string;
  matches: FindRange[];
  /** Index of the current match in `matches` (0 when there are none). */
  current: number;
  decorations: DecorationSet;
}
type FindMeta = Partial<FindOptions> & {
  query?: string;
  /** Make this match the current one. */
  current?: number;
  /** Make the first match at or after this position the current one. */
  near?: number;
  /** Already found for this search (no document change): don't search again. */
  matches?: FindRange[];
};

/** More than this and only the first ones are counted and drawn (keeps huge notes fast). */
export const MAX_MATCHES = 5000;
/** Stands in for inline nodes that aren't text (note links, pictures, line breaks): never matches, breaks words. */
const OBJECT = "\uFFFC";
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `query` occurs in `text` (plain string search; regex characters are literal). */
export function findInText(text: string, query: string, opts: Partial<FindOptions> = {}): { index: number; length: number }[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), opts.caseSensitive ? "gu" : "giu");
  const out: { index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (opts.wholeWord) {
      // A word boundary is needed only where the query itself starts/ends with a word character.
      const needBefore = WORD_CHAR.test(m[0][0] ?? "") && start > 0 && WORD_CHAR.test(text[start - 1]);
      const needAfter = WORD_CHAR.test(m[0][m[0].length - 1] ?? "") && end < text.length && WORD_CHAR.test(text[end]);
      if (needBefore || needAfter) {
        re.lastIndex = start + 1;
        continue;
      }
    }
    out.push({ index: start, length: m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** All matches in the document, in order. Each match stays inside one textblock. */
export function findMatches(doc: PMNode, query: string, opts: Partial<FindOptions> = {}): FindRange[] {
  const out: FindRange[] = [];
  if (!query || query.includes(OBJECT)) return out;
  doc.descendants((node, pos) => {
    if (out.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    let text = "";
    // Each inline child adds exactly nodeSize characters, so string index i is document position pos + 1 + i.
    node.forEach((child) => {
      text += child.isText ? child.text! : OBJECT.repeat(child.nodeSize);
    });
    for (const m of findInText(text, query, opts)) {
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m.length });
      if (out.length >= MAX_MATCHES) break;
    }
    return false;
  });
  return out;
}

/** Index of the first match starting at or after `pos`, or matches.length if there is none. */
function lowerBound(matches: FindRange[], pos: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].from < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first match starting at or after `pos` (wrapping to 0). */
export function indexAtOrAfter(matches: FindRange[], pos: number): number {
  const i = lowerBound(matches, pos);
  return i < matches.length ? i : 0;
}

function buildDecorations(doc: PMNode, matches: FindRange[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "find-match find-match-current" : "find-match" })),
  );
}

export const findReplaceKey = new PluginKey<FindState>("findReplace");

export const getFindState = (state: EditorState): FindState | undefined => findReplaceKey.getState(state);

/** The marks to give replacement text: those of the first character it replaces. */
function marksAt(doc: PMNode, pos: number): readonly Mark[] {
  const $pos = doc.resolve(pos);
  return $pos.parent.childAfter($pos.parentOffset).node?.marks ?? [];
}

function replaceRange(tr: Transaction, from: number, to: number, text: string) {
  if (!text) tr.delete(from, to);
  else tr.replaceWith(from, to, tr.doc.type.schema.text(text, marksAt(tr.doc, from)));
}

/** Select a match and scroll to it (the editor keeps its focus state). */
function selectMatch(tr: Transaction, m: FindRange | undefined) {
  if (!m) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      /** Change the search (any of query / options); selects the nearest match. */
      setFind: (opts: Partial<FindOptions> & { query?: string }) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      /** Replace the current match and move on to the next one. */
      replaceMatch: (replacement: string) => ReturnType;
      /** Replace every match (one undo step). */
      replaceAllMatches: (replacement: string) => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

interface FindStorage extends FindOptions {
  query: string;
}

export const FindReplace = Extension.create<Record<string, never>, FindStorage>({
  name: "findReplace",

  addStorage() {
    return { query: "", caseSensitive: false, wholeWord: false };
  },

  addCommands() {
    const storage = () => this.storage;
    return {
      setFind:
        (opts) =>
        ({ tr, state, dispatch }) => {
          const s = storage();
          if (opts.query !== undefined) s.query = opts.query;
          if (opts.caseSensitive !== undefined) s.caseSensitive = opts.caseSensitive;
          if (opts.wholeWord !== undefined) s.wholeWord = opts.wholeWord;
          if (!dispatch) return true;
          const matches = findMatches(state.doc, s.query, s);
          const current = indexAtOrAfter(matches, state.selection.from);
          tr.setMeta(findReplaceKey, { query: s.query, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, current, matches } satisfies FindMeta);
          selectMatch(tr, matches[current]);
          return true;
        },
      findNext:
        () =>
        ({ tr, state, dispatch }) => {
          const f = getFindState(state);
          if (!f?.matches.length) return false;
          const { from, to } = state.selection;
          const cur = f.matches[f.current];
          // Moved the cursor since? Continue from there, like a browser does.
          const onCurrent = cur && cur.from === from && cur.to === to;
          const next = onCurrent ? (f.current + 1) % f.matches.length : indexAtOrAfter(f.matches, from === to ? from : from + 1);
          if (dispatch) selectMatch(tr.setMeta(findReplaceKey, { current: next } satisfies FindMeta), f.matches[next]);
          return true;
        },
      findPrevious:
        () =>
        ({ tr, state, dispatch }) => {
          const f = getFindState(state);
          if (!f?.matches.length) return false;
          const { from, to } = state.selection;
          const cur = f.matches[f.current];
          const n = f.matches.length;
          let prev: number;
          if (cur && cur.from === from && cur.to === to) prev = (f.current - 1 + n) % n;
          else {
            prev = lowerBound(f.matches, from) - 1;
            if (prev < 0) prev = n - 1;
          }
          if (dispatch) selectMatch(tr.setMeta(findReplaceKey, { current: prev } satisfies FindMeta), f.matches[prev]);
          return true;
        },
      replaceMatch:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const f = getFindState(state);
          const m = f?.matches[f.current];
          if (!f || !m) return false;
          if (!dispatch) return true;
          replaceRange(tr, m.from, m.to, replacement);
          const after = m.from + replacement.length;
          // Find the next match after the new text (so replacing "a" with "aa" doesn't loop).
          const matches = findMatches(tr.doc, f.query, f);
          const next = indexAtOrAfter(matches, after);
          tr.setMeta(findReplaceKey, { near: after } satisfies FindMeta);
          if (matches[next]) selectMatch(tr, matches[next]);
          else tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView();
          return true;
        },
      replaceAllMatches:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const f = getFindState(state);
          if (!f?.matches.length) return false;
          if (!dispatch) return true;
          // Back to front, so earlier positions stay valid.
          for (let i = f.matches.length - 1; i >= 0; i--) replaceRange(tr, f.matches[i].from, f.matches[i].to, replacement);
          const firstEnd = tr.mapping.map(f.matches[0].from, -1) + replacement.length;
          tr.setSelection(TextSelection.create(tr.doc, Math.min(firstEnd, tr.doc.content.size))).scrollIntoView();
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          const s = storage();
          s.query = "";
          if (dispatch) tr.setMeta(findReplaceKey, { query: "" } satisfies FindMeta);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<FindState>({
        key: findReplaceKey,
        state: {
          // Also runs when the Editor loads another note (a fresh EditorState): keep searching.
          init: (_config, state) => {
            const matches = findMatches(state.doc, storage.query, storage);
            return { query: storage.query, caseSensitive: storage.caseSensitive, wholeWord: storage.wholeWord, matches, current: 0, decorations: buildDecorations(state.doc, matches, 0) };
          },
          apply: (tr, prev, _old, newState) => {
            const meta = tr.getMeta(findReplaceKey) as FindMeta | undefined;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            const wholeWord = meta?.wholeWord ?? prev.wholeWord;
            const searchChanged = query !== prev.query || caseSensitive !== prev.caseSensitive || wholeWord !== prev.wholeWord;
            if (!tr.docChanged && !searchChanged && meta?.current === undefined && meta?.near === undefined) return prev;
            const matches = tr.docChanged ? findMatches(newState.doc, query, { caseSensitive, wholeWord }) : searchChanged ? (meta?.matches ?? findMatches(newState.doc, query, { caseSensitive, wholeWord })) : prev.matches;
            let current: number;
            if (meta?.current !== undefined) current = meta.current;
            else if (meta?.near !== undefined) current = indexAtOrAfter(matches, meta.near);
            else if (searchChanged) current = indexAtOrAfter(matches, newState.selection.from);
            else {
              const old = prev.matches[prev.current];
              current = old ? indexAtOrAfter(matches, tr.mapping.map(old.from, -1)) : 0;
            }
            current = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : 0;
            return { query, caseSensitive, wholeWord, matches, current, decorations: buildDecorations(newState.doc, matches, current) };
          },
        },
        props: {
          decorations: (state) => findReplaceKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

/** Count of matches, and the current one (1-based), for the find bar. */
export function findStatus(editor: Editor | null): { count: number; current: number; query: string } {
  const f = editor && !editor.isDestroyed ? getFindState(editor.state) : undefined;
  if (!f) return { count: 0, current: 0, query: "" };
  return { count: f.matches.length, current: f.matches.length ? f.current + 1 : 0, query: f.query };
}

/** Text to start searching for: the selection, if it's a short piece of one block. */
export function selectionQuery(state: EditorState): string {
  const { from, to, empty, $from, $to } = state.selection;
  if (empty || !$from.sameParent($to) || to - from > 200) return "";
  const text = state.doc.textBetween(from, to, " ", " ");
  return text.trim() ? text : "";
}
