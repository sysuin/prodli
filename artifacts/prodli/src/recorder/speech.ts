// On-device live transcription with Chrome's built-in speech recognition
// (Web Speech API with `processLocally: true` and a MediaStreamTrack input).
//
// Used when Google Meet captions aren't available. Audio never leaves the
// computer: Chrome downloads a free language pack once (the user clicks
// "Download" in Meetings → Setup), then recognition runs locally.

import type { TranscriptEntry } from "./types";

type SR = {
  new (): SpeechRecognitionLike;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (opts: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSR(): SR | null {
  const w = globalThis as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechAvailability = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

/** Whether on-device recognition for `lang` is ready, needs a download, or isn't possible. */
export async function speechAvailability(lang: string): Promise<SpeechAvailability> {
  const sr = getSR();
  if (!sr?.available) return "unsupported";
  try {
    return (await sr.available({ langs: [lang], processLocally: true })) as SpeechAvailability;
  } catch {
    return "unsupported";
  }
}

/** Downloads the language pack. Must be called from a click (user gesture). */
export async function installSpeech(lang: string): Promise<boolean> {
  const sr = getSR();
  if (!sr?.install) return false;
  return sr.install({ langs: [lang], processLocally: true });
}

/**
 * Transcribes one audio track continuously. Chrome ends a recognition
 * session after silences or time limits, so it's restarted until stop().
 * Chrome may never mark on-device results as final, so the latest text of
 * each result is treated as its final text.
 */
export class LiveTranscriber {
  private rec: SpeechRecognitionLike | null = null;
  private session = 0;
  private stopped = false;
  private entries = new Map<string, TranscriptEntry>();
  private ended: Promise<void> = Promise.resolve();

  constructor(
    private track: MediaStreamTrack,
    private speaker: string,
    private lang: string,
    private startedAtMs: number,
    private onChange?: () => void,
  ) {}

  start(): boolean {
    const sr = getSR();
    if (!sr) return false;
    this.stopped = false;
    this.begin(sr);
    return true;
  }

  private begin(sr: SR) {
    const rec = new sr();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = true;
    const session = ++this.session;
    rec.onresult = (e) => {
      const now = Date.now() - this.startedAtMs;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        const id = `${this.speaker}-${session}-${i}`;
        const existing = this.entries.get(id);
        this.entries.set(id, existing ? { ...existing, text, endMs: now } : { id, speaker: this.speaker, text, startMs: now, endMs: now });
      }
      this.onChange?.();
    };
    let resolveEnded: () => void = () => {};
    this.ended = new Promise((r) => (resolveEnded = r));
    rec.onerror = (e) => {
      // "no-speech"/"aborted" are routine; other errors end this session and we retry.
      if (e.error === "not-allowed" || e.error === "language-not-supported") this.stopped = true;
    };
    rec.onend = () => {
      resolveEnded();
      if (!this.stopped && this.track.readyState === "live") setTimeout(() => !this.stopped && this.begin(sr), 250);
    };
    try {
      rec.start(this.track);
      this.rec = rec;
    } catch {
      this.stopped = true;
      resolveEnded();
    }
  }

  /** Stops and waits briefly for the last results. */
  async stop(): Promise<TranscriptEntry[]> {
    this.stopped = true;
    try {
      this.rec?.stop();
    } catch {
      // already stopped
    }
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 2500))]);
    return this.list();
  }

  list(): TranscriptEntry[] {
    return [...this.entries.values()];
  }
}

/** Merges several speakers' entries into one transcript in time order. */
export function mergeSpeechEntries(...lists: TranscriptEntry[][]): TranscriptEntry[] {
  return lists.flat().sort((a, b) => a.startMs - b.startMs);
}
