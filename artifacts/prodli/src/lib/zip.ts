// A tiny zip writer (stored, no compression) for "Download everything as
// Markdown", and a reader for imports (stored or deflate, via the browser's
// DecompressionStream). No dependency. Spec: PKWARE APPNOTE 4.3.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds a .zip from files (text, or bytes). Names may include folders ("notes/a.md"). */
export function zipFiles(files: { name: string; text?: string; bytes?: Uint8Array }[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.bytes ?? enc.encode(f.text ?? "");
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a .zip (files only; folders are skipped). Supports stored and deflated
 * entries, which is what Todoist, Google Takeout and the OS "Compress" menus
 * write. Throws on encrypted, zip64 or otherwise unsupported archives.
 * `accept` filters by name before anything is inflated.
 */
export async function readZip(input: Uint8Array | ArrayBuffer, accept: (name: string) => boolean = () => true, maxEntries = 500): Promise<ZipEntry[]> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: 22 bytes plus an optional comment of up to 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This isn't a .zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff || count === 0xffff) throw new Error("This .zip is too large to read here.");
  const utf8 = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("This .zip looks damaged.");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || !accept(name)) continue;
    if (flags & 1) throw new Error("This .zip is password-protected.");
    if (localOffset + 30 > buf.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("This .zip looks damaged.");
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.push({ name, bytes: data });
    else if (method === 8) out.push({ name, bytes: await inflateRaw(data) });
    else throw new Error(`Can't read ${name} in this .zip (unsupported compression).`);
    if (out.length >= maxEntries) break;
  }
  return out;
}
