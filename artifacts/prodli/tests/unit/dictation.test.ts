import { describe, expect, it } from "vitest";
import { addDay, cleanLocally, cleanupLevel, countWords, dayKey, dictationStats, expandSnippets, fieldKind, siteCategory, streakDays, wholeSnippet, type DictationEntry, type Snippet } from "../../src/dictation/core";
import { correctedWords } from "../../src/dictation/corrections";

describe("siteCategory", () => {
  it("knows email, work and personal sites (subdomains too)", () => {
    expect(siteCategory("mail.google.com")).toBe("email");
    expect(siteCategory("outlook.office.com")).toBe("email");
    expect(siteCategory("acme.slack.com")).toBe("work");
    expect(siteCategory("www.notion.so")).toBe("work");
    expect(siteCategory("web.whatsapp.com")).toBe("personal");
    expect(siteCategory("x.com")).toBe("personal");
    expect(siteCategory("docs.example.com")).toBe("other");
    expect(siteCategory("notslack.com")).toBe("other");
  });
});

describe("fieldKind", () => {
  const f = (over: Partial<{ tag: string; type: string; role: string | null; multiline: boolean; codeLike: boolean }> = {}) => ({ tag: "textarea", multiline: true, role: null, codeLike: false, ...over });
  it("picks email, chat, document, search and code", () => {
    expect(fieldKind("mail.google.com", f({ tag: "div" }))).toBe("email");
    expect(fieldKind("mail.google.com", f({ tag: "input", multiline: false }))).toBe("other");
    expect(fieldKind("app.slack.com", f({ tag: "div" }))).toBe("chat");
    expect(fieldKind("example.com", f())).toBe("document");
    expect(fieldKind("example.com", f({ tag: "input", type: "search", multiline: false }))).toBe("search");
    expect(fieldKind("github.com", f({ codeLike: true }))).toBe("code");
  });
});

describe("cleanLocally", () => {
  it("drops filler words and stutters, tidies spaces, capitalizes", () => {
    expect(cleanLocally("um so the the meeting is uh , at three")).toBe("So the meeting is, at three");
    expect(cleanLocally("  hmm  ")).toBe("");
    expect(cleanLocally("umbrella sales are up")).toBe("Umbrella sales are up");
  });
});

describe("snippets", () => {
  const snippets: Snippet[] = [
    { id: "1", cue: "my email", text: "me@example.com" },
    { id: "2", cue: "my work email", text: "me@work.example" },
    { id: "3", cue: "calendar link", text: "https://cal.example/me" },
  ];
  it("replaces a dictation that is only a cue", () => {
    expect(wholeSnippet("My calendar link.", [{ id: "x", cue: "my calendar link", text: "L" }])?.text).toBe("L");
    expect(wholeSnippet("send my calendar link", snippets)).toBeNull();
  });
  it("replaces cues inside a sentence, longest first, as whole words", () => {
    const r = expandSnippets("Write to my work email or my email. Here's my calendar link!", snippets);
    expect(r.text).toBe("Write to me@work.example or me@example.com. Here's my https://cal.example/me!");
    expect(r.used.sort()).toEqual(["1", "2", "3"]);
    expect(expandSnippets("my emails are full", snippets).text).toBe("my emails are full");
  });
});

describe("stats", () => {
  it("counts words this week and all time, speaking speed and time saved", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const e = (at: string, words: number, ms: number, mode: "dictate" | "command" = "dictate"): DictationEntry => ({ at, words, ms, mode, text: "", site: "", polished: true });
    const s = dictationStats([e("2026-11-21T10:00:00Z", 120, 60_000), e("2026-11-10T10:00:00Z", 80, 30_000), e("2026-11-21T11:00:00Z", 5, 4000, "command")], now);
    expect(s).toEqual({ weekWords: 125, totalWords: 205, count: 3, wpm: 133, savedMin: 4 });
    expect(countWords("  a b\nc ")).toBe(3);
  });
});

describe("clean-up level", () => {
  it("follows the setting, and reads older settings from the AI polish switch", () => {
    expect(cleanupLevel({ polish: true, cleanup: "concise" })).toBe("concise");
    expect(cleanupLevel({ polish: true })).toBe("light");
    expect(cleanupLevel({ polish: false })).toBe("none");
    expect(cleanupLevel({ polish: false, cleanup: "light" })).toBe("light");
  });
});

describe("streak", () => {
  const now = new Date(2026, 10, 27, 15);
  const ago = (n: number) => dayKey(new Date(2026, 10, 27 - n, 12));
  it("counts days in a row ending today, or yesterday before you've dictated today", () => {
    expect(streakDays([], now)).toBe(0);
    expect(streakDays([ago(0), ago(1), ago(2), ago(4)], now)).toBe(3);
    expect(streakDays([ago(1), ago(2)], now)).toBe(2);
    expect(streakDays([ago(2), ago(3)], now)).toBe(0);
  });
  it("adds today once and keeps the list short", () => {
    expect(addDay([ago(1)], now)).toEqual([ago(0), ago(1)]);
    expect(addDay([ago(0), ago(1)], now)).toEqual([ago(0), ago(1)]);
    expect(addDay(Array.from({ length: 500 }, (_, i) => ago(i + 1)), now)).toHaveLength(400);
  });
});

describe("learning corrected words", () => {
  const typed = "Hi team, send it to Prodly by Friday. Thanks";
  const start = "Hi team, ".length;
  const end = typed.indexOf(" Thanks");
  it("finds a misheard word fixed inside the dictation", () => {
    expect(correctedWords(typed, typed.replace("Prodly", "ProdLi"), start, end)).toEqual(["ProdLi"]);
    expect(correctedWords(typed, typed.replace("Prodly", "prodly"), start, end)).toEqual([]);
    expect(correctedWords("Meet Jon at noon.", "Meet John at noon.", 0, 17)).toEqual(["John"]);
  });
  it("ignores rewrites, new text and edits outside the dictation", () => {
    expect(correctedWords(typed, typed, start, end)).toEqual([]);
    expect(correctedWords(typed, typed.replace("Prodly", "the whole design team"), start, end)).toEqual([]);
    expect(correctedWords(typed, typed.replace("Prodly", "Marketing"), start, end)).toEqual([]);
    expect(correctedWords(typed, typed.replace("Hi team", "Hi teem"), start, end)).toEqual([]);
    expect(correctedWords(typed, `${typed} and more`, start, end)).toEqual([]);
  });
});
