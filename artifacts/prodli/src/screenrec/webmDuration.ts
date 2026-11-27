// Chrome's MediaRecorder writes WebM without a duration (it streams, so it
// doesn't know the length until the end). Players then show no length and
// can't seek. This writes the duration into the file's header: only the first
// few kilobytes change. Pure (unit-tested). Spec: Matroska/EBML.

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;
const TRACKS = 0x1654ae6b;

interface Vint {
  value: number;
  length: number;
  /** All value bits set: "size unknown". */
  unknown: boolean;
}

function readId(b: Uint8Array, at: number): Vint | null {
  const first = b[at];
  if (first === undefined) return null;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || at + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[at + i];
  return { value, length, unknown: false };
}

function readSize(b: Uint8Array, at: number): Vint | null {
  const first = b[at];
  if (first === undefined) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i];
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

/** An EBML size as the shortest vint that holds it. */
export function encodeSize(n: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    const max = 2 ** (7 * length) - 2; // all-ones means "unknown"
    if (n <= max) {
      const out = new Uint8Array(length);
      let v = n;
      for (let i = length - 1; i >= 0; i--) {
        out[i] = v % 256;
        v = Math.floor(v / 256);
      }
      out[0] |= 0x80 >> (length - 1);
      return out;
    }
  }
  throw new Error("size too large");
}

function float64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, n);
  return out;
}

/**
 * The header with the duration written in. `head` is the start of the file
 * (64 KB is plenty: Chrome's header is a few hundred bytes). Returns the new
 * head and how many bytes of the old head it replaces, or null when this
 * isn't a WebM we understand (the file is then left as it is).
 */
export function patchDuration(head: Uint8Array, durationMs: number): { bytes: Uint8Array; replaced: number } | null {
  let at = 0;
  // EBML header element, then the Segment.
  const ebml = readId(head, at);
  if (!ebml || ebml.value !== 0x1a45dfa3) return null;
  const ebmlSize = readSize(head, at + ebml.length);
  if (!ebmlSize) return null;
  at += ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(head, at);
  if (!seg || seg.value !== SEGMENT) return null;
  const segSize = readSize(head, at + seg.length);
  if (!segSize) return null;
  at += seg.length + segSize.length;
  // Walk the Segment's children until Info.
  while (at < head.length) {
    const id = readId(head, at);
    if (!id) return null;
    const size = readSize(head, at + id.length);
    if (!size) return null;
    const contentStart = at + id.length + size.length;
    if (id.value === CLUSTER || id.value === TRACKS) return null; // no Info before the media: not ours
    if (id.value !== INFO) {
      if (size.unknown) return null;
      at = contentStart + size.value;
      continue;
    }
    if (size.unknown || contentStart + size.value > head.length) return null;
    const content = head.subarray(contentStart, contentStart + size.value);
    // Inside Info: the timecode scale (ns per unit, default 1 ms) and any existing Duration.
    let scale = 1_000_000;
    let p = 0;
    const kept: Uint8Array[] = [];
    while (p < content.length) {
      const cid = readId(content, p);
      if (!cid) return null;
      const csize = readSize(content, p + cid.length);
      if (!csize || csize.unknown) return null;
      const end = p + cid.length + csize.length + csize.value;
      const data = content.subarray(p + cid.length + csize.length, end);
      if (cid.value === TIMECODE_SCALE) {
        scale = 0;
        for (const x of data) scale = scale * 256 + x;
        scale ||= 1_000_000;
      }
      if (cid.value !== DURATION) kept.push(content.subarray(p, end));
      p = end;
    }
    const units = (durationMs * 1_000_000) / scale;
    const durationEl = new Uint8Array([0x44, 0x89, 0x88, ...float64(units)]);
    const newContentLength = kept.reduce((n, k) => n + k.length, 0) + durationEl.length;
    const idBytes = head.subarray(at, at + id.length);
    const sizeBytes = encodeSize(newContentLength);
    const info = new Uint8Array(idBytes.length + sizeBytes.length + newContentLength);
    let o = 0;
    for (const part of [idBytes, sizeBytes, ...kept, durationEl]) {
      info.set(part, o);
      o += part.length;
    }
    const before = head.subarray(0, at);
    const bytes = new Uint8Array(before.length + info.length);
    bytes.set(before, 0);
    bytes.set(info, before.length);
    return { bytes, replaced: contentStart + size.value };
  }
  return null;
}

/** The recording with its duration written in, so it can be seeked; the same blob if it can't be patched. */
export async function withDuration(blob: Blob, durationMs: number): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 65_536).arrayBuffer());
  const patched = patchDuration(head, durationMs);
  if (!patched) return blob;
  return new Blob([patched.bytes as BlobPart, blob.slice(patched.replaced)], { type: blob.type });
}

/** Reads the duration back (ms), for tests and checks. */
export function readDuration(head: Uint8Array): number | null {
  const r = patchDuration(head, 0);
  if (!r) return null;
  // Find Duration in the original head's Info.
  for (let i = 0; i + 11 <= head.length; i++) {
    if (head[i] === 0x44 && head[i + 1] === 0x89 && head[i + 2] === 0x88) return new DataView(head.buffer, head.byteOffset + i + 3, 8).getFloat64(0);
  }
  return null;
}
