import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findFrameStart, frameLength, readMp4Audio, readWavInfo, sniffFormat, wavToMono, type ReadAt } from "../../src/recorder/mediaFormats";
import { defaultUploadDate, defaultUploadTitle, fromDateTimeLocal, isRecordingFile, MAX_UPLOAD_BYTES, toDateTimeLocal, uploadMimeType, uploadProblem } from "../../src/recorder/uploadFile";
import { parseWebm } from "../../src/recorder/audioTranscribe";
import { retentionPlan } from "../../src/recorder/retention";
import { PLATFORM_LABEL } from "../../src/recorder/calls";
import { audioFileName } from "../../src/sections/MeetingsSection";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(here, "fixtures", name)));
const e2eFixture = (name: string) => new Uint8Array(readFileSync(path.join(here, "../e2e/fixtures", name)));
const reader = (b: Uint8Array): ReadAt => async (offset, length) => b.subarray(offset, offset + length);

describe("upload: which files", () => {
  it("accepts audio and common video files, by type or by extension", () => {
    expect(isRecordingFile({ name: "memo.m4a", type: "audio/x-m4a" })).toBe(true);
    expect(isRecordingFile({ name: "zoom_0.mp4", type: "video/mp4" })).toBe(true);
    expect(isRecordingFile({ name: "IMG_0001.MOV", type: "video/quicktime" })).toBe(true);
    expect(isRecordingFile({ name: "Plaud export.MP3", type: "" })).toBe(true);
    expect(isRecordingFile({ name: "call.webm", type: "" })).toBe(true);
    expect(isRecordingFile({ name: "notes.pdf", type: "application/pdf" })).toBe(false);
    expect(isRecordingFile({ name: "clip.avi", type: "video/x-msvideo" })).toBe(false);
    expect(isRecordingFile({ name: "README", type: "" })).toBe(false);
  });

  it("fills in the type from the extension when the browser gives none", () => {
    expect(uploadMimeType({ name: "a.m4a", type: "" })).toBe("audio/mp4");
    expect(uploadMimeType({ name: "a.mov", type: "" })).toBe("video/quicktime");
    expect(uploadMimeType({ name: "a.wav", type: "audio/x-wav" })).toBe("audio/x-wav");
  });

  it("explains files that are too big, too long or not audio", () => {
    const ok = { name: "a.mp3", type: "audio/mpeg", size: 10_000_000 };
    expect(uploadProblem(ok, 3600)).toBeNull();
    expect(uploadProblem(ok, null)).toBeNull();
    expect(uploadProblem({ ...ok, size: MAX_UPLOAD_BYTES + 1 }, 60)).toMatch(/500 MB/);
    expect(uploadProblem(ok, 3 * 3600 + 1)).toMatch(/3 hours/);
    expect(uploadProblem({ ...ok, size: 0 }, null)).toMatch(/empty/);
    expect(uploadProblem({ name: "a.txt", type: "text/plain", size: 10 }, null)).toMatch(/isn't an audio or video file/);
    // Formats the browser decodes in one go: 1 hour at most.
    expect(uploadProblem({ name: "a.ogg", type: "audio/ogg", size: 10 }, 2 * 3600, "ogg")).toMatch(/over 1 hour/);
    expect(uploadProblem({ name: "a.ogg", type: "audio/ogg", size: 10 }, 1800, "ogg")).toBeNull();
    expect(uploadProblem(ok, 2 * 3600, "mp3")).toBeNull();
  });
});

describe("upload: title and date", () => {
  it("starts the title as the file name without its extension", () => {
    expect(defaultUploadTitle("Team sync 2026-11-20.m4a")).toBe("Team sync 2026-11-20");
    expect(defaultUploadTitle("  New   Recording 23.MP3 ")).toBe("New Recording 23.MP3");
    expect(defaultUploadTitle("New Recording 23.MP3")).toBe("New Recording 23");
    expect(defaultUploadTitle("v1.2 review.webm")).toBe("v1.2 review");
    expect(defaultUploadTitle(".mp3")).toBe("Uploaded recording");
  });

  it("dates it from the file's last change, never in the future", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(defaultUploadDate(Date.UTC(2026, 10, 20, 9), now).getTime()).toBe(Date.UTC(2026, 10, 20, 9));
    expect(defaultUploadDate(now + 86_400_000, now).getTime()).toBe(now);
    expect(defaultUploadDate(0, now).getTime()).toBe(now);
    expect(defaultUploadDate(undefined, now).getTime()).toBe(now);
  });

  it("round-trips the date through the date-and-time field (local time)", () => {
    const d = new Date(2026, 10, 20, 9, 5);
    expect(toDateTimeLocal(d)).toBe("2026-11-20T09:05");
    expect(fromDateTimeLocal("2026-11-20T09:05")?.getTime()).toBe(d.getTime());
    expect(fromDateTimeLocal("")).toBeNull();
  });
});

describe("upload: recognising formats", () => {
  it("tells the formats apart from their first bytes", () => {
    expect(sniffFormat(e2eFixture("speech-en.wav"))).toBe("wav");
    expect(sniffFormat(fixture("tone.m4a"))).toBe("mp4");
    expect(sniffFormat(fixture("clip.mov"))).toBe("mp4");
    expect(sniffFormat(fixture("tone.mp3"))).toBe("mp3");
    expect(sniffFormat(fixture("tone.aac"))).toBe("aac");
    expect(sniffFormat(new TextEncoder().encode("OggS\0\x02 and more bytes"))).toBe("ogg");
    expect(sniffFormat(new TextEncoder().encode("just some text, not audio"))).toBe("unknown");
  });
});

describe("upload: WAV", () => {
  it("finds the samples past other chunks", async () => {
    const wav = e2eFixture("speech-en.wav"); // has a FLLR chunk before the data
    const info = (await readWavInfo(reader(wav), wav.length))!;
    expect(info).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16, blockAlign: 2 });
    expect(info.dataOffset).toBeGreaterThan(44);
    expect(info.dataOffset + info.dataLength).toBeLessThanOrEqual(wav.length);
    expect(info.dataLength / 2 / 16_000).toBeGreaterThan(5);
  });

  const header = (format: number, channels: number, rate: number, bits: number, dataLen: number, extensible = false) => {
    const fmtLen = extensible ? 40 : 16;
    const b = new Uint8Array(12 + 8 + fmtLen + 8);
    const v = new DataView(b.buffer);
    b.set(new TextEncoder().encode("RIFF"), 0);
    b.set(new TextEncoder().encode("WAVE"), 8);
    b.set(new TextEncoder().encode("fmt "), 12);
    v.setUint32(16, fmtLen, true);
    v.setUint16(20, extensible ? 0xfffe : format, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, rate, true);
    v.setUint16(32, (channels * bits) / 8, true);
    v.setUint16(34, bits, true);
    if (extensible) v.setUint16(20 + 24, format, true);
    b.set(new TextEncoder().encode("data"), 20 + fmtLen);
    v.setUint32(24 + fmtLen, dataLen, true);
    return b;
  };

  it("reads to the end when the length was never filled in, and understands the extensible format", async () => {
    const h = header(3, 2, 48_000, 32, 0, true);
    const file = new Uint8Array(h.length + 800);
    file.set(h);
    const info = (await readWavInfo(reader(file), file.length))!;
    expect(info).toMatchObject({ format: 3, channels: 2, bitsPerSample: 32, dataOffset: h.length, dataLength: 800 });
  });

  it("leaves compressed WAV (e.g. ADPCM) to the browser", async () => {
    const h = header(2, 1, 8000, 4, 100);
    expect(await readWavInfo(reader(h), h.length)).toBeNull();
  });

  it("turns 8, 16, 24-bit and float samples into mono", () => {
    const s16 = new Uint8Array(new Int16Array([16384, -16384, 32767, 32767]).buffer); // two stereo frames
    expect([...wavToMono(s16, { format: 1, channels: 2, bitsPerSample: 16, blockAlign: 4 })].map((x) => +x.toFixed(3))).toEqual([0, 1]);
    expect([...wavToMono(Uint8Array.from([128, 255, 0]), { format: 1, channels: 1, bitsPerSample: 8, blockAlign: 1 })].map((x) => +x.toFixed(2))).toEqual([0, 0.99, -1]);
    expect([...wavToMono(Uint8Array.from([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]), { format: 1, channels: 1, bitsPerSample: 24, blockAlign: 3 })]).toEqual([0.5, -0.5]);
    const f32 = new Uint8Array(new Float32Array([0.25, -0.75]).buffer);
    expect([...wavToMono(f32, { format: 3, channels: 1, bitsPerSample: 32, blockAlign: 4 })]).toEqual([0.25, -0.75]);
  });
});

describe("upload: MP4 / M4A / MOV", () => {
  it("finds the AAC packets of an M4A (moov after the audio)", async () => {
    const m4a = fixture("tone.m4a");
    const a = (await readMp4Audio(reader(m4a), m4a.length))!;
    expect(a).toMatchObject({ codec: "mp4a.40.2", sampleRate: 16_000, channels: 1 });
    expect([...a.description!.subarray(0, 2)]).toEqual([0x14, 0x08]); // AAC-LC, 16 kHz, mono
    expect(a.sizes.length).toBe(17);
    expect([a.offsets[0], a.sizes[0]]).toEqual([44, 274]);
    expect(a.offsets[16] + a.sizes[16]).toBeLessThanOrEqual(m4a.length);
  });

  it("takes only the audio track of a video", async () => {
    const mov = fixture("clip.mov");
    const a = (await readMp4Audio(reader(mov), mov.length))!;
    expect(a).toMatchObject({ codec: "mp4a.40.2", sampleRate: 44_100, channels: 2 });
    expect(a.sizes.length).toBe(45);
    expect([a.offsets[0], a.sizes[0]]).toEqual([36, 88]);
  });

  it("returns null for files that aren't MP4", async () => {
    const wav = e2eFixture("speech-en.wav");
    expect(await readMp4Audio(reader(wav), wav.length)).toBeNull();
  });
});

describe("upload: MP3 and AAC frames", () => {
  const walk = (b: Uint8Array, kind: "mp3" | "aac") => {
    let at = findFrameStart(b, 0, kind);
    let frames = 0;
    while (at < b.length) {
      const len = frameLength(b, at, kind);
      if (!len) break;
      at += len;
      frames++;
    }
    return { frames, end: at };
  };

  it("walks MP3 frames to the end of the file", () => {
    const mp3 = fixture("tone.mp3");
    const { frames, end } = walk(mp3, "mp3");
    expect(frames).toBeGreaterThan(30);
    expect(mp3.length - end).toBeLessThan(200); // only a tag may follow
  });

  it("walks ADTS AAC frames to the end of the file", () => {
    const aac = fixture("tone.aac");
    const { frames, end } = walk(aac, "aac");
    expect(frames).toBeGreaterThan(14);
    expect(end).toBe(aac.length);
  });

  it("finds the next frame start from anywhere, for cutting a file into pieces", () => {
    const mp3 = fixture("tone.mp3");
    const starts = new Set<number>();
    for (let at = findFrameStart(mp3, 0, "mp3"); frameLength(mp3, at, "mp3"); at += frameLength(mp3, at, "mp3")) starts.add(at);
    const cut = findFrameStart(mp3, 1500, "mp3");
    expect(cut).toBeGreaterThanOrEqual(1500);
    expect(starts.has(cut)).toBe(true);
  });
});

describe("upload: WebM videos", () => {
  const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const block = (track: number, payload: number[]) => el([0xa3], [0x80 | track, 0x00, 0x00, 0x80, ...payload]);
  it("keeps only the audio track's packets", () => {
    const webm = Uint8Array.from([
      ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], ascii("webm"))),
      ...[0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      ...el([0x16, 0x54, 0xae, 0x6b], [
        ...el([0xae], [...el([0xd7], [1]), ...el([0x83], [1]), ...el([0x86], ascii("V_VP8"))]),
        ...el([0xae], [...el([0xd7], [2]), ...el([0x83], [2]), ...el([0x86], ascii("A_OPUS")), ...el([0xe1], el([0x9f], [1]))]),
      ]),
      ...[0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      ...el([0xe7], [0]),
      ...block(1, [9, 9, 9]),
      ...block(2, [1, 2]),
      ...block(1, [9]),
      ...block(2, [3]),
    ]);
    const a = parseWebm(webm)!;
    expect(a.codec).toBe("A_OPUS");
    expect(a.channels).toBe(1);
    expect(a.frames.map((f) => [...f])).toEqual([[1, 2], [3]]);
  });
});

describe("upload: meetings", () => {
  it("has a label for uploaded recordings", () => {
    expect(PLATFORM_LABEL.upload).toBe("Uploaded recording");
  });

  it("downloads an uploaded file's audio with a fitting extension", () => {
    const name = (audioMimeType: string) => audioFileName({ title: "Call", audioMimeType });
    expect(["audio/x-m4a", "video/mp4", "video/quicktime", "audio/mpeg", "audio/flac", "audio/x-wav", "video/webm"].map(name)).toEqual(["Call-audio.m4a", "Call-audio.mp4", "Call-audio.mov", "Call-audio.mp3", "Call-audio.flac", "Call-audio.wav", "Call-audio.webm"]);
  });

  it("auto-delete counts an old recording from when it was uploaded", () => {
    const now = Date.UTC(2026, 10, 23);
    const old = new Date(now - 400 * 86_400_000).toISOString();
    const plan = retentionPlan(
      [
        { id: "uploaded-today", startedAt: old, uploadedAt: new Date(now - 3600_000).toISOString(), status: "ready", hasAudio: true },
        { id: "recorded-long-ago", startedAt: old, status: "ready", hasAudio: true },
      ],
      { audioDays: 30, meetingDays: 365 },
      now,
    );
    expect(plan.deleteMeetings).toEqual(["recorded-long-ago"]);
    expect(plan.deleteAudio).toEqual([]);
  });
});
