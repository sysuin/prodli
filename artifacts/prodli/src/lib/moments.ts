// "★ Mark moment": moments the user marks while recording (a button, or
// Alt+Shift+M). They're kept on the meeting as ms offsets from the start,
// shown under Key moments with what was being said, and (Pro) sent with the
// transcript so the summary makes sure to cover them (prodli-api: cleanMoments).

import type { TranscriptEntry } from "../recorder/types";

export const MAX_MARKS = 50;
/** Two marks this close together are one moment (a double press). */
const SAME_MOMENT_MS = 3000;
/** What counts as "what was being said": a little before the press, a little after. */
const BEFORE_MS = 20_000;
const AFTER_MS = 5000;
const MAX_EXCERPT = 400;

/** The meeting's marks with a new one at `atMs` (sorted, no doubles, at most MAX_MARKS). */
export function addMark(marks: number[] | undefined, atMs: number): number[] {
  const list = [...(marks ?? [])];
  const at = Math.max(0, Math.round(atMs));
  if (list.some((m) => Math.abs(m - at) < SAME_MOMENT_MS)) return list.sort((a, b) => a - b);
  if (list.length >= MAX_MARKS) return list.sort((a, b) => a - b);
  return [...list, at].sort((a, b) => a - b);
}

export function removeMark(marks: number[] | undefined, atMs: number): number[] {
  return (marks ?? []).filter((m) => m !== atMs);
}

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export interface Moment {
  atMs: number;
  /** What was said around the mark ("" if the transcript has nothing there). */
  text: string;
}

/** Each mark with the transcript lines spoken around it. */
export function momentExcerpts(transcript: TranscriptEntry[], marks: number[] | undefined): Moment[] {
  return [...(marks ?? [])].sort((a, b) => a - b).map((atMs) => {
    const lines = transcript.filter((e) => e.endMs >= atMs - BEFORE_MS && e.startMs <= atMs + AFTER_MS);
    let text = lines.map((e) => (e.speaker ? `${e.speaker}: ${e.text}` : e.text)).join(" ").replace(/\s+/g, " ").trim();
    // Keep the end (closest to the press) when it's long.
    if (text.length > MAX_EXCERPT) text = `…${text.slice(text.length - MAX_EXCERPT + 1).replace(/^\S*\s/, "")}`;
    return { atMs, text };
  });
}

/** What's sent with a summary: "[mm:ss] what was said", for marks with something said. */
export function momentsForSummary(transcript: TranscriptEntry[], marks: number[] | undefined): string[] {
  return momentExcerpts(transcript, marks).filter((m) => m.text).map((m) => `[${clock(m.atMs)}] ${m.text}`).slice(0, 30);
}
