// One "Language" setting in the app (Settings → Language) for voice dictation,
// 🎙 Speak tasks and the daily brief. "Automatic" sends nothing, so those work
// as before. Keep this list in sync with the app (lib/voiceLanguage.ts).
// Names come from the meeting notes' SUMMARY_LANGUAGES.

import { SUMMARY_LANGUAGES } from "./ai";

export const VOICE_LANGUAGES = ["en", "hi", "hinglish", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "ur"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];
export const isVoiceLanguage = (x: unknown): x is VoiceLanguage => typeof x === "string" && (VOICE_LANGUAGES as readonly string[]).includes(x);

/**
 * ISO 639-1 codes Whisper may be told to expect (/api/ai/transcribe, X-ProdLi-Language).
 * Hinglish is sent as "hi": Whisper writes it in Devanagari and the dictation
 * clean-up turns it into Latin letters (see dictationLanguageText).
 */
export const WHISPER_LANGUAGES = ["en", "hi", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "ur"] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];
export const isWhisperLanguage = (x: unknown): x is WhisperLanguage => typeof x === "string" && (WHISPER_LANGUAGES as readonly string[]).includes(x);

type Scripted = Exclude<VoiceLanguage, "en" | "hinglish">;
const SCRIPT: Record<Scripted, string> = {
  hi: "Devanagari",
  mr: "Devanagari",
  bn: "Bengali",
  te: "Telugu",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Gurmukhi",
  ur: "Urdu (Perso-Arabic)",
};

export const languageName = (code: VoiceLanguage): string => (code === "hinglish" ? "Hinglish" : SUMMARY_LANGUAGES[code]);
export const languageScript = (code: Scripted): string => SCRIPT[code];

const HINGLISH = `Hinglish (Hindi mixed with English), written in Latin letters the way people type Hindi in chats`;

/** Dictation clean-up: which language was spoken and which script to write it in. */
export function dictationLanguageText(code: VoiceLanguage | undefined): string {
  if (!code) return "";
  if (code === "en") return "Language: English.";
  if (code === "hinglish")
    return `Language: ${HINGLISH} ("kal meeting hai, main 5 baje aaunga"). Write the whole text in Latin letters: if the dictation is in Devanagari, transliterate it; write English words with their normal English spelling. Don't translate.`;
  const name = languageName(code);
  return `Language: ${name}. Write it in ${SCRIPT[code]} script, even if the dictation came back in another script (transliterate, don't translate). Names, brands and technical terms the speaker says in English may stay in Latin letters.`;
}

/** 🎙 Speak tasks: keep titles in the spoken language, but the date words in the app's English quick-add words. */
export function tasksLanguageText(code: VoiceLanguage | undefined): string {
  if (!code || code === "en") return "";
  if (code === "hinglish")
    return `The person speaks ${HINGLISH}. Write task titles in Hinglish (Latin letters). Write the when, time, repeating and priority details in the English words above, e.g. "kal shaam 5 baje mummy ko call karna" → "Mummy ko call karna tomorrow at 5pm".`;
  const name = languageName(code);
  return `The person speaks ${name}. Write task titles in ${name}, in ${SCRIPT[code]} script. Write the when, time, repeating and priority details in the English words above so the app can read them, e.g. (Hindi) "कल शाम 5 बजे माँ को फ़ोन करना" → "माँ को फ़ोन करना tomorrow at 5pm".`;
}

/** Daily brief: the same wording as meeting notes in another language. */
export function briefLanguageText(code: VoiceLanguage | undefined): string {
  if (!code || code === "en") return "";
  const how = code === "hinglish" ? HINGLISH : `${languageName(code)} (${SCRIPT[code]} script)`;
  return `Write every text field in ${how}, whatever language the data is in. Translate faithfully; keep people's names, product names, task titles and quoted terms as the user wrote them. Keep times as HH:MM and "kind" values exactly as listed.`;
}
