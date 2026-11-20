// Who's talking, for AI transcripts of calls: "You" or "Others".
//
// When the recording includes the microphone, the offscreen recorder gets your
// mic and the call's tab audio as two separate inputs before mixing them. Every
// 100 ms it notes which one has speech (ActivityTracker); after the call, each
// line of the AI transcript gets the speaker who talked most during it
// (labelSpeakers). The recording itself is unchanged, and nothing is sent anywhere.

import type { TranscriptEntry } from "./types";

/** Compact timeline: [startMs, endMs, 0 = you | 1 = others]. */
export type SpeakerActivity = [number, number, 0 | 1][];

export const YOU = "You";
export const OTHERS = "Others";
const FRAME_MS = 100;

/** Tracks speech on the two inputs from RMS levels sampled every 100 ms. */
export class ActivityTracker {
  private floors = [0.004, 0.004];
  private speech = [0.03, 0.03];
  private out: SpeakerActivity = [];

  /** `t`: ms since the recording started; levels are RMS (0–1) of the last frame. */
  push(t: number, mic: number, tab: number): void {
    const levels = [mic, tab];
    const active = levels.map((l, i) => {
      // A slowly adapting noise floor and speech level per input.
      this.floors[i] = l < this.floors[i] ? 0.9 * this.floors[i] + 0.1 * l : Math.min(this.floors[i] * 1.002, 0.05);
      const on = l > Math.max(0.006, this.floors[i] * 3);
      if (on) this.speech[i] = 0.98 * this.speech[i] + 0.02 * l;
      return on;
    });
    let who: 0 | 1 | null = null;
    if (active[0] && active[1]) who = mic / this.speech[0] >= tab / this.speech[1] ? 0 : 1;
    else if (active[0]) who = 0;
    else if (active[1]) who = 1;
    if (who === null) return;
    const last = this.out[this.out.length - 1];
    if (last && last[2] === who && t - last[1] <= FRAME_MS * 3) last[1] = t + FRAME_MS;
    else this.out.push([t, t + FRAME_MS, who]);
  }

  /** The timeline, with blips under 300 ms dropped. */
  result(): SpeakerActivity {
    return this.out.filter(([a, b]) => b - a >= 300);
  }
}

/**
 * Gives each line the speaker who talked most during it ("You" / "Others").
 * Lines with no activity data keep their speaker.
 */
export function labelSpeakers(entries: TranscriptEntry[], activity: SpeakerActivity | undefined): TranscriptEntry[] {
  if (!activity?.length) return entries;
  return entries.map((e) => {
    const end = Math.max(e.endMs, e.startMs + 500);
    let you = 0;
    let others = 0;
    for (const [a, b, who] of activity) {
      if (b <= e.startMs) continue;
      if (a >= end) break;
      const overlap = Math.min(b, end) - Math.max(a, e.startMs);
      if (overlap > 0) who === 0 ? (you += overlap) : (others += overlap);
    }
    if (!you && !others) return e;
    return { ...e, speaker: you >= others ? YOU : OTHERS };
  });
}

/** RMS of an analyser's current frame. */
export function rmsOf(analyser: AnalyserNode, buf: Float32Array): number {
  analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export interface TalkStats {
  youMs: number;
  othersMs: number;
  /** 0–100, your share of the talking. */
  youShare: number;
  /** Your longest stretch without the others talking. */
  longestYouMs: number;
  /** Times the speaker changed. */
  turns: number;
}

/** Talk-time insights from the speaker timeline (Pro). Null with too little speech to judge. */
export function talkStats(activity: SpeakerActivity | undefined): TalkStats | null {
  if (!activity?.length) return null;
  let youMs = 0;
  let othersMs = 0;
  let longestYouMs = 0;
  let run = 0;
  let turns = 0;
  let prev: 0 | 1 | null = null;
  for (const [a, b, who] of activity) {
    const d = b - a;
    if (who === 0) {
      youMs += d;
      run = prev === 0 ? run + d : d;
      longestYouMs = Math.max(longestYouMs, run);
    } else othersMs += d;
    if (prev !== null && prev !== who) turns++;
    prev = who;
  }
  if (youMs + othersMs < 30_000) return null;
  return { youMs, othersMs, youShare: Math.round((100 * youMs) / (youMs + othersMs)), longestYouMs, turns };
}
