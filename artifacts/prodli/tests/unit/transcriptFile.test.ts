import { describe, expect, it } from "vitest";
import { isTranscriptFile, parseTranscript, timeToMs } from "../../src/recorder/transcriptFile";

const turns = (text: string) => parseTranscript(text).entries.map((e) => [e.speaker, e.text, e.startMs]);

describe("transcript files", () => {
  it("knows which files are transcripts", () => {
    expect(isTranscriptFile({ name: "call.vtt" })).toBe(true);
    expect(isTranscriptFile({ name: "otter.txt" })).toBe(true);
    expect(isTranscriptFile({ name: "Notes.md" })).toBe(true);
    expect(isTranscriptFile({ name: "call.m4a", type: "audio/mp4" })).toBe(false);
  });

  it("reads times", () => {
    expect(timeToMs("00:01:02.500")).toBe(62_500);
    expect(timeToMs("1:02:03,25")).toBe(3_723_250);
    expect(timeToMs("02:03")).toBe(123_000);
    expect(timeToMs("nope")).toBeNull();
  });

  it("reads Teams and Google Meet captions (<v Name>)", () => {
    const vtt = "WEBVTT\n\n1a2b/3-0\n00:00:01.000 --> 00:00:03.500\n<v Jane Doe>Morning, everyone.</v>\n\n1a2b/4-0\n00:00:03.600 --> 00:00:05.000\n<v Jane Doe>Let's start.</v>\n\n00:00:06.000 --> 00:00:08.000\n<v Sam Lee>Sounds good &amp; ready.</v>\n";
    const p = parseTranscript(vtt);
    expect(p.format).toBe("captions");
    expect(turns(vtt)).toEqual([
      ["Jane Doe", "Morning, everyone. Let's start.", 1000],
      ["Sam Lee", "Sounds good & ready.", 6000],
    ]);
    expect(p.speakers).toEqual(["Jane Doe", "Sam Lee"]);
    expect(p.durationSec).toBe(8);
  });

  it("reads Zoom captions (Name: words) and SRT", () => {
    const zoom = "WEBVTT\n\n1\n00:00:02.000 --> 00:00:04.000\nJane Doe: Can you hear me?\n\n2\n00:00:05.000 --> 00:00:06.000\nSam Lee: Yes.\n";
    expect(turns(zoom)).toEqual([
      ["Jane Doe", "Can you hear me?", 2000],
      ["Sam Lee", "Yes.", 5000],
    ]);
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:01:00,000 --> 00:01:02,000\nSecond line.\n";
    expect(turns(srt)).toEqual([
      ["", "Hello there.", 1000],
      ["", "Second line.", 60_000],
    ]);
  });

  it("reads Otter and Fireflies text exports", () => {
    const otter = "Jane Doe  0:00\nWelcome to the weekly sync.\nFirst item is the launch.\n\nSam Lee  0:12\nThe launch is on track.\n\nJane Doe  1:05\nGreat.\n";
    const p = parseTranscript(otter);
    expect(p.format).toBe("timed text");
    expect(turns(otter)).toEqual([
      ["Jane Doe", "Welcome to the weekly sync. First item is the launch.", 0],
      ["Sam Lee", "The launch is on track.", 12_000],
      ["Jane Doe", "Great.", 65_000],
    ]);
    expect(p.entries[0].endMs).toBe(12_000);
    expect(turns("Jane - 00:00:05\nHi.\nSam - 00:00:09\nHello.")).toEqual([
      ["Jane", "Hi.", 5000],
      ["Sam", "Hello.", 9000],
    ]);
    expect(turns("[00:00:05] Jane: Hi.\n[00:00:09] Sam: Hello.")).toEqual([
      ["Jane", "Hi.", 5000],
      ["Sam", "Hello.", 9000],
    ]);
  });

  it("reads untimed Name: lines (Granola) and plain paragraphs", () => {
    const granola = "# Transcript\n\nMe: Let's review the budget.\nThem: The numbers are in the sheet.\nIt's shared already.\nMe: Thanks.";
    const p = parseTranscript(granola);
    expect(p.format).toBe("text");
    expect(p.entries.map((e) => [e.speaker, e.text])).toEqual([
      ["Me", "Let's review the budget."],
      ["Them", "The numbers are in the sheet. It's shared already."],
      ["Me", "Thanks."],
    ]);
    expect(p.entries[1].startMs).toBe(p.entries[0].endMs);
    const plain = parseTranscript("We talked about hiring. Two roles are open.\n\nNext: the offsite in March.");
    expect(plain.entries.map((e) => [e.speaker, e.text])).toEqual([
      ["", "We talked about hiring. Two roles are open."],
      ["", "Next: the offsite in March."],
    ]);
  });

  it("doesn't take a sentence or a link for a speaker", () => {
    const p = parseTranscript("Note this. Then: we ship\n\nSee https://example.com for more");
    expect(p.entries.every((e) => e.speaker === "")).toBe(true);
  });

  it("finds nothing in an empty file", () => {
    expect(parseTranscript("WEBVTT\n\n").entries).toEqual([]);
    expect(parseTranscript("   ").entries).toEqual([]);
  });
});
