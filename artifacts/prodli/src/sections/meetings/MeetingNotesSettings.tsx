// Setup → "Meeting notes": the default meeting type, the word list (names and
// terms to spell exactly) and the heads-up message people paste into the chat.

import { useEffect, useId, useState, type CSSProperties } from "react";
import { storageGet, storageSet } from "../../lib/storage";
import { AUTO_POST_DISCLOSURE_STORAGE_KEY, DEFAULT_DISCLOSURE, DISCLOSURE_STORAGE_KEY, MEETING_TEMPLATE_STORAGE_KEY, MEETING_TEMPLATES, parseVocabulary, SUMMARY_LANGUAGE_STORAGE_KEY, SUMMARY_LANGUAGES, VOCABULARY_STORAGE_KEY, type CustomTemplateRef, type MeetingTemplate } from "../../recorder/types";
import { ProBadge } from "../../components/Pro";
import { CustomTemplates, useCustomTemplates } from "./CustomTemplates";
import { TemplateRules } from "./TemplateRules";
import { AUDIO_RETENTION_CHOICES, cleanRetention, DEFAULT_RETENTION, MEETING_RETENTION_CHOICES, RETENTION_KEY, type MeetingRetention } from "../../recorder/retention";

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
  const [autoPost, setAutoPost] = useState(false);
  const [retention, setRetention] = useState<MeetingRetention>(DEFAULT_RETENTION);

  useEffect(() => {
    void storageGet<MeetingTemplate | CustomTemplateRef>(MEETING_TEMPLATE_STORAGE_KEY, "general").then(setTemplate);
    void storageGet<string[]>(VOCABULARY_STORAGE_KEY, []).then((w) => setWords(w.join(", ")));
    void storageGet<string>(SUMMARY_LANGUAGE_STORAGE_KEY, "").then(setLanguage);
    void storageGet<string>(DISCLOSURE_STORAGE_KEY, "").then((m) => setMessage(m || DEFAULT_DISCLOSURE));
    void storageGet<boolean>(AUTO_POST_DISCLOSURE_STORAGE_KEY, false).then(setAutoPost);
    void storageGet<MeetingRetention>(RETENTION_KEY, DEFAULT_RETENTION).then((r) => setRetention(cleanRetention(r)));
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
      <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, marginTop: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autoPost}
          data-testid="auto-post-disclosure"
          onChange={(e) => {
            setAutoPost(e.target.checked);
            saveMessage();
            void storageSet(AUTO_POST_DISCLOSURE_STORAGE_KEY, e.target.checked);
          }}
        />
        <span>Post it in the Google Meet chat when I start recording. (Zoom and Teams: use Copy heads-up.)</span>
      </label>

      <div style={{ ...sub, marginTop: 14 }}>Auto-delete</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 11 }}>
          Recordings (audio)
          <select
            value={retention.audioDays}
            data-testid="retention-audio"
            onChange={(e) => {
              const next = { ...retention, audioDays: Number(e.target.value) };
              setRetention(next);
              void storageSet(RETENTION_KEY, next);
            }}
            style={{ ...field, marginTop: 3 }}
          >
            {AUDIO_RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>{d ? `Delete after ${d} days` : "Keep"}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11 }}>
          Whole meetings
          <select
            value={retention.meetingDays}
            data-testid="retention-meetings"
            onChange={(e) => {
              const next = { ...retention, meetingDays: Number(e.target.value) };
              setRetention(next);
              void storageSet(RETENTION_KEY, next);
            }}
            style={{ ...field, marginTop: 3 }}
          >
            {MEETING_RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>{d ? `Delete after ${d === 365 ? "1 year" : `${d} days`}` : "Keep"}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>
        Off by default. Deleting recordings keeps transcripts and notes. Deleting whole meetings also removes them from your other devices. Shared links stay until you stop sharing them.
      </div>
    </div>
  );
}
