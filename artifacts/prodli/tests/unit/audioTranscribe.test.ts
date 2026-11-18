import { describe, expect, it } from "vitest";
import { AUDIO_SPEAKER, encodeWav, parseWebm, RATE, Resampler, Segmenter, toEntries, type Piece } from "../../src/recorder/audioTranscribe";
import { languageNames } from "../../src/sections/meetings/AudioTranscribe";

/** 16 kHz audio: `parts` of [seconds, loud?]. Loud parts are a 220 Hz tone, quiet parts near-silence. */
function audio(parts: [number, boolean][]): Float32Array {
  const total = parts.reduce((n, [s]) => n + Math.round(s * RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [s, loud] of parts) {
    const n = Math.round(s * RATE);
    for (let i = 0; i < n; i++) out[at + i] = loud ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) : 0.0005 * Math.sin(i);
    at += n;
  }
  return out;
}

function cut(samples: Float32Array, chunk = 4096): Piece[] {
  const seg = new Segmenter();
  const pieces: Piece[] = [];
  for (let i = 0; i < samples.length; i += chunk) pieces.push(...seg.push(samples.subarray(i, i + chunk)));
  return [...pieces, ...seg.flush()];
}

const secs = (p: Piece) => p.samples.length / RATE;

describe("audio transcription: cutting at pauses", () => {
  it("cuts between speaker turns and skips the silence around them", () => {
    const pieces = cut(audio([[2, false], [5, true], [1.2, false], [6, true], [3, false], [4.5, true], [2, false]]));
    expect(pieces).toHaveLength(3);
    // Starts include a 0.2 s lead-in before the speech.
    expect(pieces.map((p) => p.startMs)).toEqual([1800, 8000, 17000]);
    expect(pieces.every((p) => secs(p) < 7.5)).toBe(true);
  });

  it("keeps short phrases with what follows unless the pause is long", () => {
    // 2 s phrase, 0.6 s pause (too short to cut a piece under 4 s), then more speech.
    expect(cut(audio([[2, true], [0.6, false], [3, true], [2, false]]))).toHaveLength(1);
    // A 1.2 s pause cuts even a short piece.
    expect(cut(audio([[2, true], [1.2, false], [3, true], [2, false]]))).toHaveLength(2);
  });

  it("never sends more than 25 s, cutting at the quietest moment", () => {
    const long = audio([[60, true]]);
    for (let i = 20 * RATE; i < 20.1 * RATE; i++) long[i] = 0.05 * long[i]; // a soft dip at 20 s
    const pieces = cut(long);
    expect(pieces.every((p) => secs(p) <= 25)).toBe(true);
    expect(Math.abs(pieces[0].startMs + secs(pieces[0]) * 1000 - 20_100)).toBeLessThan(150);
    expect(pieces.reduce((n, p) => n + secs(p), 0)).toBeCloseTo(60, 0);
  });

  it("drops clicks and silence", () => {
    expect(cut(audio([[10, false]]))).toEqual([]);
    expect(cut(audio([[3, false], [0.1, true], [3, false]]))).toEqual([]);
  });

  it("gives the same pieces however the audio arrives", () => {
    const a = audio([[1, false], [5, true], [1.5, false], [5, true], [1, false]]);
    expect(cut(a, 333).map((p) => [p.startMs, p.samples.length])).toEqual(cut(a, 48000).map((p) => [p.startMs, p.samples.length]));
  });
});

describe("audio transcription: resampling and WAV", () => {
  it("turns 48 kHz into 16 kHz, in any chunk sizes", () => {
    const r = new Resampler(48_000);
    const input = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin(i / 100));
    let n = 0;
    for (let i = 0; i < input.length; i += 1000 + (i % 7)) n += r.push(input.subarray(i, i + 1000 + (i % 7))).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
    expect(new Resampler(16_000).push(Float32Array.of(0.1, 0.2, 0.3))).toEqual(Float32Array.of(0.1, 0.2, 0.3).map((x) => Math.fround(x)));
  });

  it("writes 16 kHz mono 16-bit WAV", () => {
    const w = encodeWav(Float32Array.of(0, 1, -1, 2));
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...w.subarray(8, 12))).toBe("WAVE");
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16000, 16, 8]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32767, 32767]);
  });
});

describe("audio transcription: reading WebM", () => {
  // Minimal WebM as Chrome's MediaRecorder writes it: unknown-size Segment and Cluster.
  const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body];
  const unknown = (id: number[]) => [...id, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const block = (payload: number[]) => el([0xa3], [0x81, 0x00, 0x00, 0x80, ...payload]);
  const webm = Uint8Array.from([
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], ascii("webm"))),
    ...unknown([0x18, 0x53, 0x80, 0x67]),
    ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x86], ascii("A_OPUS")), ...el([0x63, 0xa2], ascii("OpusHead")), ...el([0xe1], [...el([0x9f], [2]), ...el([0xb5], [0x47, 0x3b, 0x80, 0x00])])])),
    ...unknown([0x1f, 0x43, 0xb6, 0x75]),
    ...el([0xe7], [0]),
    ...block([1, 2, 3]),
    ...block([4, 5]),
    ...unknown([0x1f, 0x43, 0xb6, 0x75]),
    ...el([0xe7], [0x03, 0xe8]),
    ...block([6]),
  ]);

  it("finds the Opus track and its packets", () => {
    const a = parseWebm(webm)!;
    expect(a.codec).toBe("A_OPUS");
    expect(a.channels).toBe(2);
    expect(a.sampleRate).toBe(48_000);
    expect(new TextDecoder().decode(a.codecPrivate)).toBe("OpusHead");
    expect(a.frames.map((f) => [...f])).toEqual([[1, 2, 3], [4, 5], [6]]);
  });

  it("copes with a recording cut off mid-block, and rejects other files", () => {
    expect(parseWebm(webm.subarray(0, webm.length - 2))!.frames).toHaveLength(2);
    expect(parseWebm(new TextEncoder().encode("ID3 not a webm file"))).toBeNull();
  });
});

describe("audio transcription: building the transcript", () => {
  it("places each piece's lines at the right time, in order", () => {
    const entries = toEntries([
      { startMs: 30_000, durationMs: 4000, result: { text: "Sige, salamat.", segments: [{ start: 0.5, end: 2, text: " Sige, salamat." }], language: "tl" } },
      { startMs: 1000, durationMs: 6000, result: { text: "Let's begin. First item.", segments: [{ start: 0.2, end: 1.5, text: "Let's begin." }, { start: 2, end: 4, text: " First item." }], language: "en" } },
      { startMs: 50_000, durationMs: 3000, result: { text: "No segments here", segments: [], language: "en" } },
      { startMs: 60_000, durationMs: 3000, result: { text: "  ", segments: [], language: null } },
    ]);
    expect(entries.map((e) => [e.startMs, e.endMs, e.text, e.speaker, e.source])).toEqual([
      [1200, 2500, "Let's begin.", AUDIO_SPEAKER, "audio"],
      [3000, 5000, "First item.", AUDIO_SPEAKER, "audio"],
      [30_500, 32_000, "Sige, salamat.", AUDIO_SPEAKER, "audio"],
      [50_000, 53_000, "No segments here", AUDIO_SPEAKER, "audio"],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("names the languages it heard", () => {
    expect(languageNames(["en", "tl"])).toBe("English, Filipino");
    expect(languageNames([])).toBe("");
  });
});
