// A small RFC 4180 CSV reader: quoted fields (with commas, quotes and new
// lines inside), CRLF or LF, a UTF-8 byte-order mark, and comma, semicolon or
// tab separators (Excel in many countries saves CSV with ";").

/** Guesses the separator from the first few lines (outside quotes). */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const sample = text.slice(0, 4000);
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of sample) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts["\t"] > counts[","] && counts["\t"] >= counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/** Rows of cells. Blank lines come back as `[""]` so callers can see section breaks. */
export function parseCsv(input: string, delimiter: string = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Index of the first row containing all `required` headers (case-insensitive), or -1. */
export function findHeaderRow(rows: string[][], required: string[], maxScan = 20): number {
  const want = required.map((h) => h.toLowerCase());
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = rows[i].map((c) => c.trim().toLowerCase());
    if (want.every((h) => cells.includes(h))) return i;
  }
  return -1;
}

/** Rows after the header as objects keyed by the (trimmed) header names. Empty rows are skipped. */
export function rowsToObjects(rows: string[][], headerIndex: number): Record<string, string>[] {
  const header = rows[headerIndex].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(headerIndex + 1)) {
    if (r.every((c) => !c.trim())) continue;
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    out.push(o);
  }
  return out;
}

/** Case-insensitive cell lookup: get(row, "List Name", "list"). */
export function cell(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const k = Object.keys(row).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && row[k]) return row[k];
  }
  return "";
}
