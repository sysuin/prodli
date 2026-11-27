import { describe, expect, it } from "vitest";
import { applyAll, dismissKey, filterIssues, hash, locate, looksEnglish, paragraphKey, placeIssues, shiftIssues, splitParagraphs } from "../../src/writing/text";
import * as pageCopy from "../../src/writing/constants";
import * as extCopy from "../../src/writing/settings";
import type { CheckIssue } from "../../src/writing/types";

const issue = (start: number, end: number, original: string, replacement: string, type: CheckIssue["type"] = "spelling"): CheckIssue => ({ start, end, original, replacement, type, explanation: "" });

describe("writing check text helpers", () => {
  it("splits the field into paragraphs with their positions, skipping blank and tiny lines", () => {
    expect(splitParagraphs("Hello there.\n\nok\nSecond line here")).toEqual([
      { text: "Hello there.", start: 0 },
      { text: "Second line here", start: 17 },
    ]);
    const long = "word ".repeat(600);
    const parts = splitParagraphs(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.text.length <= 2000)).toBe(true);
    expect(parts.map((p) => p.text).join("")).toBe(long);
    expect(parts[1].start).toBe(parts[0].text.length);
  });

  it("keys paragraphs by text and settings", () => {
    expect(paragraphKey("a b", "polish")).toBe(paragraphKey("a b", "polish"));
    expect(paragraphKey("a b", "polish")).not.toBe(paragraphKey("a b", "correct"));
    expect(paragraphKey("a b", "polish", "en-GB")).not.toBe(paragraphKey("a b", "polish"));
    expect(hash("x")).not.toBe(hash("y"));
  });

  it("sends only Latin-script text to the on-device model", () => {
    expect(looksEnglish("This is fine, isn't it?")).toBe(true);
    expect(looksEnglish("यह ठीक है")).toBe(false);
    expect(looksEnglish("Kal milte hain bhai")).toBe(true);
    expect(looksEnglish("ok")).toBe(false);
  });

  it("places the on-device model's suggestions and drops what doesn't fit", () => {
    const text = "Its its fine, its done.";
    expect(locate(text, "its", "fine,", [])).toBe(14);
    const placed = placeIssues(text, [
      { original: "Its", before: "", replacement: "It's", type: "grammar", explanation: "Contraction" },
      { original: "its", before: "fine,", replacement: "it's", type: "grammar" },
      { original: "nope", replacement: "x" },
      { original: "done", replacement: "done" },
      { original: "Its its", replacement: "It's" },
      { original: "fine", replacement: "good", type: "weird" },
    ]);
    expect(placed.map((p) => [p.start, p.original, p.replacement, p.type])).toEqual([
      [0, "Its", "It's", "grammar"],
      [8, "fine", "good", "grammar"],
      [14, "its", "it's", "grammar"],
    ]);
  });

  it("leaves out dictionary words and dismissed suggestions", () => {
    const list = [issue(0, 5, "Sunny", "Sonny"), issue(6, 9, "teh", "the"), issue(10, 14, "good", "great", "word_choice")];
    expect(filterIssues(list, ["sunny"], new Set([dismissKey(list[2])])).map((i) => i.original)).toEqual(["teh"]);
    // The dictionary only silences spelling.
    expect(filterIssues([issue(0, 4, "Kind", "Kindly", "tone")], ["kind"], new Set())).toHaveLength(1);
  });

  it("keeps suggestions in place after an edit, and applies them all", () => {
    const text = "I seen teh dog alot.";
    const list = [issue(2, 6, "seen", "saw", "grammar"), issue(7, 10, "teh", "the"), issue(15, 19, "alot", "a lot")];
    const after = shiftIssues(list, 2, 6, -1);
    expect(after.map((i) => [i.start, i.original])).toEqual([
      [6, "teh"],
      [14, "alot"],
    ]);
    expect(applyAll(text, list)).toBe("I saw the dog a lot.");
    // A suggestion whose text changed underneath is skipped.
    expect(applyAll("I seen THE dog.", [issue(7, 10, "teh", "the")])).toBe("I seen THE dog.");
  });

  it("keeps the in-page checker's constants the same as the extension's", () => {
    expect(pageCopy.DEFAULT_WRITING_SETTINGS).toEqual(extCopy.DEFAULT_WRITING_SETTINGS);
    expect(pageCopy.WRITING_SETTINGS_KEY).toBe(extCopy.WRITING_SETTINGS_KEY);
    expect(pageCopy.ISSUE_GROUP).toEqual(extCopy.ISSUE_GROUP);
    expect(pageCopy.ISSUE_LABEL).toEqual(extCopy.ISSUE_LABEL);
    expect(pageCopy.REWRITE_LABEL).toEqual(extCopy.REWRITE_LABEL);
    expect(pageCopy.MAX_DICTIONARY).toBe(extCopy.MAX_DICTIONARY);
  });
});
