// Settings → Language: one setting for voice dictation, 🎙 Speak tasks and the
// daily brief. "Automatic" (the default) keeps the old behaviour: Whisper
// detects the language, Speak tasks uses the browser's language, the brief is
// in English. Server: prodli-api/src/languages.ts (keep the codes in sync).
//
// Hinglish: Whisper is told "hi" (Hindi). Forcing "en" on Hindi speech makes
// Whisper translate it into English, and leaving it on auto-detect often gives
// Urdu script. With "hi" every word comes back phonetically in Devanagari, and
// the AI clean-up then writes it in Latin letters (with English words spelled
// as English). Speak tasks uses en-IN, which Chrome writes in Latin letters.

import { storageGet } from "./storage";

export type VoiceLanguage = "auto" | "en" | "hi" | "hinglish" | "bn" | "mr" | "te" | "ta" | "gu" | "kn" | "ml" | "pa" | "ur";

export const VOICE_LANGUAGE_KEY = "voiceLanguage";

export interface VoiceLanguageInfo {
  code: VoiceLanguage;
  /** English name plus the native one, e.g. "Hindi (हिन्दी)". */
  label: string;
  /** ISO 639-1 code for Whisper; null = let Whisper detect it. */
  whisper: string | null;
  /** BCP-47 locale for the browser's speech recognition; null = the browser's language. */
  locale: string | null;
}

export const VOICE_LANGUAGES: VoiceLanguageInfo[] = [
  { code: "auto", label: "Automatic", whisper: null, locale: null },
  { code: "en", label: "English", whisper: "en", locale: null },
  { code: "hi", label: "Hindi (हिन्दी)", whisper: "hi", locale: "hi-IN" },
  { code: "hinglish", label: "Hinglish (Hindi in Latin letters)", whisper: "hi", locale: "en-IN" },
  { code: "bn", label: "Bengali (বাংলা)", whisper: "bn", locale: "bn-IN" },
  { code: "mr", label: "Marathi (मराठी)", whisper: "mr", locale: "mr-IN" },
  { code: "te", label: "Telugu (తెలుగు)", whisper: "te", locale: "te-IN" },
  { code: "ta", label: "Tamil (தமிழ்)", whisper: "ta", locale: "ta-IN" },
  { code: "gu", label: "Gujarati (ગુજરાતી)", whisper: "gu", locale: "gu-IN" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)", whisper: "kn", locale: "kn-IN" },
  { code: "ml", label: "Malayalam (മലയാളം)", whisper: "ml", locale: "ml-IN" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)", whisper: "pa", locale: "pa-IN" },
  { code: "ur", label: "Urdu (اردو)", whisper: "ur", locale: "ur-IN" },
];

const BY_CODE = new Map(VOICE_LANGUAGES.map((l) => [l.code, l]));
export const isVoiceLanguage = (x: unknown): x is VoiceLanguage => typeof x === "string" && BY_CODE.has(x as VoiceLanguage);
export const voiceLanguageInfo = (code: VoiceLanguage): VoiceLanguageInfo => BY_CODE.get(code) ?? VOICE_LANGUAGES[0];

/** The saved language ("auto" if none, or if the saved value isn't one we know). */
export async function getVoiceLanguage(): Promise<VoiceLanguage> {
  const v = await storageGet<unknown>(VOICE_LANGUAGE_KEY, "auto");
  return isVoiceLanguage(v) ? v : "auto";
}

/**
 * The locale for Chrome's speech recognition (🎙 Speak tasks). Automatic uses the
 * browser's language; English keeps the browser's English variant (en-GB, en-IN…).
 */
export function speechLocale(code: VoiceLanguage, browserLanguage = typeof navigator !== "undefined" ? navigator.language : ""): string {
  const fallback = browserLanguage || "en-US";
  if (code === "auto") return fallback;
  if (code === "en") return /^en(-|$)/i.test(fallback) ? fallback : "en-US";
  return voiceLanguageInfo(code).locale ?? fallback;
}

/** The code Whisper gets (?language=), or undefined on Automatic. Hinglish → "hi". */
export const whisperLanguage = (code: VoiceLanguage): string | undefined => voiceLanguageInfo(code).whisper ?? undefined;

/** What the AI steps (dictation clean-up, Speak tasks) get, or undefined on Automatic. */
export const aiLanguage = (code: VoiceLanguage): Exclude<VoiceLanguage, "auto"> | undefined => (code === "auto" ? undefined : code);

/** What the daily brief gets: only when it isn't Automatic or English (the brief is in English by default). */
export const briefLanguage = (code: VoiceLanguage): Exclude<VoiceLanguage, "auto" | "en"> | undefined => (code === "auto" || code === "en" ? undefined : code);
