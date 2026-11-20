import { describe, expect, it } from "vitest";
import { ActivityTracker, labelSpeakers, talkStats } from "../../src/recorder/speakers";
import type { TranscriptEntry } from "../../src/recorder/types";

const entry = (startMs: number, endMs: number, text = "…"): TranscriptEntry => ({ id: String(startMs), speaker: "Speaker", text, startMs, endMs, source: "audio" });

describe("who's talking", () => {
  it("tracks the mic and the call as separate speakers", () => {
    const t = new ActivityTracker();
    let ms = 0;
    const feed = (mic: number, tab: number, seconds: number) => {
      for (let i = 0; i < seconds * 10; i++, ms += 100) t.push(ms, mic, tab);
    };
    feed(0.001, 0.001, 1); // silence
    feed(0.08, 0.001, 3); // you talk
    feed(0.001, 0.001, 1);
    feed(0.002, 0.07, 2); // they talk
    const a = t.result();
    expect(a.map(([, , w]) => w)).toEqual([0, 1]);
    expect(a[0][0]).toBeGreaterThanOrEqual(900);
    expect(a[0][1]).toBeLessThanOrEqual(4200);
    expect(a[1][0]).toBeGreaterThanOrEqual(4900);
  });

  it("ignores blips and quiet noise", () => {
    const t = new ActivityTracker();
    for (let i = 0; i < 50; i++) t.push(i * 100, 0.003, 0.002);
    t.push(5000, 0.1, 0); // one 100 ms blip
    expect(t.result()).toEqual([]);
  });

  it("labels each AI transcript line by who talked most during it", () => {
    const lines = [entry(1000, 3500, "Shall we start?"), entry(5000, 6800, "Yes, the budget is approved."), entry(9000, 9500, "(no activity here)")];
    const out = labelSpeakers(lines, [[900, 4200, 0], [4900, 7000, 1]]);
    expect(out.map((e) => e.speaker)).toEqual(["You", "Others", "Speaker"]);
    expect(out[1].text).toBe("Yes, the budget is approved.");
  });

  it("leaves transcripts alone without activity data", () => {
    const lines = [entry(0, 1000)];
    expect(labelSpeakers(lines, undefined)).toBe(lines);
    expect(labelSpeakers(lines, [])).toBe(lines);
  });
});

describe("talk-time insights", () => {
  it("splits the talking and finds your longest stretch", () => {
    const s = talkStats([[0, 20_000, 0], [20_000, 30_000, 1], [30_000, 40_000, 0], [40_000, 45_000, 0], [45_000, 60_000, 1]]);
    expect(s).toEqual({ youMs: 35_000, othersMs: 25_000, youShare: 58, longestYouMs: 20_000, turns: 3 });
  });
  it("needs at least 30 seconds of speech", () => {
    expect(talkStats([[0, 10_000, 0]])).toBeNull();
    expect(talkStats(undefined)).toBeNull();
  });
});
