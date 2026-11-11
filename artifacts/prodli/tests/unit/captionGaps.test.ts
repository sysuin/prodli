import { describe, expect, it } from "vitest";
import { fillCaptionGaps, transcriptToText } from "../../src/recorder/format";
import type { TranscriptEntry } from "../../src/recorder/types";

const s = 1000;
const line = (id: string, speaker: string, text: string, from: number, to = from + 4): TranscriptEntry => ({ id, speaker, text, startMs: from * s, endMs: to * s });

describe("filling caption gaps from the on-device transcript", () => {
  const captions = [line("c1", "Priya", "Let's start with the launch.", 0), line("c2", "Sam", "The blog post is ready.", 6), line("c3", "Priya", "Great, ship it Friday.", 70)];
  const speech = [
    line("s1", "Others", "let's start with the launch", 1), // already in captions
    line("s2", "Others", "the blog post is ready", 7), // already in captions
    line("s3", "Others", "we also need the pricing page", 30), // captions missed 10s–66s
    line("s4", "You", "I'll take the pricing page", 40),
    line("s5", "Others", "great ship it friday", 71), // already in captions
    line("s6", "You", "thanks everyone", 120), // after the last caption
  ];

  it("keeps the captions and adds on-device lines only where captions were missing", () => {
    const { transcript, filled } = fillCaptionGaps(captions, speech);
    expect(filled).toBe(3);
    expect(transcript.map((e) => e.text)).toEqual(["Let's start with the launch.", "The blog post is ready.", "we also need the pricing page", "I'll take the pricing page", "Great, ship it Friday.", "thanks everyone"]);
    expect(transcript.filter((e) => e.source === "device").map((e) => e.id)).toEqual(["device-s3", "device-s4", "device-s6"]);
    expect(transcript.find((e) => e.id === "c1")?.source).toBeUndefined();
  });

  it("doesn't fill short pauses between captions", () => {
    const close = [line("c1", "Priya", "One", 0), line("c2", "Sam", "Two", 14)]; // 4s–14s uncovered → 2s gap after padding
    const { filled } = fillCaptionGaps(close, [line("s1", "Others", "one and a half", 9)]);
    expect(filled).toBe(0);
  });

  it("uses whichever transcript exists when the other is empty", () => {
    expect(fillCaptionGaps([], speech)).toEqual({ transcript: speech, filled: speech.length });
    expect(fillCaptionGaps(captions, [])).toEqual({ transcript: captions, filled: 0 });
  });

  it("the summary input keeps the time order", () => {
    const text = transcriptToText(fillCaptionGaps(captions, speech).transcript);
    expect(text.split("\n")[2]).toBe("[00:30] Others: we also need the pricing page");
  });
});
