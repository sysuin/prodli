import { describe, expect, it } from "vitest";
import { encodeSize, patchDuration, readDuration, withDuration } from "../../src/screenrec/webmDuration";
import { bubbleRect, formatClock, pickMimeType, videoBitrate } from "../../src/screenrec/layout";

const id = (n: number) => {
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
};
const el = (eid: number, content: number[]) => [...id(eid), ...encodeSize(content.length), ...content];
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** A WebM like Chrome's MediaRecorder writes: no Duration, Segment of unknown size. */
function webm({ duration, scale }: { duration?: number; scale?: number } = {}): Uint8Array {
  const info = [
    ...(scale ? el(0x2ad7b1, id(scale)) : []),
    ...el(0x4d80, [...new TextEncoder().encode("Chrome")]),
    ...(duration !== undefined ? [0x44, 0x89, 0x88, ...new Uint8Array(new Float64Array([duration]).buffer).reverse()] : []),
  ];
  const ebml = el(0x1a45dfa3, el(0x4282, [...new TextEncoder().encode("webm")]));
  const segment = [...id(0x18538067), ...UNKNOWN, ...el(0x1549a966, info), ...el(0x1654ae6b, [0xae, 0x80]), ...id(0x1f43b675), ...UNKNOWN, 0xe7, 0x81, 0x00];
  return new Uint8Array([...ebml, ...segment]);
}

describe("WebM duration", () => {
  it("encodes EBML sizes in the fewest bytes", () => {
    expect([...encodeSize(5)]).toEqual([0x85]);
    expect([...encodeSize(126)]).toEqual([0xfe]);
    expect([...encodeSize(127)]).toEqual([0x40, 0x7f]);
    expect([...encodeSize(300)]).toEqual([0x41, 0x2c]);
  });

  it("writes the duration into a file that has none, keeping everything after the header", () => {
    const file = webm();
    const r = patchDuration(file, 12_345)!;
    expect(r).not.toBeNull();
    const patched = new Uint8Array([...r.bytes, ...file.subarray(r.replaced)]);
    expect(readDuration(patched)).toBe(12_345);
    expect(readDuration(file)).toBeNull();
    // The media after the header is untouched.
    expect([...patched.slice(-3)]).toEqual([0xe7, 0x81, 0x00]);
    expect(patched.length).toBe(file.length + 11);
  });

  it("replaces an existing duration and honours the timecode scale", () => {
    const r = patchDuration(webm({ duration: 1, scale: 1_000_000 }), 2_000)!;
    const patched = new Uint8Array([...r.bytes, ...webm({ duration: 1, scale: 1_000_000 }).subarray(r.replaced)]);
    expect(readDuration(patched)).toBe(2_000);
    const micro = webm({ scale: 1000 }); // timecodes in microseconds
    const r2 = patchDuration(micro, 1_500)!;
    expect(readDuration(new Uint8Array([...r2.bytes, ...micro.subarray(r2.replaced)]))).toBe(1_500_000);
  });

  it("leaves anything else alone", () => {
    expect(patchDuration(new Uint8Array([1, 2, 3, 4]), 10)).toBeNull();
    expect(patchDuration(new TextEncoder().encode("RIFF....WAVE"), 10)).toBeNull();
  });

  it("patches a Blob without reading it all", async () => {
    const big = new Blob([webm(), new Uint8Array(200_000)], { type: "video/webm" });
    const out = await withDuration(big, 4_200);
    expect(out.type).toBe("video/webm");
    expect(out.size).toBe(big.size + 11);
    expect(readDuration(new Uint8Array(await out.slice(0, 4096).arrayBuffer()))).toBe(4_200);
    const notWebm = new Blob([new Uint8Array(10)]);
    expect(await withDuration(notWebm, 10)).toBe(notWebm);
  });
});

describe("recorder layout", () => {
  it("places the bubble in the chosen corner, sized from the shorter side", () => {
    expect(bubbleRect(1920, 1080, { size: "medium", corner: "bottom-left" })).toEqual({ x: 38, y: 1080 - 38 - 259, size: 259 });
    expect(bubbleRect(1920, 1080, { size: "large", corner: "top-right" })).toEqual({ x: 1920 - 38 - 356, y: 38, size: 356 });
    expect(bubbleRect(1080, 1920, { size: "small", corner: "bottom-right" }).size).toBe(184);
  });

  it("picks a bitrate for the size, the best format, and formats the clock", () => {
    expect(videoBitrate(1920, 1080)).toBe(4_000_000);
    expect(videoBitrate(1280, 720)).toBe(2_500_000);
    expect(videoBitrate(3840, 2160)).toBe(6_000_000);
    expect(pickMimeType((t) => t.includes("vp8"))).toBe("video/webm;codecs=vp8,opus");
    expect(pickMimeType(() => false)).toBe("video/webm");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
