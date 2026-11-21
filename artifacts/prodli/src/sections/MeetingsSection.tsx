import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { onStorageChange, storageGet, storageRemove, storageSet } from "../lib/storage";
import { generateId } from "../lib/utils";
import type { Note, Todo } from "../types";
import { deleteMeeting, getAudio, listMeetings, MEETINGS_CHANNEL, updateMeeting } from "../recorder/db";
import { canUseProdliAi, SIGN_IN_FOR_SUMMARIES, summarizeMeeting } from "../recorder/summarize";
import { openAsk } from "../lib/ask";
import { OPEN_ITEM_EVENT, OPEN_MEETING_KEY } from "../lib/askOpen";
import { accountsEnabled, getAiUsage, onProdliAccountChange, type AiUsage } from "../lib/prodliAccount";
import { formatTimestamp, SUMMARY_MODEL, transcriptToText } from "../recorder/format";
import { installSpeech, speechAvailability, type SpeechAvailability } from "../recorder/speech";
import { FollowUpDraft } from "./meetings/FollowUpDraft";
import { ShareMeeting } from "./meetings/ShareMeeting";
import { TalkTime } from "./meetings/TalkTime";
import { KeyMoments } from "./meetings/KeyMoments";
import { Coach } from "./meetings/Coach";
import { YourNotes } from "./meetings/YourNotes";
import { meetingToMarkdown } from "../lib/meetingExport";
import { RECORD_NUDGE_KEY } from "../lib/recordNudge";
import { downloadText, safeFileName } from "../lib/markdownExport";
import { MeetingInsights } from "./meetings/MeetingInsights";
import { Decisions } from "./meetings/Decisions";
import { ActionItems } from "./meetings/ActionItems";
import { Series } from "./meetings/Series";
import { meetingSeries } from "../lib/meetingPrep";
import { useCustomTemplates } from "./meetings/CustomTemplates";
import { AudioTranscribe } from "./meetings/AudioTranscribe";
import { copyDisclosure, MeetingNotesSettings } from "./meetings/MeetingNotesSettings";
import { isPlaceholderTitle, PLATFORM_LABEL } from "../recorder/calls";
import { InPersonBar, InPersonButton } from "./meetings/InPerson";
import { callRecordingSupported, recoverInPerson } from "../recorder/inPerson";

const SPEECH_LANGS: { code: string; label: string }[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "हिन्दी (Hindi)" },
  { code: "es-ES", label: "Español" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
  { code: "it-IT", label: "Italiano" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
  { code: "zh-CN", label: "中文 (简体)" },
];
import {
  AUTO_SUMMARIZE_STORAGE_KEY,
  AUTO_TRANSCRIBE_STORAGE_KEY,
  RECORD_ANY_TAB_STORAGE_KEY,
  SHOW_INDICATOR_STORAGE_KEY,
  MIC_ENABLED_STORAGE_KEY,
  SPEECH_ENABLED_STORAGE_KEY,
  SPEECH_LANG_STORAGE_KEY,
  RECORDER_PERMISSIONS,
  RECORDING_STATE_KEY,
  MEETING_TEMPLATES,
  type MeetingTemplate,
  type CustomTemplateRef,
  type ActionItem,
  type BackgroundMessage,
  type Meeting,
  type RecordingState,
} from "../recorder/types";

const ACCENT = "#FF4FA3";

const NO_AI_HINT = SIGN_IN_FOR_SUMMARIES;

/** Does the meeting match a search (title, summary, transcript)? */
export function meetingMatches(m: Meeting, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const s = m.summary;
  const hay = [m.title, s?.title, s?.overview, ...(s?.customSections ?? []).flatMap((c) => [c.heading, ...c.points]), ...(s?.keyPoints ?? []), ...(s?.decisions ?? []), ...(s?.actionItems ?? []).map((a) => a.task), m.userNotes, ...m.transcript.map((e) => `${e.speaker} ${e.text}`)];
  return hay.some((h) => h?.toLowerCase().includes(q));
}

function isExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.permissions;
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function btn(variant: "primary" | "plain" | "danger" = "plain", disabled = false): CSSProperties {
  return {
    border: "var(--nb-border)",
    boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
    background: variant === "primary" ? ACCENT : variant === "danger" ? "#FF6B6B" : "hsl(var(--card))",
    color: variant === "plain" ? "hsl(var(--foreground))" : "#000",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
}

const card: CSSProperties = {
  border: "var(--nb-border)",
  boxShadow: "var(--nb-shadow-sm)",
  background: "hsl(var(--card))",
  padding: 16,
};

const label: CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7 };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...label, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "info" | "warn" | "error"; children: ReactNode }) {
  const bg = tone === "error" ? "#FFCDD2" : tone === "warn" ? "#FFF3B0" : "#D7F5FF";
  return (
    <div style={{ border: "var(--nb-border)", background: bg, color: "#000", padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** "Weekly sync-audio.webm": the meeting's name plus an extension that matches how the audio was recorded. */
export function audioFileName(m: Pick<Meeting, "title" | "audioMimeType"> & { summary?: { title?: string } | null }): string {
  const base = (m.summary?.title || m.title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "meeting";
  const type = (m.audioMimeType ?? "").toLowerCase();
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
  return `${base}-audio.${ext}`;
}

function actionItemTitle(item: ActionItem): string {
  return item.owner ? `${item.task} (${item.owner})` : item.task;
}

function meetingToNoteHtml(m: Meeting): string {
  const s = m.summary;
  const date = new Date(m.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "<p>None</p>");
  let html = `<h1>${escapeHtml(s?.title || m.title)}</h1><p><em>${escapeHtml(date)} · ${formatDuration(m.durationSec)} · ${PLATFORM_LABEL[m.platform] ?? "Google Meet"}</em></p>`;
  if (s) {
    html += `<h2>Summary</h2><p>${escapeHtml(s.overview)}</p>`;
    for (const c of s.customSections ?? []) if (c.points.length) html += `<h2>${escapeHtml(c.heading)}</h2>${list(c.points)}`;
    html += `<h2>Key points</h2>${list(s.keyPoints)}`;
    html += `<h2>Decisions</h2>${list(s.decisions)}`;
    html += `<h2>Action items</h2>${
      s.actionItems.length
        ? `<ul data-type="taskList">${s.actionItems
            .map((a) => `<li data-type="taskItem" data-checked="false"><p>${escapeHtml(`${actionItemTitle(a)}${a.dueDate ? ` — due ${a.dueDate}` : ""}`)}</p></li>`)
            .join("")}</ul>`
        : "<p>None</p>"
    }`;
    if (s.openQuestions.length) html += `<h2>Open questions</h2>${list(s.openQuestions)}`;
  } else {
    html += `<h2>Transcript</h2>${m.transcript.map((e) => `<p><strong>${escapeHtml(e.speaker)}:</strong> ${escapeHtml(e.text)}</p>`).join("")}`;
  }
  return html;
}

// ── Setup panel ───────────────────────────────────────────────────────────────

function SetupPanel({
  indicator,
  onToggleIndicator,
  recorderOn,
  onToggleRecorder,
  micOn,
  onToggleMic,
  autoSummarize,
  onToggleAuto,
  speech,
  ai,
}: {
  ai: { signedIn: boolean; usage: AiUsage | null };
  indicator: boolean;
  onToggleIndicator: () => void;
  recorderOn: boolean;
  onToggleRecorder: () => void;
  micOn: boolean;
  onToggleMic: () => void;
  autoSummarize: boolean;
  onToggleAuto: () => void;
  speech: { on: boolean; lang: string; status: SpeechAvailability | "checking" | "installing"; toggle: () => void; setLang: (l: string) => void; install: () => void };
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ ...card, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 16 }}>
      <div>
        <div style={label}>1 · AI summaries</div>
        {ai.signedIn ? (
          <p style={{ fontSize: 13, marginTop: 8, fontWeight: 700 }} data-testid="ai-allowance">
            ✓ Included with your ProdLi account
            {ai.usage ? ` — ${Math.max(0, ai.usage.limit - ai.usage.used)} of ${ai.usage.limit} free this month.` : "."}
          </p>
        ) : (
          <p style={{ fontSize: 13, marginTop: 8 }}>{SIGN_IN_FOR_SUMMARIES}</p>
        )}
        <p style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
          Summary, decisions, action items and open questions, written by {SUMMARY_MODEL}. Only the transcript is sent to make the summary. Audio stays on this computer unless it's transcribed with AI: when you choose 🌐 Transcribe audio with AI, or after a call other than Meet (step 3).
        </p>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={autoSummarize} onChange={onToggleAuto} /> Summarize automatically when a meeting ends
        </label>
      </div>

      <div>
        <div style={label}>2 · Recorder</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          {recorderOn ? <strong style={{ fontSize: 13 }}>✓ On for Meet, Zoom, Teams, Webex, Slack, Discord and more</strong> : null}
          <button style={btn(recorderOn ? "plain" : "primary")} onClick={onToggleRecorder}>
            {recorderOn ? "Turn off" : "Turn on recorder"}
          </button>
        </div>
        <p style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Chrome will ask to let ProdLi capture tab audio and read captions on meet.google.com. Other call apps need nothing more.</p>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={micOn} onChange={onToggleMic} /> Include my microphone in the audio recording
        </label>
        <p data-testid="mic-hint" style={{ fontSize: 12, margin: "2px 0 0 22px", opacity: 0.8 }}>Needed for calls other than Meet (Zoom, Teams, Webex, Slack, Discord…): ProdLi records the call's tab, which plays only the other people. Without it, your own voice isn't in the recording (ProdLi warns you when a call starts). Meet doesn't need it: its captions include you.</p>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          <input type="checkbox" checked={indicator} onChange={onToggleIndicator} style={{ marginTop: 3 }} />
          <span>
            Show a small “recording” label in the call
            <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>Only you see it. Chrome’s red dot on the tab and REC on the ProdLi icon show recording either way.</span>
          </span>
        </label>
        {recorderOn && <RecordNudgeSetting />}
      </div>

      <div>
        <div style={label}>3 · How to record</div>
        <ol style={{ fontSize: 13, paddingLeft: 18, marginTop: 8, lineHeight: 1.6, listStyle: "decimal" }}>
          <li>Join a call in the browser: <strong>Google Meet</strong>, <strong>Zoom</strong>, <strong>Microsoft Teams</strong>, <strong>Webex</strong>, a <strong>Slack</strong> huddle, a <strong>Discord</strong> call, <strong>Jitsi</strong> or <strong>Whereby</strong>. For any other call app, turn on “Record any website” below.</li>
          <li>Click the <strong>ProdLi icon</strong> in the toolbar (pin it), or press <strong>Alt+Shift+R</strong>.</li>
          <li>On Meet, ProdLi turns on Meet’s captions (only you see them) and takes notes from them. On the other apps it records the call’s audio. No bot joins the call.</li>
          <li>To stop, click the ProdLi icon again (or Alt+Shift+R), or just leave the call.</li>
        </ol>
        <p data-testid="captions-requirement" style={{ fontSize: 12, marginTop: 8, padding: "6px 8px", border: "var(--nb-border)", background: "#FFF3CD", color: "#000", fontWeight: 600 }}>
          Transcripts come from Meet’s captions (CC). If captions are off, only the audio is recorded — the ProdLi icon shows an amber <strong>CC</strong> and a note appears in the call. Set the caption language in Meet (CC → settings) to the language people speak.
        </p>
        <AutoTranscribeSetting />
        <AnyTabSetting />
      </div>

      <div>
        <div style={label}>4 · When captions are off or miss something</div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          <input type="checkbox" checked={speech.on} onChange={speech.toggle} disabled={speech.status === "unsupported"} /> Transcribe on this computer
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <select
            aria-label="Transcription language"
            value={speech.lang}
            onChange={(e) => speech.setLang(e.target.value)}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "4px 6px" }}
          >
            {SPEECH_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          {(speech.status === "downloadable" || speech.status === "installing" || speech.status === "downloading") && (
            <button style={btn("primary", speech.status !== "downloadable")} disabled={speech.status !== "downloadable"} onClick={speech.install}>
              {speech.status === "downloadable" ? "Download speech model (free)" : "Downloading…"}
            </button>
          )}
          {speech.status === "available" && <strong style={{ fontSize: 12 }}>✓ Ready</strong>}
        </div>
        <p style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
          {speech.status === "unsupported" || speech.status === "unavailable"
            ? "On-device transcription isn't available in this browser or language. Use Meet captions instead."
            : "Uses Chrome's built-in speech recognition. Audio never leaves your computer. It's used when captions are off, and to fill gaps where captions missed part of the call. Speakers are labelled You (your mic) and Others (the call)."}
        </p>
      </div>

      <div>
        <div style={label}>Recording laws</div>
        <p style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
          Some places (e.g. California, Florida, Illinois, much of the EU) require everyone's consent to record. You're responsible for following the rules where you and the other participants are.
        </p>
        <button
          style={btn()}
          onClick={() => {
            void copyDisclosure().then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy a heads-up message"}
        </button>
      </div>

      <MeetingNotesSettings />
    </div>
  );
}

/** Calls other than Meet: transcribe the recording with AI right after the call. */
function AutoTranscribeSetting() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    void storageGet<boolean>(AUTO_TRANSCRIBE_STORAGE_KEY, true).then(setOn);
  }, []);
  return (
    <label data-testid="auto-transcribe" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          void storageSet(AUTO_TRANSCRIBE_STORAGE_KEY, e.target.checked);
        }}
        style={{ marginTop: 3 }}
      />
      <span>
        Calls other than Meet: transcribe the recording with AI after the call
        <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>Zoom, Teams, Webex, Slack, Discord and other apps have no captions ProdLi can read, so the call’s audio is sent to ProdLi’s AI (Whisper) when the call ends. Uses your monthly audio minutes; needs a free ProdLi account. Off: the audio stays on this computer and on-device transcription (step 4) is used if it’s on.</span>
      </span>
    </label>
  );
}

/** "Record any website": the ProdLi icon records any tab, for call apps ProdLi doesn't recognise. */
function RecordNudgeSetting() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    void storageGet<boolean>(RECORD_NUDGE_KEY, true).then(setOn);
    return onStorageChange(RECORD_NUDGE_KEY, () => void storageGet<boolean>(RECORD_NUDGE_KEY, true).then(setOn));
  }, []);
  return (
    <label data-testid="record-nudge" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600, marginTop: 6 }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          void storageSet(RECORD_NUDGE_KEY, e.target.checked);
        }}
        style={{ marginTop: 3 }}
      />
      <span>
        Remind me to record when I join a call
        <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>Once per meeting, about 45 seconds after you join a Meet, Zoom, Jitsi or Whereby meeting without recording.</span>
      </span>
    </label>
  );
}

function AnyTabSetting() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void storageGet<boolean>(RECORD_ANY_TAB_STORAGE_KEY, false).then(setOn);
  }, []);
  return (
    <label data-testid="record-any-tab" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          void storageSet(RECORD_ANY_TAB_STORAGE_KEY, e.target.checked);
        }}
        style={{ marginTop: 3 }}
      />
      <span>
        Record any website when I click the ProdLi icon
        <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>For call apps ProdLi doesn't recognise (Google Chat, Skype, Zoho Meeting, a company's own video tool…). ProdLi then records whatever tab you click the icon on, until you click it again or close the tab. Off: only the apps listed above.</span>
      </span>
    </label>
  );
}

/** "Earlier in this series", in its own section when there's anything earlier. */
function SeriesSection({ meeting, meetings, onOpen }: { meeting: Meeting; meetings: Meeting[]; onOpen: (id: string) => void }) {
  return meetingSeries(meeting, meetings).length ? (
    <Section title="Series">
      <Series meeting={meeting} meetings={meetings} onOpen={onOpen} />
    </Section>
  ) : null;
}

// ── Meeting detail ────────────────────────────────────────────────────────────

function MeetingDetail({
  meeting,
  hasKey,
  onSummarize,
  onDelete,
  flash,
  allMeetings,
  onOpenMeeting,
}: {
  meeting: Meeting;
  hasKey: boolean;
  onSummarize: () => void;
  onDelete: () => void;
  flash: (msg: string) => void;
  allMeetings: Meeting[];
  onOpenMeeting: (id: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [addedTasks, setAddedTasks] = useState<Set<string>>(new Set());
  const [showTranscript, setShowTranscript] = useState(!meeting.summary);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const customTemplates = useCustomTemplates();
  const s = meeting.summary;

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    if (meeting.hasAudio) {
      void getAudio(meeting.id).then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
    };
  }, [meeting.id, meeting.hasAudio]);

  useEffect(() => {
    void storageGet<Todo[]>("todos", []).then((todos) => setAddedTasks(new Set(todos.map((t) => t.title))));
    setShowTranscript(!meeting.summary);
  }, [meeting.id, meeting.summary]);

  useEffect(() => {
    setFollowUpOpen(false);
    setShareOpen(false);
  }, [meeting.id]);

  const addTodos = async (items: ActionItem[]) => {
    const todos = await storageGet<Todo[]>("todos", []);
    const existing = new Set(todos.map((t) => t.title));
    const fresh: Todo[] = items
      .filter((i) => !existing.has(actionItemTitle(i)))
      .map((i) => ({
        id: generateId(),
        title: actionItemTitle(i),
        completed: false,
        priority: i.priority,
        dueDate: i.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) ? i.dueDate : undefined,
        subtasks: [],
        createdAt: new Date().toISOString(),
      }));
    if (fresh.length === 0) {
      flash("Already in your To-Dos");
      return;
    }
    const next = [...fresh, ...todos];
    await storageSet("todos", next);
    setAddedTasks(new Set(next.map((t) => t.title)));
    flash(`Added ${fresh.length} task${fresh.length > 1 ? "s" : ""} to To-Dos`);
  };

  const saveAsNote = async () => {
    const notes = await storageGet<Note[]>("notes", []);
    const now = new Date().toISOString();
    const note: Note = { id: generateId(), title: s?.title || meeting.title, content: meetingToNoteHtml(meeting), createdAt: now, updatedAt: now };
    await storageSet("notes", [note, ...notes]);
    await storageSet("activeNoteId", note.id);
    flash("Saved to Editor");
  };

  const exportTxt = () => {
    const header = `${meeting.title}\n${new Date(meeting.startedAt).toLocaleString()} · ${formatDuration(meeting.durationSec)}\n\n`;
    const blob = new Blob([header + transcriptToText(meeting.transcript)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meeting.title.replace(/[^\w\- ]+/g, "").trim() || "meeting"}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const busy = meeting.status === "recording" || meeting.status === "processing";
  const canSummarize = hasKey && meeting.transcript.length > 0 && !busy;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em" }}>{s?.title || meeting.title}</div>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.75 }}>
            {new Date(meeting.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {meeting.endedAt ? ` · ${formatDuration(meeting.durationSec)}` : ""} · {meeting.transcript.length} transcript lines
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            aria-label="Meeting type"
            title="Meeting type: shapes what the summary pulls out"
            value={meeting.template ?? ""}
            onChange={(e) => {
              // Read the choice now: the update runs later, after React has reset this controlled menu.
              const template = (e.target.value || undefined) as MeetingTemplate | CustomTemplateRef | undefined;
              void updateMeeting(meeting.id, () => ({ template }));
            }}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "4px 6px" }}
          >
            <option value="">Type: usual</option>
            {MEETING_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>Type: {t.label}</option>
            ))}
            {customTemplates.map((t) => (
              <option key={t.id} value={`custom:${t.id}`}>Type: {t.name} (yours)</option>
            ))}
          </select>
          <button style={btn("primary", !canSummarize)} disabled={!canSummarize} onClick={onSummarize} title={hasKey ? "" : NO_AI_HINT}>
            {meeting.status === "processing" ? "Summarizing…" : s ? "Re-summarize" : "✨ Summarize"}
          </button>
          <button style={btn("plain", busy)} disabled={busy} onClick={saveAsNote}>Save as note</button>
          {accountsEnabled() && meeting.transcript.length > 0 && (
            <button
              style={btn("plain", busy)}
              disabled={busy}
              onClick={() => openAsk(`About the meeting “${s?.title || meeting.title}” on ${new Date(meeting.startedAt).toLocaleDateString([], { dateStyle: "medium" })}: what was decided, who owns which action items, and what's still open?`)}
              title="Ask ProdLi about this meeting"
            >
              ✨ Ask about it
            </button>
          )}
          <button style={btn("plain", meeting.transcript.length === 0)} disabled={meeting.transcript.length === 0} onClick={exportTxt}>Export .txt</button>
          <button style={btn("danger", meeting.status === "recording")} disabled={meeting.status === "recording"} onClick={onDelete}>Delete</button>
        </div>
      </div>

      {meeting.status === "recording" && <Banner tone="info">Recording in progress — notes appear here when the meeting ends.</Banner>}
      {meeting.notice && <Banner tone="warn">{meeting.notice}</Banner>}
      {meeting.error && <Banner tone="error">{meeting.error}</Banner>}
      {!hasKey && meeting.transcript.length > 0 && !s && <Banner tone="info">{NO_AI_HINT} to turn this transcript into notes and action items.</Banner>}

      {audioUrl && (
        <Section title={`Audio${meeting.micIncluded ? "" : " (other participants only)"}`}>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
          <a href={audioUrl} download={audioFileName(meeting)} style={{ ...btn(), display: "inline-block", marginTop: 8, textDecoration: "none" }}>
            Download audio
          </a>
          <AudioTranscribe meeting={meeting} busy={busy} flash={flash} onSummarize={onSummarize} canSummarize={canSummarize} />
        </Section>
      )}

      {s && (
        <>
          <Section title="Summary">
            <p style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>{s.overview}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {!followUpOpen && (
                <button style={btn("plain", busy)} disabled={busy} onClick={() => setFollowUpOpen(true)} title="Write an email to the participants from this summary">
                  ✉️ Draft follow-up
                </button>
              )}
              <button
                style={btn("plain")}
                onClick={() => void navigator.clipboard.writeText(meetingToMarkdown(meeting)).then(() => flash("Notes copied: paste into Notion, Slack, Docs or email"), () => flash("Couldn't copy"))}
                title="Copy the notes as Markdown (pastes cleanly into Notion, Slack, Google Docs or email)"
              >
                📋 Copy notes
              </button>
              <button style={btn("plain")} onClick={() => downloadText(safeFileName(`${s.title || meeting.title} notes`, "md"), meetingToMarkdown(meeting))} title="Download the notes as a Markdown file" aria-label="Download notes as Markdown">
                ⬇ .md
              </button>
              {accountsEnabled() && !shareOpen && (
                <button style={btn("plain", busy)} disabled={busy} onClick={() => setShareOpen(true)} title="A read-only link to this summary for people who weren't there">
                  🔗 {meeting.share ? "Shared" : "Share"}
                </button>
              )}
            </div>
            {followUpOpen && <FollowUpDraft key={meeting.id} summary={s} meetingTitle={meeting.title} startedAt={meeting.startedAt} onClose={() => setFollowUpOpen(false)} flash={flash} />}
            {shareOpen && <ShareMeeting key={meeting.id} meeting={meeting} flash={flash} onClose={() => setShareOpen(false)} />}
          </Section>

          {((meeting.speakerActivity?.length ?? 0) > 0 || !!meeting.coaching || (accountsEnabled() && meeting.transcript.length > 0)) && (
            <Section title="Insights">
              <div style={{ display: "grid", gap: 16 }}>
                {(meeting.speakerActivity?.length ?? 0) > 0 && <TalkTime meeting={meeting} />}
                {(!!meeting.coaching || (accountsEnabled() && meeting.transcript.length > 0)) && <Coach key={meeting.id} meeting={meeting} />}
              </div>
            </Section>
          )}

          <SeriesSection meeting={meeting} meetings={allMeetings} onOpen={onOpenMeeting} />

          {(s.customSections ?? []).filter((c) => c.points.length).map((c, i) => (
            <Section key={`cs-${i}`} title={c.heading}>
              <ul data-testid="custom-section" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14, listStyle: "disc" }}>{c.points.map((p, j) => <li key={j}>{p}</li>)}</ul>
            </Section>
          ))}

          {s.actionItems.length > 0 && (
            <Section title="Action items">
              <div style={{ display: "grid", gap: 6 }}>
                {s.actionItems.map((item, i) => {
                  const added = addedTasks.has(actionItemTitle(item));
                  return (
                    <div key={i} style={{ ...card, padding: "8px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                      <span title={item.priority} style={{ fontSize: 12 }}>{item.priority === "high" ? "🔴" : item.priority === "medium" ? "🟡" : "🟢"}</span>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
                        {item.task}
                        <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                          {item.owner ? ` · ${item.owner}` : ""}
                          {item.dueDate ? ` · due ${item.dueDate}` : ""}
                        </span>
                      </div>
                      <button style={btn("plain", added)} disabled={added} onClick={() => void addTodos([item])}>
                        {added ? "Added ✓" : "+ To-Do"}
                      </button>
                    </div>
                  );
                })}
                <div>
                  <button style={btn("primary")} onClick={() => void addTodos(s.actionItems)}>Add all to To-Dos</button>
                </div>
              </div>
            </Section>
          )}

          {s.keyPoints.length > 0 && (
            <Section title="Key points">
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14, listStyle: "disc" }}>{s.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </Section>
          )}
          {s.decisions.length > 0 && (
            <Section title="Decisions">
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14, listStyle: "disc" }}>{s.decisions.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </Section>
          )}
          {s.openQuestions.length > 0 && (
            <Section title="Open questions">
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14, listStyle: "disc" }}>{s.openQuestions.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </Section>
          )}
        </>
      )}

      {(meeting.marks?.length ?? 0) > 0 && (
        <Section title="Key moments">
          <KeyMoments meeting={meeting} />
        </Section>
      )}

      {/* While it records, the notepad is under the recording bar instead. */}
      {meeting.status !== "recording" && (
        <Section title="Your notes">
          <YourNotes key={meeting.id} meetingId={meeting.id} />
        </Section>
      )}

      {meeting.transcript.length > 0 && (
        <Section title="Transcript">
          <button style={{ ...btn(), marginBottom: 8 }} onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "Hide transcript" : `Show transcript (${meeting.transcript.length} lines)`}
          </button>
          {showTranscript && (
            <div style={{ ...card, maxHeight: 420, overflow: "auto", display: "grid", gap: 8 }}>
              {meeting.transcript.map((e) => (
                <div key={e.id} style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <span style={{ fontFamily: "Space Mono, monospace", fontSize: 11, opacity: 0.6, marginRight: 8 }}>{formatTimestamp(e.startMs)}</span>
                  <strong>{e.speaker}:</strong> {e.text}
                  {e.source === "device" && (
                    <span title="Meet's captions missed this; it comes from on-device transcription" style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, border: "1px solid currentColor", padding: "0 4px", opacity: 0.85 }}>
                      on device
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

/** `setupOnly`: just the recorder setup (Settings › Meetings). */
export function MeetingsSection({ setupOnly = false }: { setupOnly?: boolean } = {}) {
  const ext = isExtension();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recState, setRecState] = useState<RecordingState | null>(null);
  const [indicator, setIndicator] = useState(false);
  const [recorderOn, setRecorderOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [speechOn, setSpeechOn] = useState(false);
  const [speechLang, setSpeechLang] = useState("en-US");
  const [speechStatus, setSpeechStatus] = useState<SpeechAvailability | "checking" | "installing">("checking");
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"meetings" | "actions" | "insights" | "decisions">("meetings");
  // Why the last click on the ProdLi icon didn't start recording (recorder/controller.ts).
  const [problem, setProblem] = useState<{ message: string; at: string } | null>(null);
  useEffect(() => {
    if (!ext) return;
    const fresh = (p: { message: string; at: string } | null | undefined) => (p && Date.now() - new Date(p.at).getTime() < 30 * 60_000 ? p : null);
    void storageGet<{ message: string; at: string } | null>("recorderLastProblem", null).then((p) => setProblem(fresh(p)));
    return onStorageChange<{ message: string; at: string }>("recorderLastProblem", (p) => setProblem(fresh(p)));
  }, [ext]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const refresh = useCallback(async () => {
    const list = await listMeetings();
    setMeetings(list);
    // Ask ProdLi → a source meeting: open that one.
    const wanted = await storageGet<string | null>(OPEN_MEETING_KEY, null);
    if (wanted) void storageRemove(OPEN_MEETING_KEY);
    setSelectedId((cur) => (wanted && list.some((m) => m.id === wanted) ? wanted : cur && list.some((m) => m.id === cur) ? cur : (list[0]?.id ?? null)));
  }, []);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const src = (e as CustomEvent<{ kind: string; id: string }>).detail;
      if (src?.kind === "meeting") void refresh();
    };
    window.addEventListener(OPEN_ITEM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ITEM_EVENT, onOpen);
  }, [refresh]);

  // ProdLi account: free summaries without a key (and, on the web, meetings synced from the extension).
  useEffect(() => {
    const check = () =>
      void canUseProdliAi().then((ok) => {
        setSignedIn(ok);
        if (ok) getAiUsage().then(setAiUsage, () => setAiUsage(null));
      });
    check();
    return onProdliAccountChange(check);
  }, []);

  // Changes saved anywhere (this tab included) announce themselves; refresh right away.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(MEETINGS_CHANNEL);
    ch.onmessage = () => void refresh();
    return () => ch.close();
  }, [refresh]);

  // Web app: meetings arrive through sync; IndexedDB has no change events, so poll.
  // (Both here and in the extension's first load: recoverInPerson keeps the audio of
  // in-person recordings cut short by a closed page.)
  useEffect(() => {
    if (ext) return;
    void recoverInPerson().catch(() => 0).then(() => refresh()).then(() => setLoaded(true));
    const poll = setInterval(() => void refresh(), 3000);
    return () => clearInterval(poll);
  }, [ext, refresh]);

  useEffect(() => {
    if (!ext) return;
    void (async () => {
      const [showIndicator, mic, , , auto, granted, session] = await Promise.all([
        storageGet<boolean>(SHOW_INDICATOR_STORAGE_KEY, false),
        storageGet<boolean>(MIC_ENABLED_STORAGE_KEY, false),
        storageGet<boolean>(SPEECH_ENABLED_STORAGE_KEY, false).then(setSpeechOn),
        storageGet<string>(SPEECH_LANG_STORAGE_KEY, navigator.language && SPEECH_LANGS.some((l) => l.code === navigator.language) ? navigator.language : "en-US").then(setSpeechLang),
        storageGet<boolean>(AUTO_SUMMARIZE_STORAGE_KEY, true),
        chrome.permissions.contains(RECORDER_PERMISSIONS),
        chrome.storage.session.get(RECORDING_STATE_KEY),
      ]);
      setIndicator(showIndicator);
      setMicOn(mic);
      setAutoSummarize(auto);
      setRecorderOn(granted);
      setRecState((session[RECORDING_STATE_KEY] as RecordingState | undefined) ?? null);
      setShowSetup(!granted);
      await recoverInPerson().catch(() => 0);
      await refresh();
      setLoaded(true);
    })();

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && RECORDING_STATE_KEY in changes) {
        setRecState((changes[RECORDING_STATE_KEY].newValue as RecordingState | undefined) ?? null);
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    // IndexedDB has no change events, so poll while this tab is open.
    const poll = setInterval(() => void refresh(), 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [ext, refresh]);

  const selected = useMemo(() => meetings.find((m) => m.id === selectedId) ?? null, [meetings, selectedId]);

  const toggleIndicator = async () => {
    await storageSet(SHOW_INDICATOR_STORAGE_KEY, !indicator);
    setIndicator(!indicator);
  };

  const toggleRecorder = async () => {
    if (recorderOn) {
      await chrome.permissions.remove({ permissions: ["tabCapture", "offscreen"] }).catch(() => false);
      setRecorderOn(await chrome.permissions.contains(RECORDER_PERMISSIONS));
      return;
    }
    const granted = await chrome.permissions.request(RECORDER_PERMISSIONS);
    setRecorderOn(granted);
    flash(granted ? "Recorder is on" : "Permission was not granted");
  };

  const toggleMic = async () => {
    if (micOn) {
      await storageSet(MIC_ENABLED_STORAGE_KEY, false);
      setMicOn(false);
      return;
    }
    try {
      // Asking here (in a visible ProdLi tab) grants the mic to the extension,
      // so the background recorder can use it later without a prompt.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await storageSet(MIC_ENABLED_STORAGE_KEY, true);
      setMicOn(true);
    } catch {
      flash("Microphone access was blocked");
    }
  };

  // On-device transcription: check readiness for the chosen language.
  useEffect(() => {
    if (!ext) return;
    setSpeechStatus("checking");
    void speechAvailability(speechLang).then(setSpeechStatus);
  }, [ext, speechLang]);

  const toggleSpeech = async () => {
    const next = !speechOn;
    setSpeechOn(next);
    await storageSet(SPEECH_ENABLED_STORAGE_KEY, next);
  };

  const changeSpeechLang = async (lang: string) => {
    setSpeechLang(lang);
    await storageSet(SPEECH_LANG_STORAGE_KEY, lang);
  };

  const installSpeechModel = () => {
    // Must run directly from the click (Chrome requires a user gesture to download).
    setSpeechStatus("installing");
    installSpeech(speechLang).then(
      async (ok) => {
        setSpeechStatus(await speechAvailability(speechLang));
        if (ok && !speechOn) await toggleSpeech();
        flash(ok ? "Speech model ready — on-device transcription is on" : "Couldn't download the speech model");
      },
      async () => {
        setSpeechStatus(await speechAvailability(speechLang));
        flash("Couldn't download the speech model");
      },
    );
  };

  const toggleAuto = async () => {
    await storageSet(AUTO_SUMMARIZE_STORAGE_KEY, !autoSummarize);
    setAutoSummarize(!autoSummarize);
  };

  const summarize = async (id: string) => {
    setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, status: "processing", error: null } : m)));
    if (!ext) {
      // Web app: no background worker — summarize here through the ProdLi account.
      const meeting = await updateMeeting(id, () => ({ status: "processing", error: null }));
      if (!meeting) return;
      try {
        const summary = await summarizeMeeting(meeting);
        await updateMeeting(id, (m) => ({ status: "ready", summary, title: isPlaceholderTitle(m.title) && summary.title ? summary.title : m.title }));
        flash("Notes ready");
      } catch (err) {
        const error = err instanceof Error ? err.message : "Summarizing failed";
        await updateMeeting(id, () => ({ status: "ready", error }));
        flash(error);
      }
      if (signedIn) getAiUsage().then(setAiUsage, () => {});
      await refresh();
      return;
    }
    const msg: BackgroundMessage = { target: "background", type: "summarize", meetingId: id };
    const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
    await refresh();
    flash(res?.ok ? "Notes ready" : (res?.error ?? "Summarizing failed"));
    if (signedIn) getAiUsage().then(setAiUsage, () => {});
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this meeting, its transcript and audio? This can't be undone.")) return;
    await deleteMeeting(id);
    await refresh();
    flash("Meeting deleted");
  };

  const markMoment = async () => {
    const msg: BackgroundMessage = { target: "background", type: "mark-moment" };
    const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; count?: number } | undefined;
    flash(res?.ok ? `★ Moment marked${res.count && res.count > 1 ? ` (${res.count})` : ""}` : "Couldn't mark the moment");
  };

  const stopRecording = async () => {
    const msg: BackgroundMessage = { target: "background", type: "stop-recording" };
    await chrome.runtime.sendMessage(msg);
  };

  const header = (
    <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
        Meetings
        <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, background: "#000", color: ACCENT, padding: "2px 8px", verticalAlign: "middle", display: "inline-block", whiteSpace: "nowrap" }}>
          AI notes · any call & in person
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {meetings.length > 0 && (
          <button style={btn(view === "actions" ? "primary" : "plain")} aria-pressed={view === "actions"} onClick={() => setView((v) => (v === "actions" ? "meetings" : "actions"))} title="Open action items from all your meetings">
            ✅ Action items
          </button>
        )}
        {meetings.length > 0 && (
          <button style={btn(view === "insights" ? "primary" : "plain")} aria-pressed={view === "insights"} onClick={() => setView((v) => (v === "insights" ? "meetings" : "insights"))} title="Where your meeting time goes">
            📊 Insights
          </button>
        )}
        {meetings.length > 0 && (
          <button style={btn(view === "decisions" ? "primary" : "plain")} aria-pressed={view === "decisions"} onClick={() => setView((v) => (v === "decisions" ? "meetings" : "decisions"))} title="Every decision from your meetings">
            🧭 Decisions
          </button>
        )}
        <InPersonButton disabled={!!recState} flash={flash} onStarted={() => void refresh()} />
        {ext && (
          <button style={btn(showSetup ? "primary" : "plain")} onClick={() => setShowSetup((v) => !v)}>
            ⚙ Setup
          </button>
        )}
      </div>
    </div>
  );

  const setupPanel = (
    <SetupPanel
      indicator={indicator}
      onToggleIndicator={() => void toggleIndicator()}
      recorderOn={recorderOn}
      onToggleRecorder={() => void toggleRecorder()}
      micOn={micOn}
      onToggleMic={() => void toggleMic()}
      autoSummarize={autoSummarize}
      onToggleAuto={() => void toggleAuto()}
      speech={{ on: speechOn, lang: speechLang, status: speechStatus, toggle: () => void toggleSpeech(), setLang: (l) => void changeSpeechLang(l), install: installSpeechModel }}
      ai={{ signedIn, usage: aiUsage }}
    />
  );
  if (setupOnly) return ext ? setupPanel : <div style={card}><strong>Meeting notes are recorded by the ProdLi Chrome extension.</strong><p style={{ fontSize: 13, marginBottom: 0 }}>Its recorder settings live there (Settings › Meetings in the extension).</p></div>;

  if (!ext && !signedIn && meetings.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <InPersonBar flash={flash} onDone={(id) => void refresh().then(() => setSelectedId(id))} />
        <div style={{ padding: 24 }}>
          {callRecordingSupported() ? (
            <div style={card} data-testid="desktop-meetings-empty">
              <strong>Get AI notes from any call with 🖥 Record a call above</strong> — Zoom, Teams, Slack, Google Meet, FaceTime or anything else on this computer. No bot joins the call.
              <p style={{ fontSize: 14 }}>ProdLi records your computer's sound and your microphone, then writes a transcript, summary and action items. For a meeting in the room, use 🎙 Record in person. You can also start a recording from the ProdLi icon in the menu bar (Mac) or the tray (Windows).</p>
              {accountsEnabled() && <p style={{ fontSize: 14 }}>Transcripts and summaries need a free ProdLi account: sign in (👤 at the bottom left). Meetings from the extension and the phone app show up here too.</p>}
            </div>
          ) : (
            <div style={card}>
              <strong>Record a meeting in the room with 🎙 Record in person above</strong>, or get notes from calls with the ProdLi Chrome extension.
              <p style={{ fontSize: 14 }}>For calls, install ProdLi, join a call in your browser (Meet, Zoom, Teams, Webex, Slack, Discord…), and click the ProdLi icon to get a transcript, summary and action items — without a bot joining the call.</p>
              {accountsEnabled() && <p style={{ fontSize: 14 }}>Already use the extension? Sign in (👤 at the top) to see your meetings here, search them and get summaries.</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  const elapsed = recState ? Math.max(0, Math.floor((now - new Date(recState.startedAt).getTime()) / 1000)) : 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      {header}

      {problem && !recState && (
        <div role="alert" data-testid="recorder-problem" style={{ borderBottom: "var(--nb-border)", background: "#FFF3CD", color: "#000", padding: "10px 24px", display: "flex", alignItems: "center", gap: 12, fontSize: 13, fontWeight: 600 }}>
          <span style={{ flex: 1 }}>
            <strong>Recording didn't start.</strong> {problem.message}
          </span>
          <button style={btn("plain")} onClick={() => void storageRemove("recorderLastProblem").then(() => setProblem(null))}>Dismiss</button>
        </div>
      )}

      <InPersonBar flash={flash} onDone={(id) => void refresh().then(() => setSelectedId(id))} />

      {recState && (
        <div style={{ borderBottom: "var(--nb-border)", background: "#000", color: "#fff", padding: "8px 24px", display: "flex", alignItems: "center", gap: 12, fontWeight: 700, fontSize: 13 }}>
          <span className="timer-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "#E53935", display: "inline-block" }} />
          Recording · {formatTimestamp(elapsed * 1000)}
          <span style={{ opacity: 0.85 }}>{recState.platform && recState.platform !== "google-meet" ? `${recState.platform === "browser" ? "This tab" : `${PLATFORM_LABEL[recState.platform]} call`} — recording audio; the transcript is made after the call` : recState.captionsOn ? "Captions on — transcript is being captured" : "Captions are off — only audio is being recorded. Turn on CC in Meet for a transcript."}</span>
          <button style={{ ...btn("plain"), marginLeft: "auto" }} onClick={() => void copyDisclosure().then((ok) => flash(ok ? "Heads-up copied: paste it in the meeting chat" : "Couldn't copy"))} title="Copy your “I'm taking AI notes” message">📋 Copy heads-up</button>
          <button style={btn(notesOpen ? "primary" : "plain")} aria-pressed={notesOpen} onClick={() => setNotesOpen((v) => !v)} title="Your notes for this meeting">📝 Notes</button>
          <button style={btn("plain")} onClick={() => void markMoment()} title="Mark this moment as important (Alt+Shift+M)">★ Mark moment</button>
          <button style={btn("primary")} onClick={() => void stopRecording()}>■ Stop</button>
        </div>
      )}
      {recState && notesOpen && (
        <div style={{ borderBottom: "var(--nb-border)", background: "hsl(var(--muted))", padding: "10px 24px" }}>
          <YourNotes meetingId={recState.meetingId} live compact />
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {showSetup && setupPanel}

        {view === "decisions" && meetings.length > 0 ? (
          <Decisions meetings={meetings} flash={flash} onOpenMeeting={(id) => { setSelectedId(id); setView("meetings"); }} />
        ) : view === "insights" && meetings.length > 0 ? (
          <MeetingInsights meetings={meetings} onOpenMeeting={(id) => { setSelectedId(id); setView("meetings"); }} />
        ) : view === "actions" && meetings.length > 0 ? (
          <ActionItems meetings={meetings} flash={flash} onOpenMeeting={(id) => { setSelectedId(id); setView("meetings"); }} />
        ) : meetings.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 36 }}>🎙️</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 8 }}>No meetings yet</div>
            <p style={{ fontSize: 14, opacity: 0.8 }}>
              {ext ? "Join a call in your browser (Meet, Zoom, Teams, Webex, Slack, Discord…) and click the ProdLi icon (or press Alt+Shift+R) to start taking notes. For a meeting in the room, press 🎙 Record in person." : "Press 🎙 Record in person for a meeting in the room. Calls you record with the ProdLi extension appear here too."}
            </p>
          </div>
        ) : (
          <div className="meetings-layout" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div className="meetings-list" style={{ width: 280, flexShrink: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search meetings…"
                aria-label="Search meetings"
                style={{ border: "var(--nb-border)", padding: "7px 10px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
              />
              {query && !meetings.some((m) => meetingMatches(m, query)) && <div style={{ fontSize: 13, opacity: 0.7 }}>No meetings match “{query}”.</div>}
              {meetings.filter((m) => meetingMatches(m, query)).map((m) => {
                const active = m.id === selectedId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    title={m.summary?.title || m.title}
                    style={{
                      ...card,
                      minWidth: 0,
                      padding: "10px 12px",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "hsl(var(--foreground))",
                      background: active ? ACCENT : "hsl(var(--card))",
                      ...(active ? { color: "#000" } : {}),
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.summary?.title || m.title}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>
                      {new Date(m.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })} ·{" "}
                      {m.status === "recording" ? "● recording" : m.status === "processing" ? "summarizing…" : m.endedAt ? formatDuration(m.durationSec) : "—"}
                      {m.error ? " · ⚠" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {selected && (
                <MeetingDetail
                  key={selected.id}
                  meeting={selected}
                  hasKey={signedIn}
                  onSummarize={() => void summarize(selected.id)}
                  onDelete={() => void remove(selected.id)}
                  flash={flash}
                  allMeetings={meetings}
                  onOpenMeeting={setSelectedId}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "absolute", right: 24, bottom: 24, ...card, background: "#000", color: "#FFD700", fontWeight: 800, fontSize: 13, padding: "10px 14px" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
