import { describe, expect, it } from "vitest";
import { addMark, clock, MAX_MARKS, momentExcerpts, momentsForSummary, removeMark } from "../../src/lib/moments";
import type { TranscriptEntry } from "../../src/recorder/types";

const line = (startS: number, speaker: string, text: string): TranscriptEntry => ({ id: `${startS}`, speaker, text, startMs: startS * 1000, endMs: startS * 1000 + 4000 });

describe("addMark / removeMark", () => {
  it("keeps marks sorted and ignores a double press", () => {
    let m = addMark(undefined, 60_000);
    m = addMark(m, 10_000);
    m = addMark(m, 61_500);
    expect(m).toEqual([10_000, 60_000]);
    expect(removeMark(m, 10_000)).toEqual([60_000]);
  });
  it("stops at MAX_MARKS", () => {
    let m: number[] = [];
    for (let i = 0; i < MAX_MARKS + 5; i++) m = addMark(m, i * 10_000);
    expect(m).toHaveLength(MAX_MARKS);
  });
  it("never goes below zero", () => {
    expect(addMark([], -500)).toEqual([0]);
  });
});

describe("clock", () => {
  it("formats minutes and hours", () => {
    expect(clock(65_000)).toBe("01:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });
});

describe("momentExcerpts", () => {
  const transcript = [line(0, "Ann", "Hi all."), line(50, "Bo", "Budget is 20k."), line(58, "Ann", "We ship Friday."), line(120, "Bo", "Next topic.")];
  it("takes what was said just before and after the mark", () => {
    expect(momentExcerpts(transcript, [62_000])).toEqual([{ atMs: 62_000, text: "Bo: Budget is 20k. Ann: We ship Friday." }]);
  });
  it("gives an empty text where nothing was said", () => {
    expect(momentExcerpts(transcript, [300_000])[0].text).toBe("");
  });
  it("keeps the end of a long excerpt", () => {
    const long = [line(50, "Ann", "word ".repeat(200) + "THE END")];
    const [m] = momentExcerpts(long, [55_000]);
    expect(m.text.length).toBeLessThanOrEqual(400);
    expect(m.text.startsWith("…")).toBe(true);
    expect(m.text.endsWith("THE END")).toBe(true);
  });
  it("only sends moments with something said, with their time", () => {
    expect(momentsForSummary(transcript, [300_000, 62_000])).toEqual(["[01:02] Bo: Budget is 20k. Ann: We ship Friday."]);
  });
});
