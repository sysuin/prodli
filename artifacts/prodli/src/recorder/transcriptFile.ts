// Meetings → ⬆ Upload recording, with a transcript instead of a recording:
// captions files (.vtt from Zoom, Teams and Google Meet; .srt) and text
// exports (Otter, Fireflies, Granola, or any "Name: what they said" text)
// become a meeting's transcript. Pure (unit-tested); the meeting is made in
// recorder/upload.ts → createTranscriptMeeting.

import type { TranscriptEntry } from "./types";

export const TRANSCRIPT_ACCEPT = ".vtt,.srt,.txt,.md,.sbv";
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

export const isTranscriptFile = (file: { name: string; type?: string }) => /\.(vtt|srt|sbv|txt|md|markdown)$/i.test(file.name) || /^text\/(vtt|plain|markdown)/i.test(file.type ?? "");

export type TranscriptFormat = "captions" | "timed text" | "text";

export interface ParsedTranscript {
  entries: TranscriptEntry[];
  format: TranscriptFormat;
  speakers: string[];
  /** Length in seconds: from the last timestamp, or estimated from the words. */
  durationSec: number;
}

/** "01:02:03.500", "1:02:03,5", "02:03" → ms. */
export function timeToMs(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return ((+(h ?? 0) * 60 + +min) * 60 + +sec) * 1000 + (frac ? Math.round(+`0.${frac}` * 1000) : 0);
}

const WPM_MS = 60_000 / 150; // speaking at ~150 words a minute

const entry = (i: number, speaker: string, text: string, startMs: number, endMs: number): TranscriptEntry => ({ id: `t${i}`, speaker: speaker.trim(), text: text.trim(), startMs, endMs: Math.max(endMs, startMs) });

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/** "Name: words" → the name, when it looks like one (short, no sentence punctuation). */
function splitSpeaker(line: string): { speaker: string; text: string } | null {
  const m = /^([^:]{1,40}?):\s+(.+)$/.exec(line);
  if (!m || /[.!?]/.test(m[1]) || m[1].split(/\s+/).length > 5 || /^https?$/i.test(m[1])) return null;
  return { speaker: m[1].replace(/^\*\*|\*\*$/g, "").trim(), text: m[2] };
}

/** WebVTT / SRT / SBV cues. Consecutive cues from the same speaker are joined. */
function parseCues(text: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    const ti = lines.findIndex((l) => /-->|^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3},\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}$/.test(l));
    if (ti < 0) continue;
    const [a, b] = lines[ti].includes("-->") ? lines[ti].split("-->") : lines[ti].split(/,(?=\d{1,2}:\d{2}:)/);
    const start = timeToMs(a);
    const end = timeToMs((b ?? "").trim().split(/\s+/)[0]);
    if (start === null) continue;
    let raw = lines.slice(ti + 1).join(" ");
    let speaker = "";
    const v = /<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(raw);
    if (v) speaker = v[1];
    raw = stripTags(raw).trim();
    if (!speaker) {
      const s = splitSpeaker(raw);
      if (s) ({ speaker, text: raw } = s);
    }
    if (!raw) continue;
    const prev = out[out.length - 1];
    if (prev && prev.speaker === speaker.trim() && start - prev.endMs < 2000 && prev.text.length < 600) {
      prev.text = `${prev.text} ${raw}`;
      prev.endMs = Math.max(prev.endMs, end ?? start);
    } else out.push(entry(out.length, speaker, raw, start, end ?? start));
  }
  return out;
}

// Header lines that start a speaker's turn, with a time:
//   "Jane Doe  0:05" (Otter), "Jane Doe - 00:01:05" (Fireflies), "Jane (00:05)", "[00:05] Jane:" ...
const HEADER_PATTERNS: RegExp[] = [
  /^\*{0,2}(.{1,60}?)\*{0,2}\s{2,}\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*$/,
  /^\*{0,2}(.{1,60}?)\*{0,2}\s+[-–|]\s+\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*$/,
  /^\*{0,2}(.{1,60}?)\*{0,2}\s*\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*:?\s*$/,
];
// One line per turn, with a time: "00:01:05 Jane: words", "[00:05] Jane: words", "Jane (00:05): words".
const LINE_PATTERNS: RegExp[] = [/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:]{1,40}?):\s+(.+)$/, /^([^:(]{1,40}?)\s*\((\d{1,2}:\d{2}(?::\d{2})?)\):\s+(.+)$/];

function parseTimedText(text: string): TranscriptEntry[] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: TranscriptEntry[] = [];
  let cur: { speaker: string; start: number; lines: string[] } | null = null;
  const push = () => {
    if (cur && cur.lines.join(" ").trim()) out.push(entry(out.length, cur.speaker, cur.lines.join(" "), cur.start, cur.start));
    cur = null;
  };
  let timed = 0;
  for (const line of lines) {
    const t = line.trim();
    const header = HEADER_PATTERNS.map((p) => p.exec(t)).find(Boolean);
    if (header && timeToMs(header[2]) !== null) {
      push();
      cur = { speaker: header[1].replace(/^#+\s*/, ""), start: timeToMs(header[2])!, lines: [] };
      timed++;
      continue;
    }
    const one = LINE_PATTERNS.map((p, i) => ({ m: p.exec(t), i })).find((x) => x.m);
    if (one?.m) {
      const [, x, y, words] = one.m;
      const [time, speaker] = one.i === 0 ? [x, y] : [y, x];
      if (timeToMs(time) !== null) {
        push();
        out.push(entry(out.length, speaker, words, timeToMs(time)!, timeToMs(time)!));
        timed++;
        continue;
      }
    }
    if (cur && t) cur.lines.push(t);
  }
  push();
  if (timed < 2) return null;
  // Each turn lasts until the next one starts.
  for (let i = 0; i < out.length; i++) out[i].endMs = i + 1 < out.length ? Math.max(out[i].startMs, out[i + 1].startMs) : out[i].startMs + out[i].text.split(/\s+/).length * WPM_MS;
  return out;
}

/** Untimed text: "Name: words" turns (Granola's "Me:" / "Them:"), or paragraphs. Times are estimated from the words. */
function parsePlainText(text: string): TranscriptEntry[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^(-{3,}|\*{3,})$/.test(l));
  const turns: { speaker: string; text: string }[] = [];
  const named = lines.filter((l) => splitSpeaker(l)).length;
  if (named >= Math.max(2, lines.length * 0.3)) {
    for (const l of lines) {
      const s = splitSpeaker(l);
      if (s) turns.push(s);
      else if (turns.length) turns[turns.length - 1].text += ` ${l}`;
      else turns.push({ speaker: "", text: l });
    }
  } else {
    for (const p of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
      const t = p.replace(/\s+/g, " ").trim();
      if (t && !/^#{1,6}\s/.test(t)) turns.push({ speaker: "", text: t });
    }
  }
  let at = 0;
  return turns.map((t, i) => {
    const ms = Math.max(1000, t.text.split(/\s+/).length * WPM_MS);
    const e = entry(i, t.speaker, t.text, at, at + ms);
    at += ms;
    return e;
  });
}

export function parseTranscript(text: string): ParsedTranscript {
  const clean = text.replace(/^﻿/, "");
  let entries: TranscriptEntry[];
  let format: TranscriptFormat;
  if (/^WEBVTT/.test(clean.trim()) || /\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(clean) || /^\d{1,2}:\d{2}:\d{2}\.\d{3},\d{1,2}:\d{2}:\d{2}\.\d{3}$/m.test(clean)) {
    entries = parseCues(clean);
    format = "captions";
  } else {
    const timed = parseTimedText(clean);
    entries = timed ?? parsePlainText(clean);
    format = timed ? "timed text" : "text";
  }
  entries = entries.filter((e) => e.text).map((e, i) => ({ ...e, id: `t${i}` }));
  const speakers = [...new Set(entries.map((e) => e.speaker).filter(Boolean))];
  const last = entries[entries.length - 1];
  return { entries, format, speakers, durationSec: last ? Math.round(last.endMs / 1000) : 0 };
}
