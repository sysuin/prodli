#!/usr/bin/env node
// Draws ProdLi's four-square mark into the images the desktop app needs, with no
// image libraries (plain zlib + tiny PNG / ICO writers). Run: pnpm icons
//
//   build/icon.png            1024×1024  app icon (electron-builder makes .icns / .ico from it)
//   build/trayTemplate.png    16×16      macOS menu bar (template: black + alpha, tinted by macOS)
//   build/trayTemplate@2x.png 32×32
//   build/tray.ico            16+32      Windows notification area (full colour)
//   build/tray.png            32×32      Linux tray
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(out, { recursive: true });
const C = { frame: [0, 0, 0, 255], yellow: [255, 215, 0, 255], cyan: [0, 188, 212, 255], red: [255, 107, 107, 255], green: [102, 187, 106, 255], black: [0, 0, 0, 255] };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** The mark on a `size` canvas, `mark` pixels wide, centred. `mono`: black squares with gaps (template image). */
function draw(size, mark, { mono = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, c) => x >= 0 && y >= 0 && x < size && y < size && c.forEach((v, i) => (px[(y * size + x) * 4 + i] = v));
  const o = Math.round((size - mark) / 2);
  const s = mark / 128;
  const rect = (x, y, w, h, c) => {
    for (let j = Math.round(o + y * s); j < Math.round(o + (y + h) * s); j++) for (let i = Math.round(o + x * s); i < Math.round(o + (x + w) * s); i++) set(i, j, c);
  };
  if (mono) {
    // Four solid squares with a clear gap: reads well at 16 px in the menu bar.
    rect(4, 4, 54, 54, C.black);
    rect(70, 4, 54, 54, C.black);
    rect(4, 70, 54, 54, C.black);
    rect(70, 70, 54, 54, C.black);
  } else {
    rect(0, 0, 128, 128, C.frame);
    rect(4, 4, 58, 58, C.yellow);
    rect(66, 4, 58, 58, C.cyan);
    rect(4, 66, 58, 58, C.red);
    rect(66, 66, 58, 58, C.green);
  }
  return png(size, px);
}

/** An .ico holding PNG images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// App icon: the mark with a margin, like other Mac and Windows app icons.
writeFileSync(path.join(out, "icon.png"), draw(1024, 824));
writeFileSync(path.join(out, "trayTemplate.png"), draw(16, 14, { mono: true }));
writeFileSync(path.join(out, "trayTemplate@2x.png"), draw(32, 28, { mono: true }));
writeFileSync(path.join(out, "tray.ico"), ico([16, 24, 32, 48].map((size) => ({ size, data: draw(size, size) }))));
writeFileSync(path.join(out, "tray.png"), draw(32, 32));
console.log("Icons written to", out);
