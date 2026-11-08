// Formatting helpers shared by the Meetings UI and the summarizer (kept apart
// from summarize.ts so the UI doesn't have to load the Claude SDK).

import type { TranscriptEntry } from "./types";

/** Claude Haiku 5.5 — the lowest-cost Claude model. */
export const SUMMARY_MODEL = "claude-haiku-5-5";

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function transcriptToText(transcript: TranscriptEntry[]): string {
  return transcript.map((e) => `[${formatTimestamp(e.startMs)}] ${e.speaker}: ${e.text}`).join("\n");
}
