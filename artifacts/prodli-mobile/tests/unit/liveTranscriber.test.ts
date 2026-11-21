import { describe, expect, it } from "vitest";
import { inPersonMeeting, int16ToMonoFloat, LiveTranscriber } from "../../src/lib/liveTranscriber";
import type { PieceResult } from "../../src/shared";

/** 16-bit PCM: `seconds` of a 220 Hz tone (speech-like loudness) or silence. */
function pcm(seconds: number, rate: number, loud: boolean, channels = 1): ArrayBuffer {
  const n = Math.round(seconds * rate);
  const v = new DataView(new ArrayBuffer(n * 2 * channels));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) v.setInt16((i * channels + c) * 2, loud ? Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000) : 0, true);
  return v.buffer;
}

const wavRate = (wav: Uint8Array) => new DataView(wav.buffer, wav.byteOffset).getUint32(24, true);

describe("live transcription", () => {
  it("converts 16-bit PCM to mono floats (averaging stereo)", () => {
    const v = new DataView(new ArrayBuffer(8));
    v.setInt16(0, 16384, true);
    v.setInt16(2, 0, true);
    v.setInt16(4, -32768, true);
    v.setInt16(6, -32768, true);
    expect(Array.from(int16ToMonoFloat(v.buffer, 2))).toEqual([0.25, -1]);
  });

  it("sends speech in pieces cut at pauses, as 16 kHz WAV, never silence; builds the transcript in order", async () => {
    const sent: { startMs: number; bytes: number; rate: number }[] = [];
    let n = 0;
    const t = new LiveTranscriber(async (wav, startMs): Promise<PieceResult> => {
      sent.push({ startMs, bytes: wav.length, rate: wavRate(wav) });
      n++;
      return { text: `part ${n}`, segments: [{ start: 0, end: 1, text: `part ${n}` }], language: "en" };
    });
    // 48 kHz from the phone: 2 s silence, 3 s speech, 2 s silence, 2 s speech, 3 s silence.
    for (const [s, loud] of [[2, false], [3, true], [2, false], [2, true], [3, false]] as const) {
      const chunk = pcm(s, 48_000, loud);
      for (let at = 0; at < chunk.byteLength; at += 9600) t.push(chunk.slice(at, at + 9600), 48_000);
    }
    const done = await t.finish();
    expect(sent.length).toBe(2);
    expect(sent.every((p) => p.rate === 16_000)).toBe(true);
    expect(sent[0].startMs).toBeGreaterThanOrEqual(1500);
    expect(sent[0].startMs).toBeLessThan(2100);
    expect(sent[1].startMs).toBeGreaterThan(sent[0].startMs + 3000);
    expect(done.entries.map((e) => e.text)).toEqual(["part 1", "part 2"]);
    expect(done.pending).toBe(0);
    expect(done.failed).toBe(0);
    expect(done.sentSeconds).toBeGreaterThan(4);
  });

  it("retries brief failures, then counts a piece as failed and keeps going", async () => {
    let calls = 0;
    const t = new LiveTranscriber(
      async () => {
        calls++;
        throw new Error("Can't reach ProdLi.");
      },
      undefined,
      { retries: 2, retryDelayMs: 1 },
    );
    t.push(pcm(2, 16_000, true), 16_000);
    t.push(pcm(2, 16_000, false), 16_000);
    const done = await t.finish();
    expect(calls).toBe(3);
    expect(done.failed).toBe(1);
    expect(done.error).toMatch(/reach ProdLi/);
  });

  it("makes a synced in-person meeting from the result", () => {
    const m = inPersonMeeting({ title: "", startedAt: Date.UTC(2026, 10, 21, 9), endedAt: Date.UTC(2026, 10, 21, 9, 30), entries: [], failed: 0 });
    expect(m).toMatchObject({ platform: "in-person", status: "ready", durationSec: 1800, hasAudio: false, transcriptSource: "audio" });
    expect(m.title).toMatch(/^In-person meeting/);
    expect(m.notice).toMatch(/Nothing was transcribed/);
  });
});
