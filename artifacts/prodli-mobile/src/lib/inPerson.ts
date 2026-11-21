// Saving in-person recordings as meetings. While recording, the transcript so
// far is kept under a phone-only key, so if the app is closed mid-meeting the
// next launch turns what was transcribed into a meeting instead of losing it.
import type { AudioEntry } from "../shared";
import { summarizeMeeting } from "./ai";
import { getAccount } from "./api";
import { inPersonMeeting } from "./liveTranscriber";
import { MEETINGS_KEY, updateMeeting, type Meeting } from "./meetings";
import { read, remove, write } from "./store";

export const IN_PROGRESS_KEY = "mobileRecording";
/** Meetings being summarized right now (phone-only, not synced). */
export const SUMMARIZING_KEY = "mobileSummarizing";

export interface InProgress {
  title: string;
  startedAt: number;
  lastAt: number;
  entries: AudioEntry[];
  failed: number;
}

export const saveProgress = (p: InProgress) => write(IN_PROGRESS_KEY, p);
export const clearProgress = () => remove(IN_PROGRESS_KEY);

/** Adds the meeting (it syncs like any other) and returns it. */
export function saveMeeting(input: { title: string; startedAt: number; endedAt: number; entries: AudioEntry[]; failed: number; notice?: string }): Meeting {
  const m = inPersonMeeting(input) as unknown as Meeting;
  if (input.notice) m.notice = input.notice;
  write(MEETINGS_KEY, [m, ...read<Meeting[]>(MEETINGS_KEY, [])]);
  clearProgress();
  return m;
}

/** Summarizes in the background when signed in; the meeting screen shows it when it arrives. */
export async function summarizeInBackground(m: Meeting): Promise<string | null> {
  if (!getAccount() || !m.transcript.length) return null;
  write(SUMMARIZING_KEY, [...read<string[]>(SUMMARIZING_KEY, []), m.id]);
  try {
    updateMeeting(m.id, { summary: await summarizeMeeting(m) });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateMeeting(m.id, { error: message });
    return message;
  } finally {
    write(SUMMARIZING_KEY, read<string[]>(SUMMARIZING_KEY, []).filter((id) => id !== m.id));
  }
}

/** At start-up: a recording the app was closed during becomes a meeting. */
export function recoverInterruptedRecording(): Meeting | null {
  const p = read<InProgress | null>(IN_PROGRESS_KEY, null);
  if (!p) return null;
  if (!p.entries.length) {
    clearProgress();
    return null;
  }
  const m = saveMeeting({ title: p.title, startedAt: p.startedAt, endedAt: p.lastAt, entries: p.entries, failed: p.failed, notice: "ProdLi was closed during this recording; this is what was transcribed until then." });
  void summarizeInBackground(m);
  return m;
}
