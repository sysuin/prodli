// Just enough of the common audio/video file formats to transcribe long files
// without holding them in memory as raw audio (Meetings → ⬆ Upload recording;
// recorder/audioTranscribe.ts decodes with them). Pure: no browser APIs; the
// readers take a `read(offset, length)` so a File is read piece by piece.
//
//  - WAV: PCM samples, read and converted straight to numbers.
//  - MP4 / M4A / MOV: the audio track's packets (AAC), for WebCodecs. Video
//    tracks are never read.
//  - MP3 and ADTS AAC: where frames start, so a file can be cut into pieces
//    that each decode on their own.

export type MediaFormat = "wav" | "webm" | "mp4" | "mp3" | "aac" | "ogg" | "flac" | "unknown";

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** The file's format, from its first bytes (64 KB is plenty). */
export function sniffFormat(head: Uint8Array): MediaFormat {
  if (head.length < 12) return "unknown";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return "wav";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  if (["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(head, 4, 4))) return "mp4";
  if (ascii(head, 0, 4) === "OggS") return "ogg";
  if (ascii(head, 0, 4) === "fLaC") return "flac";
  let at = 0;
  if (ascii(head, 0, 3) === "ID3") {
    // Skip the ID3v2 tag (its size is "syncsafe": 7 bits per byte).
    at = 10 + ((head[6] & 0x7f) << 21) + ((head[7] & 0x7f) << 14) + ((head[8] & 0x7f) << 7) + (head[9] & 0x7f) + (head[5] & 0x10 ? 10 : 0);
    if (at + 4 > head.length) return "mp3"; // a long tag (cover art): almost always MP3
  }
  const start = findFrameStart(head, at, "aac", 4096);
  if (start === at) return "aac";
  const mp3 = findFrameStart(head, at, "mp3", 4096);
  if (mp3 >= 0) return "mp3";
  return "unknown";
}

// ── WAV ───────────────────────────────────────────────────────────────────────

export interface WavInfo {
  /** 1 = integer PCM, 3 = floating point */
  format: 1 | 3;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;

/** Where a WAV file's samples are and how they're stored; null if it isn't PCM WAV (it's then decoded by the browser). */
export async function readWavInfo(read: ReadAt, size: number): Promise<WavInfo | null> {
  const head = await read(0, 12);
  if (head.length < 12 || ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WAVE") return null;
  let fmt: Omit<WavInfo, "dataOffset" | "dataLength"> | null = null;
  let pos = 12;
  for (let guard = 0; pos + 8 <= size && guard < 1000; guard++) {
    const h = await read(pos, 8);
    if (h.length < 8) break;
    const id = ascii(h, 0, 4);
    const len = u32(h, 4);
    if (id === "fmt ") {
      const f = await read(pos + 8, Math.min(len, 40));
      if (f.length < 16) return null;
      let format = u16(f, 0);
      if (format === 0xfffe && f.length >= 26) format = u16(f, 24); // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format
      const bits = u16(f, 14);
      if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && (bits === 32 || bits === 64)))) return null;
      const channels = u16(f, 2);
      const blockAlign = u16(f, 12) || (channels * bits) / 8;
      if (!channels || !u32(f, 4) || blockAlign < (channels * bits) / 8) return null;
      fmt = { format: format as 1 | 3, channels, sampleRate: u32(f, 4), bitsPerSample: bits, blockAlign };
    } else if (id === "data") {
      if (!fmt) return null;
      const dataOffset = pos + 8;
      // Recorders that were cut off (or stream) leave the length at 0 or 0xFFFFFFFF: read to the end.
      const dataLength = len === 0 || len === 0xffffffff || dataOffset + len > size ? size - dataOffset : len;
      return { ...fmt, dataOffset, dataLength: dataLength - (dataLength % fmt.blockAlign) };
    }
    pos += 8 + len + (len & 1);
  }
  return null;
}

/** WAV sample bytes (whole frames) → mono numbers between -1 and 1. */
export function wavToMono(bytes: Uint8Array, info: Pick<WavInfo, "format" | "channels" | "bitsPerSample" | "blockAlign">): Float32Array {
  const { channels, bitsPerSample: bits, blockAlign } = info;
  const frames = Math.floor(bytes.length / blockAlign);
  const out = new Float32Array(frames);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const step = bits / 8;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = i * blockAlign + c * step;
      sum +=
        info.format === 3
          ? bits === 32
            ? v.getFloat32(at, true)
            : v.getFloat64(at, true)
          : bits === 16
            ? v.getInt16(at, true) / 32768
            : bits === 8
              ? (bytes[at] - 128) / 128
              : bits === 24
                ? (((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) << 8) >> 8) / 8388608
                : v.getInt32(at, true) / 2147483648;
    }
    out[i] = sum / channels;
  }
  return out;
}

// ── MP4 / M4A / MOV ───────────────────────────────────────────────────────────

export interface Mp4Audio {
  /** WebCodecs codec string, e.g. "mp4a.40.2" (AAC-LC) */
  codec: string;
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig, the decoder's `description` */
  description?: Uint8Array;
  /** Where each packet is in the file, in order. */
  offsets: Float64Array;
  sizes: Uint32Array;
}

const u32be = (b: Uint8Array, at: number) => b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
const u64be = (b: Uint8Array, at: number) => u32be(b, at) * 0x100000000 + u32be(b, at + 4);

interface Box {
  type: string;
  /** payload start and end, within the buffer */
  start: number;
  end: number;
}

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      size = u64be(b, pos + 8);
      header = 16;
    } else if (size === 0) size = to - pos;
    if (size < header || pos + size > to) return;
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}
const child = (b: Uint8Array, box: Box, type: string, skip = 0) => {
  for (const c of boxes(b, box.start + skip, box.end)) if (c.type === type) return c;
  return null;
};
const path = (b: Uint8Array, box: Box | null, ...types: string[]) => {
  let cur = box;
  for (const t of types) cur = cur && child(b, cur, t);
  return cur;
};

/** An MPEG-4 descriptor's length (1-4 bytes, 7 bits each). */
function descLength(b: Uint8Array, at: number): { len: number; at: number } {
  let len = 0;
  for (let i = 0; i < 4; i++) {
    const x = b[at++];
    len = (len << 7) | (x & 0x7f);
    if (!(x & 0x80)) break;
  }
  return { len, at };
}

/** Codec string and AudioSpecificConfig from an 'esds' box. */
function readEsds(b: Uint8Array, box: Box): { codec: string; description?: Uint8Array } | null {
  let at = box.start + 4;
  if (b[at] !== 0x03) return null;
  ({ at } = descLength(b, at + 1));
  const flags = b[at + 2];
  at += 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + b[at];
  if (flags & 0x20) at += 2;
  if (b[at] !== 0x04) return null;
  ({ at } = descLength(b, at + 1));
  const oti = b[at];
  at += 13;
  let description: Uint8Array | undefined;
  if (b[at] === 0x05) {
    const d = descLength(b, at + 1);
    description = b.slice(d.at, Math.min(d.at + d.len, box.end));
  }
  if (oti === 0x40) {
    let aot = description?.length ? description[0] >> 3 : 2;
    if (aot === 31 && description && description.length > 1) aot = 32 + (((description[0] & 7) << 3) | (description[1] >> 5));
    return { codec: `mp4a.40.${aot || 2}`, description };
  }
  if (oti === 0x66 || oti === 0x67 || oti === 0x68) return { codec: "mp4a.40.2", description }; // MPEG-2 AAC
  if (oti === 0x69 || oti === 0x6b) return { codec: "mp3" };
  return null;
}

/**
 * The first audio track of an MP4/M4A/MOV file: codec and where its packets
 * are. Null when there's none we can read this way (no audio, another codec, or
 * a "fragmented" file as phones' MediaRecorder writes); the browser then decodes it.
 */
export async function readMp4Audio(read: ReadAt, size: number): Promise<Mp4Audio | null> {
  // Find 'moov' among the top-level boxes (it can be before or after the media data).
  let pos = 0;
  let moov: Uint8Array | null = null;
  for (let guard = 0; pos + 8 <= size && guard < 10_000; guard++) {
    const h = await read(pos, 16);
    if (h.length < 8) break;
    let len = u32be(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (len === 1) {
      if (h.length < 16) break;
      len = u64be(h, 8);
      header = 16;
    } else if (len === 0) len = size - pos;
    if (len < header) break;
    if (type === "moov") {
      if (len > 200 * 1024 * 1024) return null;
      moov = await read(pos, len);
      if (moov.length < len) return null;
      break;
    }
    pos += len;
  }
  if (!moov) return null;
  const root: Box = { type: "moov", start: 8, end: moov.length };
  if (u32be(moov, 0) === 1) root.start = 16;
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(moov, trak, "mdia");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    if (!mdia || !hdlr || ascii(moov, hdlr.start + 8, 4) !== "soun") continue;
    const stbl = path(moov, mdia, "minf", "stbl");
    const stsd = stbl && child(moov, stbl, "stsd");
    if (!stbl || !stsd) return null;
    const entry = boxes(moov, stsd.start + 8, stsd.end).next().value as Box | undefined;
    if (!entry) return null;
    // AudioSampleEntry: 8 bytes of SampleEntry, then version, …, channels, sample size, …, rate (16.16).
    const version = (moov[entry.start + 8] << 8) | moov[entry.start + 9];
    let channels = ((moov[entry.start + 16] << 8) | moov[entry.start + 17]) || 1;
    let sampleRate = Math.floor(u32be(moov, entry.start + 24) / 65536);
    const fixed = version === 1 ? 44 : version === 2 ? 64 : 28;
    if (version === 2) {
      sampleRate = Math.round(new DataView(moov.buffer, moov.byteOffset + entry.start + 32, 8).getFloat64(0));
      channels = u32be(moov, entry.start + 40) || channels;
    }
    let esds = child(moov, entry, "esds", fixed);
    if (!esds) {
      const wave = child(moov, entry, "wave", fixed); // QuickTime puts it inside 'wave'
      if (wave) esds = child(moov, wave, "esds") ?? path(moov, wave, "mp4a", "esds");
    }
    const codec = entry.type === "mp4a" && esds ? readEsds(moov, esds) : entry.type === ".mp3" ? { codec: "mp3" } : null;
    if (!codec) return null;
    // Sample table: sizes (stsz), chunk offsets (stco/co64), samples per chunk (stsc).
    const stsz = child(moov, stbl, "stsz");
    const stco = child(moov, stbl, "stco");
    const co64 = child(moov, stbl, "co64");
    const stsc = child(moov, stbl, "stsc");
    if (!stsz || !(stco || co64) || !stsc) return null;
    const fixedSize = u32be(moov, stsz.start + 4);
    const count = u32be(moov, stsz.start + 8);
    if (!count || (!fixedSize && stsz.start + 12 + count * 4 > stsz.end)) return null;
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixedSize || u32be(moov, stsz.start + 12 + i * 4);
    const chunks = co64 ?? stco!;
    const nChunks = u32be(moov, chunks.start + 4);
    const chunkOffset = (i: number) => (co64 ? u64be(moov!, co64.start + 8 + i * 8) : u32be(moov!, stco!.start + 8 + i * 4));
    const runs = u32be(moov, stsc.start + 4);
    const offsets = new Float64Array(count);
    let s = 0;
    for (let r = 0; r < runs && s < count; r++) {
      const at = stsc.start + 8 + r * 12;
      const first = u32be(moov, at) - 1;
      const perChunk = u32be(moov, at + 4);
      const last = r + 1 < runs ? u32be(moov, at + 12) - 1 : nChunks;
      for (let c = first; c < last && c < nChunks && s < count; c++) {
        let off = chunkOffset(c);
        for (let k = 0; k < perChunk && s < count; k++) {
          offsets[s] = off;
          off += sizes[s++];
        }
      }
    }
    if (s < count) return null;
    return { codec: codec.codec, description: "description" in codec ? codec.description : undefined, sampleRate: sampleRate || 44_100, channels, offsets, sizes };
  }
  return null;
}

// ── MP3 / ADTS frames ─────────────────────────────────────────────────────────

const MP3_BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = [44_100, 48_000, 32_000];
const ADTS_RATES = 13;

/** Length in bytes of the frame starting at `at`, or 0 if no frame header is there. */
export function frameLength(b: Uint8Array, at: number, kind: "mp3" | "aac"): number {
  if (at + 7 > b.length || b[at] !== 0xff) return 0;
  const b1 = b[at + 1];
  if (kind === "aac") {
    if ((b1 & 0xf6) !== 0xf0 || ((b[at + 2] >> 2) & 0xf) >= ADTS_RATES) return 0;
    const len = ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5);
    return len >= 7 ? len : 0;
  }
  if ((b1 & 0xe0) !== 0xe0) return 0;
  const version = (b1 >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b1 >> 1) & 3; // 3 = layer I, 2 = II, 1 = III
  const b2 = b[at + 2];
  const brIndex = b2 >> 4;
  const srIndex = (b2 >> 2) & 3;
  if (version === 1 || layer === 0 || brIndex === 0 || brIndex === 15 || srIndex === 3) return 0;
  const v1 = version === 3;
  const table = v1 ? (layer === 3 ? MP3_BITRATES.v1l1 : layer === 2 ? MP3_BITRATES.v1l2 : MP3_BITRATES.v1l3) : layer === 3 ? MP3_BITRATES.v2l1 : MP3_BITRATES.v2l23;
  const bitrate = table[brIndex] * 1000;
  const rate = MP3_RATES[srIndex] / (v1 ? 1 : version === 2 ? 2 : 4);
  const pad = (b2 >> 1) & 1;
  if (layer === 3) return (Math.floor((12 * bitrate) / rate) + pad) * 4;
  return Math.floor(((layer === 1 && !v1 ? 72 : 144) * bitrate) / rate) + pad;
}

/**
 * Where the next frame starts at or after `from` (-1 if none within `limit`
 * bytes): a frame header that is followed by another one, so a stray 0xFF in
 * the audio isn't mistaken for a frame.
 */
export function findFrameStart(b: Uint8Array, from: number, kind: "mp3" | "aac", limit = Infinity): number {
  const end = Math.min(b.length - 4, from + limit);
  for (let i = Math.max(0, from); i < end; i++) {
    if (b[i] !== 0xff) continue;
    const len = frameLength(b, i, kind);
    if (!len) continue;
    if (i + len + 4 > b.length || frameLength(b, i + len, kind)) return i;
  }
  return -1;
}
