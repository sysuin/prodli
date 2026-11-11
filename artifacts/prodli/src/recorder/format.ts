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

/** Captions count as covering a little before and after each line (caption and speech timing differ). */
export const CAPTION_PAD_MS = 4000;
/** Only fill stretches without captions at least this long (shorter ones are just pauses). */
export const MIN_GAP_MS = 12000;

/**
 * Pure: Meet captions with the gaps filled from the on-device transcript.
 *
 * Captions have real speaker names, so they're kept as they are. Where there
 * were no captions for a while (captions turned off for part of the call, or
 * Meet missed something), the on-device lines from that stretch are added,
 * marked `source: "device"` (speakers: You / Others).
 */
export function fillCaptionGaps(captions: TranscriptEntry[], speech: TranscriptEntry[], opts: { padMs?: number; minGapMs?: number } = {}): { transcript: TranscriptEntry[]; filled: number } {
  const pad = opts.padMs ?? CAPTION_PAD_MS;
  const minGap = opts.minGapMs ?? MIN_GAP_MS;
  if (!captions.length || !speech.length) return { transcript: captions.length ? captions : speech, filled: captions.length ? 0 : speech.length };

  // Merge caption lines into covered stretches.
  const covered: { start: number; end: number }[] = [];
  for (const c of [...captions].sort((a, b) => a.startMs - b.startMs)) {
    const start = c.startMs - pad;
    const end = Math.max(c.endMs, c.startMs) + pad;
    const last = covered[covered.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else covered.push({ start, end });
  }
  // The uncovered stretches (before the first caption, between, after the last).
  const gaps: { start: number; end: number }[] = [];
  let cursor = -Infinity;
  for (const c of covered) {
    if (c.start > cursor) gaps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  gaps.push({ start: cursor, end: Infinity });

  const fillers = speech
    .filter((s) => {
      const mid = (s.startMs + Math.max(s.endMs, s.startMs)) / 2;
      const gap = gaps.find((g) => mid >= g.start && mid < g.end);
      if (!gap) return false;
      // Edges are open-ended: before the first and after the last caption always count.
      const length = (Number.isFinite(gap.end) ? gap.end : mid + minGap) - (Number.isFinite(gap.start) ? gap.start : mid - minGap);
      return length >= minGap;
    })
    .map((s) => ({ ...s, id: `device-${s.id}`, source: "device" as const }));

  if (!fillers.length) return { transcript: captions, filled: 0 };
  return { transcript: [...captions, ...fillers].sort((a, b) => a.startMs - b.startMs), filled: fillers.length };
}
