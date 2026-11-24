import { describe, expect, it } from "vitest";
import { matchHabits, parsePrefix, prefixHelp } from "../../src/lib/palettePrefix";
import { fillSnippet, matchSnippets } from "../../src/lib/snippets";
import type { Habit } from "../../src/types";

describe("palette prefixes", () => {
  it("reads one letter and a space, or ?", () => {
    expect(parsePrefix("t Pay rent friday")).toEqual({ kind: "todo", rest: "Pay rent friday" });
    expect(parsePrefix("N  Meeting ideas ")).toEqual({ kind: "note", rest: "Meeting ideas" });
    expect(parsePrefix("h read")).toEqual({ kind: "habit", rest: "read" });
    expect(parsePrefix("?what's due")).toEqual({ kind: "ask", rest: "what's due" });
    expect(parsePrefix("? ")).toEqual({ kind: "ask", rest: "" });
    expect(parsePrefix("s addr")).toEqual({ kind: "snippet", rest: "addr" });
    expect(parsePrefix("t ")).toEqual({ kind: "todo", rest: "" });
  });
  it("plain words are never prefixes", () => {
    for (const t of ["today", "pay rent", "help", "settings", "t", "p", "notes", "t-shirt", "", "  "]) expect(parsePrefix(t)).toBeNull();
  });
  it("Pomodoro minutes and an optional label", () => {
    expect(parsePrefix("p 25")).toEqual({ kind: "pomodoro", rest: "", minutes: 25 });
    expect(parsePrefix("p 50 min Write report")).toEqual({ kind: "pomodoro", rest: "Write report", minutes: 50 });
    expect(parsePrefix("p ")).toEqual({ kind: "pomodoro", rest: "" });
    expect(parsePrefix("p Deep work")).toEqual({ kind: "pomodoro", rest: "Deep work" });
    expect(parsePrefix("p 0")).toEqual({ kind: "pomodoro", rest: "0" });
    expect(parsePrefix("p 999")).toEqual({ kind: "pomodoro", rest: "999" });
  });
  it("help line", () => {
    expect(prefixHelp()).toBe("t to-do · n note · h habit · p 25 Pomodoro · ? ask · s snippet");
    expect(prefixHelp(["todo", "ask"])).toBe("t to-do · ? ask");
  });
});

describe("palette habits", () => {
  const h = (id: string, name: string, extra: Partial<Habit> = {}): Habit => ({ id, name, emoji: "•", color: "#000", completedDays: [], createdAt: "2026-11-01T08:00:00.000Z", archived: false, ...extra });
  const list = [h("a", "Morning run"), h("b", "Read 20 pages"), h("c", "No sugar", { kind: "quit" }), h("d", "Reading log", { archived: true }), h("e", "Gym", { days: [1] })];
  it("today's habits that match, best first; no quit, archived or not-due habits", () => {
    expect(matchHabits(list, "read", "2026-11-18").map((x) => x.id)).toEqual(["b"]);
    expect(matchHabits(list, "run", "2026-11-18").map((x) => x.id)).toEqual(["a"]);
    expect(matchHabits(list, "", "2026-11-18").map((x) => x.id)).toEqual(["a", "b"]);
    expect(matchHabits(list, "gym", "2026-11-16").map((x) => x.id)).toEqual(["e"]); // a Monday
  });
});

describe("snippets", () => {
  const sn = [
    { id: "1", cue: "my address", text: "12 Park Road, Pune" },
    { id: "2", cue: "calendar link", text: "https://cal.com/me/30" },
    { id: "3", cue: "thanks reply", text: "Thanks for the address update!" },
    { id: "4", cue: "", text: "broken" },
  ];
  it("matches cue first, then text; skips empty cues", () => {
    expect(matchSnippets(sn, "").map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(matchSnippets(sn, "addr").map((s) => s.id)).toEqual(["1", "3"]);
    expect(matchSnippets(sn, "cal").map((s) => s.id)).toEqual(["2"]);
    expect(matchSnippets(sn, "pune").map((s) => s.id)).toEqual(["1"]);
  });
  it("fills {date}, {isodate}, {time}, {day}; leaves others", () => {
    const now = new Date(2026, 10, 24, 15, 5);
    expect(fillSnippet("On {isodate} ({day}) at {time}: {name}", now, "en-US")).toBe("On 2026-11-24 (Tuesday) at 3:05 PM: {name}");
    expect(fillSnippet("{Date}", now, "en-US")).toBe("Nov 24, 2026");
  });
});
