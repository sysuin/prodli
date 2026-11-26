// Small exports from Notion, Evernote and Google Keep for the notes import
// e2e check (run.mjs → noteImport), written to a temporary folder.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A real 16×16 PNG (solid colour), so the browser can decode and shrink it. */
export function png(r = 200, g = 30, b = 30) {
  const w = 16;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A stored (uncompressed) .zip. */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";
const C = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export function writeNoteFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "prodli-note-import-"));
  const pic = png();
  // Notion: a .zip inside the .zip, like large Notion exports.
  const notionInner = zip({
    [`E2E Home ${A}.md`]: `# E2E Home\n\nOpen [Project plan](E2E%20Home%20${A}/Project%20plan%20${B}.md) or the [Reading list](E2E%20Home%20${A}/Reading%20list%20${C}.csv).\n\n<aside>\n🚀 Ship on Friday\n\n</aside>\n\n![Board](E2E%20Home%20${A}/board.png)\n\n- [x] Draft\n- [ ] Review\n\n<script>window.__pwned = 1</script>\n\n<img src="x" onerror="window.__pwned = 2">\n\n[bad](javascript:window.__pwned=3)`,
    [`E2E Home ${A}/Project plan ${B}.md`]: "# Project plan\n\nBack to [E2E Home](../E2E%20Home%20" + A + ".md).",
    [`E2E Home ${A}/Reading list ${C}.csv`]: "Name,Author\nDune,Herbert\n",
    [`E2E Home ${A}/Reading list ${C}_all.csv`]: "Name,Author\nDune,Herbert\nEmma,Austen\n",
    [`E2E Home ${A}/board.png`]: pic,
  });
  writeFileSync(path.join(dir, "Notion-Export.zip"), zip({ "Export-Part-1.zip": notionInner }));

  const hash = createHash("md5").update(pic).digest("hex");
  writeFileSync(
    path.join(dir, "E2E Notebook.enex"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261101T120000Z" application="Evernote">
<note><title>E2E Packing list</title><created>20261101T093000Z</created><tag>travel</tag>
<content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>For the trip</div><div><en-todo checked="true"/>Passport</div><div><en-todo/>Charger</div><div><en-media hash="${hash}" type="image/png"/></div></en-note>]]></content>
<resource><data encoding="base64">${pic.toString("base64")}</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource>
</note>
</en-export>`,
  );

  const keep = (o) => JSON.stringify({ isTrashed: false, isPinned: false, isArchived: false, textContent: "", title: "", createdTimestampUsec: 1767225600000000, userEditedTimestampUsec: 1767312000000000, ...o });
  writeFileSync(
    path.join(dir, "takeout-keep.zip"),
    zip({
      "Takeout/Keep/E2E Groceries.json": keep({ title: "E2E Groceries", listContent: [{ text: "Eggs", isChecked: true }, { text: "Rice", isChecked: false }], isPinned: true, labels: [{ name: "Home" }], attachments: [{ filePath: "E2E Groceries.png", mimetype: "image/png" }] }),
      "Takeout/Keep/E2E Groceries.png": png(30, 160, 60),
      "Takeout/Keep/E2E Old idea.json": keep({ title: "E2E Old idea", textContent: "Archived", isArchived: true, createdTimestampUsec: 1767225600000002 }),
      "Takeout/Keep/E2E Binned.json": keep({ title: "E2E Binned", textContent: "x", isTrashed: true, createdTimestampUsec: 1767225600000003 }),
    }),
  );
  return dir;
}
