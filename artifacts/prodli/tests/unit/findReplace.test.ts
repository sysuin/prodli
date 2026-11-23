import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { findInText, findMatches, findStatus, FindReplace, getFindState, indexAtOrAfter, selectionQuery } from "../../src/sections/editor/findReplace";

let editor: Editor | null = null;
const make = (content: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, FindReplace], content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});
/** The text of each match, in order. */
const found = (e: Editor, query: string, opts = {}) => findMatches(e.state.doc, query, opts).map((m) => e.state.doc.textBetween(m.from, m.to));
const selected = (e: Editor) => e.state.doc.textBetween(e.state.selection.from, e.state.selection.to);
const body = (e: Editor) => e.getHTML().replace(/(<p><\/p>)+$/, "");

describe("matching", () => {
  it("ignores case unless Match case is on", () => {
    const e = make("<p>Apple apple APPLE</p>");
    expect(found(e, "apple")).toEqual(["Apple", "apple", "APPLE"]);
    expect(found(e, "apple", { caseSensitive: true })).toEqual(["apple"]);
    expect(found(e, "APPLE", { caseSensitive: true })).toEqual(["APPLE"]);
  });

  it("whole word skips matches inside longer words", () => {
    const e = make("<p>cat concat cats cat_x (cat) Cat.</p>");
    expect(found(e, "cat")).toHaveLength(6);
    expect(found(e, "cat", { wholeWord: true })).toEqual(["cat", "cat", "Cat"]);
    expect(found(e, "cat", { wholeWord: true, caseSensitive: true })).toEqual(["cat", "cat"]);
  });

  it("whole word works with accented letters and a query that ends in punctuation", () => {
    expect(findInText("café cafés", "café", { wholeWord: true })).toEqual([{ index: 0, length: 4 }]);
    expect(findInText("v1.0 v1.0x", "v1.", { wholeWord: true })).toEqual([{ index: 0, length: 3 }, { index: 5, length: 3 }]);
  });

  it("treats regex characters literally", () => {
    const e = make("<p>a.b axb (1+1) [x] $5 ^up* a|b back\\slash</p>");
    expect(found(e, "a.b")).toEqual(["a.b"]);
    expect(found(e, "(1+1)")).toEqual(["(1+1)"]);
    expect(found(e, "[x]")).toEqual(["[x]"]);
    expect(found(e, "$5")).toEqual(["$5"]);
    expect(found(e, "^up*")).toEqual(["^up*"]);
    expect(found(e, "a|b")).toEqual(["a|b"]);
    expect(found(e, "k\\s")).toEqual(["k\\s"]);
    expect(found(e, ".*")).toEqual([]);
  });

  it("finds several matches in one block and in many blocks, in document order", () => {
    const e = make("<h1>to do</h1><p>to be or not to be</p><ul><li><p>to</p></li></ul>");
    const m = findMatches(e.state.doc, "to");
    expect(m).toHaveLength(4);
    expect(m.map((x) => x.from)).toEqual([...m.map((x) => x.from)].sort((a, b) => a - b));
    expect(found(e, "be")).toEqual(["be", "be"]);
    expect(found(e, "")).toEqual([]);
  });

  it("matches across bold and link marks, but not across blocks", () => {
    const e = make('<p>hello <strong>wor</strong>ld and <a href="https://x.y">big</a> news</p><p>end</p><p>start</p>');
    expect(found(e, "world")).toEqual(["world"]);
    expect(found(e, "big news")).toEqual(["big news"]);
    expect(found(e, "endstart")).toEqual([]);
    expect(found(e, "end start")).toEqual([]);
  });

  it("doesn't match across a line break or other non-text inline node", () => {
    const e = make("<p>foo<br>bar</p>");
    expect(found(e, "foobar")).toEqual([]);
    expect(found(e, "foo")).toEqual(["foo"]);
    expect(found(e, "bar", { wholeWord: true })).toEqual(["bar"]);
  });

  it("wraps to the first match after the last one", () => {
    const ms = [{ from: 2, to: 4 }, { from: 10, to: 12 }];
    expect(indexAtOrAfter(ms, 0)).toBe(0);
    expect(indexAtOrAfter(ms, 5)).toBe(1);
    expect(indexAtOrAfter(ms, 11)).toBe(0);
    expect(indexAtOrAfter([], 3)).toBe(0);
  });
});

describe("find and replace in the editor", () => {
  it("counts matches, selects them with next / previous and wraps around", () => {
    const e = make("<p>one two one</p><p>one</p>");
    e.commands.setTextSelection(1);
    e.commands.setFind({ query: "one" });
    expect(findStatus(e)).toEqual({ count: 3, current: 1, query: "one" });
    expect(selected(e)).toBe("one");
    e.commands.findNext();
    expect(findStatus(e).current).toBe(2);
    e.commands.findNext();
    expect(findStatus(e).current).toBe(3);
    e.commands.findNext();
    expect(findStatus(e).current).toBe(1);
    e.commands.findPrevious();
    expect(findStatus(e).current).toBe(3);
    expect(e.state.selection.from).toBe(getFindState(e.state)!.matches[2].from);
  });

  it("draws every match, with the current one marked", () => {
    const e = make("<p>ab ab ab</p>");
    e.commands.setFind({ query: "ab" });
    const decos = getFindState(e.state)!.decorations.find();
    expect(decos).toHaveLength(3);
    expect(decos.filter((d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class.includes("find-match-current"))).toHaveLength(1);
  });

  it("updates the matches when the note changes", () => {
    const e = make("<p>red</p>");
    e.commands.setFind({ query: "red" });
    expect(findStatus(e).count).toBe(1);
    e.commands.insertContentAt(e.state.doc.content.size - 1, " red");
    expect(findStatus(e).count).toBe(2);
  });

  it("replaces the current match keeping its formatting, then moves to the next", () => {
    const e = make("<p>a <strong>cat</strong> and a cat</p>");
    e.commands.setTextSelection(1);
    e.commands.setFind({ query: "cat" });
    e.commands.replaceMatch("dog");
    expect(body(e)).toBe("<p>a <strong>dog</strong> and a cat</p>");
    expect(findStatus(e)).toMatchObject({ count: 1, current: 1 });
    expect(selected(e)).toBe("cat");
  });

  it("replacing with text that contains the query doesn't loop", () => {
    const e = make("<p>a a</p>");
    e.commands.setTextSelection(1);
    e.commands.setFind({ query: "a" });
    e.commands.replaceMatch("aa");
    e.commands.replaceMatch("aa");
    expect(body(e)).toBe("<p>aa aa</p>");
  });

  it("replace all is one undo step and keeps links", () => {
    const e = make('<p>Q1 plan</p><p>see <a href="https://x.y">Q1</a> and Q1.</p>');
    e.commands.setFind({ query: "q1" });
    expect(findStatus(e).count).toBe(3);
    e.commands.replaceAllMatches("Q2");
    expect(e.getHTML()).not.toContain("Q1");
    expect(e.getHTML()).toMatch(/<a [^>]*href="https:\/\/x\.y"[^>]*>Q2<\/a>/);
    expect(findStatus(e).count).toBe(0);
    e.commands.undo();
    expect(e.getHTML()).not.toContain("Q2");
    expect(findStatus(e).count).toBe(3);
  });

  it("replace with nothing deletes the matches", () => {
    const e = make("<p>very very good</p>");
    e.commands.setFind({ query: "very ", wholeWord: true });
    e.commands.replaceAllMatches("");
    expect(body(e)).toBe("<p>good</p>");
  });

  it("keeps searching after the editor loads a fresh state (another note), and clears", () => {
    const e = make("<p>x</p>");
    e.commands.setFind({ query: "note" });
    e.commands.setContent("<p>note one, note two</p>");
    expect(findStatus(e).count).toBe(2);
    e.commands.clearFind();
    expect(findStatus(e)).toEqual({ count: 0, current: 0, query: "" });
    expect(getFindState(e.state)!.decorations.find()).toHaveLength(0);
  });

  it("starts from the selected text if it is a short piece of one block", () => {
    const e = make("<p>alpha beta</p><p>gamma</p>");
    e.commands.setTextSelection({ from: 7, to: 11 });
    expect(selectionQuery(e.state)).toBe("beta");
    e.commands.setTextSelection({ from: 3, to: 15 });
    expect(selectionQuery(e.state)).toBe("");
    e.commands.setTextSelection(3);
    expect(selectionQuery(e.state)).toBe("");
  });

  it("stays fast on a long note", () => {
    const html = Array.from({ length: 2000 }, (_, i) => `<p>Paragraph ${i} with some <strong>words</strong> to search through.</p>`).join("");
    const e = make(html);
    const t0 = performance.now();
    e.commands.setFind({ query: "words" });
    e.commands.findNext();
    e.commands.insertContentAt(3, "x");
    const ms = performance.now() - t0;
    expect(findStatus(e).count).toBe(2000);
    expect(ms).toBeLessThan(1500);
  });
});
