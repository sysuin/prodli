// 🎙 Speak tasks: a spoken or pasted brain dump becomes separate to-dos.
// With an account, ProdLi's AI rewrites the ramble as clean quick-add lines
// (/api/ai/extract-tasks); without one, it's split into sentences here. Either
// way each line is read by the normal quick-add parser before anything is
// added, and the user reviews the list first.

import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "./prodliAccount";
import { storageGet } from "./storage";
import { isList } from "./taskLists";
import type { ListItem } from "../types";

export const MAX_DUMP_CHARS = 4000;
export const VOICE_TASKS_EVENT = "prodli-voice-tasks";

/** Splits text into task-sized lines without AI: new lines, sentences, ";" and "also"/"then". */
export function splitLocally(text: string): string[] {
  return text
    .split(/\n+|[.!?;]+(?:\s+|$)|\s+(?:and also|also|and then|then)\s+/i)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^(?:(?:and|also|then|oh|so|plus)[\s,]+)+/i, "").replace(/^(?:i\s+(?:need|have|got)\s+to|remember\s+to|don't\s+forget\s+to)\s+/i, "").trim())
    .filter((s) => s.length > 1)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .slice(0, 30);
}

type Stub = (text: string, lists: string[]) => Promise<{ lines: string[] }>;

/** Lines to add (and why AI wasn't used, if it wasn't). */
export async function linesFromDump(text: string): Promise<{ lines: string[]; ai: boolean; note?: string }> {
  const t = text.trim().slice(0, MAX_DUMP_CHARS);
  if (!t) return { lines: [], ai: false };
  const lists = (await storageGet<ListItem[]>("lists", [])).filter(isList).map((l) => l.name);
  if (import.meta.env.VITE_E2E === "1") {
    const stub = (globalThis as { __prodliExtractStub?: Stub }).__prodliExtractStub;
    if (stub) return { ...(await stub(t, lists)), ai: true };
  }
  if (!accountsEnabled() || !(await getProdliAccount())) return { lines: splitLocally(t), ai: false, note: "Split into sentences on this device. Sign in (free) for smarter task splitting." };
  try {
    const r = await accountRequest<{ lines: string[] }>("/api/ai/extract-tasks", { method: "POST", body: JSON.stringify({ text: t, lists }) }, { write_quota_exceeded: "You've used this month's writing help." });
    return { lines: r.lines, ai: true };
  } catch (err) {
    return { lines: splitLocally(t), ai: false, note: `${err instanceof AccountError ? err.message : "AI didn't work this time."} Split into sentences instead.` };
  }
}

// ── Speech (Chrome's Web Speech API; on this device when Chrome supports it) ──

interface RecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = { new (): RecognitionLike; available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };

export function speechSupported(): boolean {
  const w = globalThis as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/**
 * Starts listening. `onText(finalSoFar, interim)` is called as words arrive.
 * Returns a stop function. Prefers on-device recognition when it's installed.
 */
export async function listen(lang: string, onText: (final: string, interim: string) => void, onEnd: (error?: string) => void): Promise<() => void> {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onEnd("Speech isn't supported in this browser. Type or paste instead.");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  try {
    if (Ctor.available && (await Ctor.available({ langs: [lang], processLocally: true })) === "available") rec.processLocally = true;
  } catch {
    // older Chrome: default recognition
  }
  let final = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += `${r[0].transcript.trim()} `;
      else interim += r[0].transcript;
    }
    onText(final.trim(), interim.trim());
  };
  rec.onerror = (e) => onEnd(e.error === "not-allowed" ? "Microphone access was blocked. Allow it for ProdLi, or type instead." : e.error === "no-speech" ? undefined : `Speech stopped (${e.error}).`);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}
