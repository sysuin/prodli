// Draws ProdLi's four-square mark into the PNGs the app stores need, with no
// image libraries (plain zlib + a tiny PNG writer). Run: pnpm icons
//   assets/icon.png           1024×1024, opaque (iOS rejects transparency)
//   assets/adaptive-icon.png  1024×1024, transparent, mark inside Android's safe zone
//   assets/splash-icon.png    512×512, transparent
//   assets/favicon.png        48×48 (web preview)
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const COLORS = { frame: [0, 0, 0, 255], yellow: [255, 215, 0, 255], cyan: [0, 188, 212, 255], red: [255, 107, 107, 255], green: [102, 187, 106, 255] };

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

/** size: canvas; mark: the mark's size; background: RGBA or null (transparent). */
function draw(size, mark, background) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, c) => c.forEach((v, i) => (px[(y * size + x) * 4 + i] = v));
  if (background) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, background);
  const o = Math.round((size - mark) / 2);
  const s = mark / 128; // the mark's own grid is 128 units (see src/ui/Logo.tsx)
  const rect = (x, y, w, h, c) => {
    for (let j = Math.round(o + y * s); j < Math.round(o + (y + h) * s); j++) for (let i = Math.round(o + x * s); i < Math.round(o + (x + w) * s); i++) set(i, j, c);
  };
  rect(0, 0, 128, 128, COLORS.frame);
  rect(4, 4, 58, 58, COLORS.yellow);
  rect(66, 4, 58, 58, COLORS.cyan);
  rect(4, 66, 58, 58, COLORS.red);
  rect(66, 66, 58, 58, COLORS.green);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync(path.join(out, "icon.png"), draw(1024, 1024, COLORS.frame));
writeFileSync(path.join(out, "adaptive-icon.png"), draw(1024, 600, null));
writeFileSync(path.join(out, "splash-icon.png"), draw(512, 512, null));
writeFileSync(path.join(out, "favicon.png"), draw(48, 48, null));
console.log("Icons written to", out);
