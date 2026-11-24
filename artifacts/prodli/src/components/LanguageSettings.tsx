// Settings → Language: one language for voice dictation, 🎙 Speak tasks and
// the daily brief (lib/voiceLanguage.ts). Free, like dictation and the brief.
// Also shown in Settings → Dictation (compact).

import { useEffect, useId, useState, type CSSProperties } from "react";
import { onStorageChange, storageSet } from "../lib/storage";
import { getVoiceLanguage, isVoiceLanguage, VOICE_LANGUAGE_KEY, VOICE_LANGUAGES, type VoiceLanguage } from "../lib/voiceLanguage";

const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 13, padding: "6px 8px", boxSizing: "border-box", minWidth: 0 };
const muted: CSSProperties = { fontSize: 12, opacity: 0.85, margin: 0 };

export function LanguageSettings({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const [lang, setLang] = useState<VoiceLanguage>("auto");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getVoiceLanguage().then(setLang);
    return onStorageChange<unknown>(VOICE_LANGUAGE_KEY, (v) => setLang(isVoiceLanguage(v) ? v : "auto"));
  }, []);
  const choose = (v: VoiceLanguage) => {
    setLang(v);
    void storageSet(VOICE_LANGUAGE_KEY, v);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div data-testid="language-settings" style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor={`${id}-lang`} style={{ fontWeight: 800 }}>
          Language
        </label>
        <select id={`${id}-lang`} value={lang} onChange={(e) => choose(e.target.value as VoiceLanguage)} style={field}>
          {VOICE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <span role="status" style={{ fontSize: 11, opacity: 0.75 }}>
          {saved ? "Saved" : ""}
        </span>
      </div>
      <p style={muted}>
        {compact
          ? "The language you speak. Also used by 🎙 Speak tasks and the daily brief (Settings → Language)."
          : "The language you speak to dictation and 🎙 Speak tasks, and the language of your daily brief on Today."}
      </p>
      {!compact && <p style={muted}>Automatic: ProdLi works out the language from your speech, and the brief is in English.</p>}
      {lang === "hinglish" && <p style={muted}>Hinglish: dictation writes Hindi in Latin letters when AI polish is on (Settings → Dictation).</p>}
    </div>
  );
}
