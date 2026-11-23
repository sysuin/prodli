// Read aloud: notes and saved page summaries spoken with the browser's own
// voices (Web Speech API speechSynthesis). Nothing leaves the device and no
// extra permission is needed. One thing speaks at a time: starting a new
// reader stops the old one.

import { storageGet, storageSet } from "./storage";

export const READ_ALOUD_KEY = "readAloudPrefs";
export const MIN_RATE = 0.75;
export const MAX_RATE = 2;
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export interface ReadAloudPrefs {
  /** voiceURI of the chosen voice; empty = the browser's default. */
  voice: string;
  rate: number;
}

export const DEFAULT_PREFS: ReadAloudPrefs = { voice: "", rate: 1 };

export function clampRate(rate: unknown): number {
  const n = typeof rate === "number" && Number.isFinite(rate) ? rate : 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/**
 * A note's HTML as plain text to speak: tags removed, code blocks skipped,
 * each block (heading, paragraph, list item, quote) its own sentence.
 * String-only, so it also works where there's no DOM.
 */
export function htmlToSpeechText(html: string): string {
  let s = html
    .replace(/<(script|style|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|div|tr|td|th)>/gi, "\n")
    .replace(/<(hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)));
      return m;
    });
  const lines = s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    // A line without its own full stop gets one, so headings and list items pause.
    .map((l) => (/[.!?:;…]$/.test(l) ? l : `${l}.`));
  s = lines.join(" ");
  return s;
}

/** Splits text into short pieces (Chrome cuts off very long utterances). */
export function splitForSpeech(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [];
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      // Very long sentence: break at spaces.
      let rest = sentence.trim();
      while (rest.length > max) {
        const cut = rest.lastIndexOf(" ", max);
        const at = cut > max / 2 ? cut : max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      cur = rest ? `${rest} ` : "";
    } else if ((cur + sentence).length > max) {
      push();
      cur = sentence;
    } else cur += sentence;
  }
  push();
  return out;
}

export async function loadReadAloudPrefs(): Promise<ReadAloudPrefs> {
  const p = await storageGet<Partial<ReadAloudPrefs>>(READ_ALOUD_KEY, {});
  return { voice: typeof p.voice === "string" ? p.voice : "", rate: clampRate(p.rate) };
}

export async function saveReadAloudPrefs(p: ReadAloudPrefs): Promise<void> {
  await storageSet(READ_ALOUD_KEY, { voice: p.voice, rate: clampRate(p.rate) });
}

// ── The speaker (one per page) ────────────────────────────────────────────────

export type ReadAloudState = "idle" | "playing" | "paused";

export function readAloudAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

interface Session {
  id: number;
  owner: string;
  chunks: string[];
  index: number;
}

let session: Session | null = null;
let state: ReadAloudState = "idle";
let prefs: ReadAloudPrefs = DEFAULT_PREFS;
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function subscribeReadAloud(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Who is speaking (an owner id) and whether it's playing or paused. */
export function readAloudStatus(): { owner: string | null; state: ReadAloudState } {
  return { owner: session?.owner ?? null, state };
}

function pickVoice(uri: string): SpeechSynthesisVoice | null {
  if (!uri) return null;
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === uri) ?? null;
}

function queueFrom(s: Session, from: number): void {
  const synth = window.speechSynthesis;
  const voice = pickVoice(prefs.voice);
  for (let i = from; i < s.chunks.length; i++) {
    const u = new SpeechSynthesisUtterance(s.chunks[i]);
    u.rate = clampRate(prefs.rate);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onstart = () => {
      if (session?.id === s.id) s.index = i;
    };
    if (i === s.chunks.length - 1) {
      u.onend = u.onerror = () => {
        if (session?.id !== s.id) return; // an older reading that was stopped
        session = null;
        state = "idle";
        emit();
      };
    }
    synth.speak(u);
  }
}

/** Starts reading `text` aloud for `owner` (stops anything else first). */
export function startReading(text: string, owner: string): boolean {
  if (!readAloudAvailable()) return false;
  const chunks = splitForSpeech(text);
  stopReading();
  if (!chunks.length) return false;
  session = { id: ++counter, owner, chunks, index: 0 };
  state = "playing";
  window.speechSynthesis.cancel();
  queueFrom(session, 0);
  emit();
  return true;
}

export function pauseReading(): void {
  if (!session || state !== "playing") return;
  window.speechSynthesis.pause();
  state = "paused";
  emit();
}

export function resumeReading(): void {
  if (!session || state !== "paused") return;
  window.speechSynthesis.resume();
  state = "playing";
  emit();
}

/** Stops reading. With `owner`, only if that owner is the one speaking. */
export function stopReading(owner?: string): void {
  if (!session || (owner && session.owner !== owner)) return;
  session = null;
  state = "idle";
  if (readAloudAvailable()) window.speechSynthesis.cancel();
  emit();
}

/** New voice or speed. While reading, picks up again from the current sentence. */
export function setReadAloudPrefs(next: ReadAloudPrefs): void {
  prefs = { voice: next.voice, rate: clampRate(next.rate) };
  void saveReadAloudPrefs(prefs).catch(() => {});
  if (!session || !readAloudAvailable()) return;
  const s: Session = { ...session, id: ++counter };
  session = s;
  window.speechSynthesis.cancel();
  if (state === "paused") window.speechSynthesis.resume();
  state = "playing";
  queueFrom(s, s.index);
  emit();
}

export function currentReadAloudPrefs(): ReadAloudPrefs {
  return prefs;
}

let prefsLoaded: Promise<ReadAloudPrefs> | null = null;
/** Loads saved voice and speed once per page. */
export function ensureReadAloudPrefs(): Promise<ReadAloudPrefs> {
  prefsLoaded ??= loadReadAloudPrefs()
    .then((p) => (prefs = p))
    .catch(() => prefs);
  return prefsLoaded;
}
