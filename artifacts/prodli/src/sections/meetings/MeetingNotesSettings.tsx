// Setup → "Meeting notes": the default meeting type, the word list (names and
// terms to spell exactly) and the heads-up message people paste into the chat.

import { useEffect, useId, useState, type CSSProperties } from "react";
import { storageGet, storageSet } from "../../lib/storage";
import { DEFAULT_DISCLOSURE, DISCLOSURE_STORAGE_KEY, MEETING_TEMPLATE_STORAGE_KEY, MEETING_TEMPLATES, parseVocabulary, SUMMARY_LANGUAGE_STORAGE_KEY, SUMMARY_LANGUAGES, VOCABULARY_STORAGE_KEY, type CustomTemplateRef, type MeetingTemplate } from "../../recorder/types";
import { ProBadge } from "../../components/Pro";
import { CustomTemplates, useCustomTemplates } from "./CustomTemplates";
import { TemplateRules } from "./TemplateRules";

const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 12, padding: "5px 6px", width: "100%", boxSizing: "border-box" };
const label: CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7 };
const sub: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, margin: "8px 0 3px" };

/** Copies the heads-up message (yours, or the default). Resolves true on success. */
export async function copyDisclosure(): Promise<boolean> {
  const text = (await storageGet<string>(DISCLOSURE_STORAGE_KEY, "")).trim() || DEFAULT_DISCLOSURE;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MeetingNotesSettings() {
  const id = useId();
  const [template, setTemplate] = useState<MeetingTemplate | CustomTemplateRef>("general");
  const customs = useCustomTemplates();
  const [language, setLanguage] = useState("");
  const [words, setWords] = useState("");
  const [message, setMessage] = useState(DEFAULT_DISCLOSURE);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void storageGet<MeetingTemplate | CustomTemplateRef>(MEETING_TEMPLATE_STORAGE_KEY, "general").then(setTemplate);
    void storageGet<string[]>(VOCABULARY_STORAGE_KEY, []).then((w) => setWords(w.join(", ")));
    void storageGet<string>(SUMMARY_LANGUAGE_STORAGE_KEY, "").then(setLanguage);
    void storageGet<string>(DISCLOSURE_STORAGE_KEY, "").then((m) => setMessage(m || DEFAULT_DISCLOSURE));
  }, []);

  const saveWords = () => {
    const list = parseVocabulary(words);
    setWords(list.join(", "));
    void storageSet(VOCABULARY_STORAGE_KEY, list);
  };
  const saveMessage = () => {
    const m = message.trim();
    void storageSet(DISCLOSURE_STORAGE_KEY, m === DEFAULT_DISCLOSURE ? "" : m.slice(0, 500));
  };

  return (
    <div data-testid="meeting-notes-settings">
      <div style={label}>5 · Meeting notes</div>
      <label style={sub} htmlFor={`${id}-type`}>Usual meeting type</label>
      <select
        id={`${id}-type`}
        value={template}
        onChange={(e) => {
          const t = e.target.value as MeetingTemplate | CustomTemplateRef;
          setTemplate(t);
          void storageSet(MEETING_TEMPLATE_STORAGE_KEY, t);
        }}
        style={field}
      >
        {MEETING_TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
        {customs.map((t) => (
          <option key={t.id} value={`custom:${t.id}`}>{t.name} (yours)</option>
        ))}
      </select>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>Shapes what summaries pull out (e.g. Interview: strengths and concerns). Each meeting can pick its own.</div>
      <CustomTemplates />
      <TemplateRules />

      <label style={sub} htmlFor={`${id}-lang`}>
        Notes language
        <ProBadge />
      </label>
      <select
        id={`${id}-lang`}
        value={language}
        onChange={(e) => {
          setLanguage(e.target.value);
          void storageSet(SUMMARY_LANGUAGE_STORAGE_KEY, e.target.value);
        }}
        style={field}
      >
        <option value="">Same as the meeting</option>
        {SUMMARY_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>Summaries are written in this language whatever was spoken; names and terms stay as said. The transcript stays as spoken.</div>

      <label style={sub} htmlFor={`${id}-words`}>Word list: names and terms</label>
      <textarea id={`${id}-words`} value={words} onChange={(e) => setWords(e.target.value)} onBlur={saveWords} rows={2} placeholder="Priya Shah, Flynn, DSR, Kubernetes" style={{ ...field, resize: "vertical" }} />
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>Spelled exactly in summaries and audio transcripts. Captions often mishear names and jargon.</div>

      <label style={sub} htmlFor={`${id}-msg`}>Heads-up message for the chat</label>
      <textarea id={`${id}-msg`} value={message} onChange={(e) => setMessage(e.target.value)} onBlur={saveMessage} rows={2} maxLength={500} style={{ ...field, resize: "vertical" }} />
      <button
        onClick={() => {
          saveMessage();
          void navigator.clipboard.writeText(message.trim() || DEFAULT_DISCLOSURE).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        style={{ marginTop: 6, border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "5px 10px", fontFamily: "inherit", fontWeight: 800, fontSize: 11, textTransform: "uppercase", cursor: "pointer" }}
      >
        {copied ? "Copied ✓" : "Copy heads-up"}
      </button>
    </div>
  );
}
