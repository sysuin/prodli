import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { storageGet, storageSet } from "../lib/storage";
import { generateId } from "../lib/utils";
import type { Note, Todo } from "../types";
import { deleteMeeting, getAudio, listMeetings } from "../recorder/db";
import { formatTimestamp, SUMMARY_MODEL, transcriptToText } from "../recorder/format";
import { installSpeech, speechAvailability, type SpeechAvailability } from "../recorder/speech";

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
  CLAUDE_KEY_STORAGE_KEY,
  MIC_ENABLED_STORAGE_KEY,
  SPEECH_ENABLED_STORAGE_KEY,
  SPEECH_LANG_STORAGE_KEY,
  RECORDER_PERMISSIONS,
  RECORDING_STATE_KEY,
  type ActionItem,
  type BackgroundMessage,
  type Meeting,
  type RecordingState,
} from "../recorder/types";

const ACCENT = "#FF4FA3";
const DISCLOSURE_TEXT = "Heads-up: I'm taking AI-assisted notes of this call so I can share a summary afterwards.";

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

function actionItemTitle(item: ActionItem): string {
  return item.owner ? `${item.task} (${item.owner})` : item.task;
}

function meetingToNoteHtml(m: Meeting): string {
  const s = m.summary;
  const date = new Date(m.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "<p>None</p>");
  let html = `<h1>${escapeHtml(s?.title || m.title)}</h1><p><em>${escapeHtml(date)} · ${formatDuration(m.durationSec)} · Google Meet</em></p>`;
  if (s) {
    html += `<h2>Summary</h2><p>${escapeHtml(s.overview)}</p>`;
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
  apiKey,
  onSaveKey,
  recorderOn,
  onToggleRecorder,
  micOn,
  onToggleMic,
  autoSummarize,
  onToggleAuto,
  speech,
}: {
  apiKey: string;
  onSaveKey: (k: string) => void;
  recorderOn: boolean;
  onToggleRecorder: () => void;
  micOn: boolean;
  onToggleMic: () => void;
  autoSummarize: boolean;
  onToggleAuto: () => void;
  speech: { on: boolean; lang: string; status: SpeechAvailability | "checking" | "installing"; toggle: () => void; setLang: (l: string) => void; install: () => void };
}) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const masked = apiKey ? `${apiKey.slice(0, 10)}…${apiKey.slice(-4)}` : "";

  return (
    <div style={{ ...card, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 16 }}>
      <div>
        <div style={label}>1 · Claude API key</div>
        {apiKey ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <code style={{ fontSize: 13, fontWeight: 700 }}>✓ {masked}</code>
            <button style={btn()} onClick={() => onSaveKey("")}>Remove</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              style={{ flex: 1, minWidth: 0, border: "var(--nb-border)", padding: "6px 10px", fontFamily: "inherit", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
            />
            <button style={btn("primary", !draft.trim())} disabled={!draft.trim()} onClick={() => { onSaveKey(draft.trim()); setDraft(""); }}>
              Save
            </button>
          </div>
        )}
        <p style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>
          Stored only in this browser and sent only to Anthropic. Summaries use {SUMMARY_MODEL} (low-cost) — usually under 1¢ per meeting.
        </p>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={autoSummarize} onChange={onToggleAuto} /> Summarize automatically when a meeting ends
        </label>
      </div>

      <div>
        <div style={label}>2 · Recorder</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          {recorderOn ? <strong style={{ fontSize: 13 }}>✓ On for Google Meet</strong> : null}
          <button style={btn(recorderOn ? "plain" : "primary")} onClick={onToggleRecorder}>
            {recorderOn ? "Turn off" : "Turn on recorder"}
          </button>
        </div>
        <p style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Chrome will ask to let ProdLi capture tab audio and read captions on meet.google.com.</p>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={micOn} onChange={onToggleMic} /> Include my microphone in the audio recording
        </label>
      </div>

      <div>
        <div style={label}>3 · How to record</div>
        <ol style={{ fontSize: 13, paddingLeft: 18, marginTop: 8, lineHeight: 1.6, listStyle: "decimal" }}>
          <li>Join a call on <strong>meet.google.com</strong>.</li>
          <li>Click the <strong>ProdLi icon</strong> in the toolbar (pin it), or press <strong>Alt+Shift+R</strong>.</li>
          <li>ProdLi turns on captions (only you see them) and takes notes. No bot joins the call.</li>
          <li>Click <strong>Stop</strong> on the yellow badge, or leave the call.</li>
        </ol>
      </div>

      <div>
        <div style={label}>4 · When captions are off</div>
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
            : "Uses Chrome's built-in speech recognition. Audio never leaves your computer. Speakers are labelled You (your mic) and Others (the call)."}
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
            void navigator.clipboard.writeText(DISCLOSURE_TEXT).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy a heads-up message"}
        </button>
      </div>
    </div>
  );
}

// ── Meeting detail ────────────────────────────────────────────────────────────

function MeetingDetail({
  meeting,
  hasKey,
  onSummarize,
  onDelete,
  flash,
}: {
  meeting: Meeting;
  hasKey: boolean;
  onSummarize: () => void;
  onDelete: () => void;
  flash: (msg: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [addedTasks, setAddedTasks] = useState<Set<string>>(new Set());
  const [showTranscript, setShowTranscript] = useState(!meeting.summary);
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
          <button style={btn("primary", !canSummarize)} disabled={!canSummarize} onClick={onSummarize} title={hasKey ? "" : "Add your Claude API key in Setup"}>
            {meeting.status === "processing" ? "Summarizing…" : s ? "Re-summarize" : "✨ Summarize"}
          </button>
          <button style={btn("plain", busy)} disabled={busy} onClick={saveAsNote}>Save as note</button>
          <button style={btn("plain", meeting.transcript.length === 0)} disabled={meeting.transcript.length === 0} onClick={exportTxt}>Export .txt</button>
          <button style={btn("danger", meeting.status === "recording")} disabled={meeting.status === "recording"} onClick={onDelete}>Delete</button>
        </div>
      </div>

      {meeting.status === "recording" && <Banner tone="info">Recording in progress — notes appear here when the meeting ends.</Banner>}
      {meeting.notice && <Banner tone="warn">{meeting.notice}</Banner>}
      {meeting.error && <Banner tone="error">{meeting.error}</Banner>}
      {!hasKey && meeting.transcript.length > 0 && !s && <Banner tone="info">Add your Claude API key in Setup to turn this transcript into notes and action items.</Banner>}

      {audioUrl && (
        <Section title={`Audio${meeting.micIncluded ? "" : " (other participants only)"}`}>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
        </Section>
      )}

      {s && (
        <>
          <Section title="Summary">
            <p style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>{s.overview}</p>
          </Section>

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

export function MeetingsSection() {
  const ext = isExtension();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recState, setRecState] = useState<RecordingState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [recorderOn, setRecorderOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [speechOn, setSpeechOn] = useState(false);
  const [speechLang, setSpeechLang] = useState("en-US");
  const [speechStatus, setSpeechStatus] = useState<SpeechAvailability | "checking" | "installing">("checking");
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
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
    setSelectedId((cur) => (cur && list.some((m) => m.id === cur) ? cur : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    if (!ext) return;
    void (async () => {
      const [key, mic, , , auto, granted, session] = await Promise.all([
        storageGet<string>(CLAUDE_KEY_STORAGE_KEY, ""),
        storageGet<boolean>(MIC_ENABLED_STORAGE_KEY, false),
        storageGet<boolean>(SPEECH_ENABLED_STORAGE_KEY, false).then(setSpeechOn),
        storageGet<string>(SPEECH_LANG_STORAGE_KEY, navigator.language && SPEECH_LANGS.some((l) => l.code === navigator.language) ? navigator.language : "en-US").then(setSpeechLang),
        storageGet<boolean>(AUTO_SUMMARIZE_STORAGE_KEY, true),
        chrome.permissions.contains(RECORDER_PERMISSIONS),
        chrome.storage.session.get(RECORDING_STATE_KEY),
      ]);
      setApiKey(key);
      setMicOn(mic);
      setAutoSummarize(auto);
      setRecorderOn(granted);
      setRecState((session[RECORDING_STATE_KEY] as RecordingState | undefined) ?? null);
      setShowSetup(!key || !granted);
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

  const saveKey = async (key: string) => {
    await storageSet(CLAUDE_KEY_STORAGE_KEY, key);
    setApiKey(key);
    flash(key ? "API key saved" : "API key removed");
  };

  const toggleRecorder = async () => {
    if (recorderOn) {
      // Keep "scripting" — the Time Tracker's auto-redirect may also use it.
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
    const msg: BackgroundMessage = { target: "background", type: "summarize", meetingId: id };
    const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
    await refresh();
    flash(res?.ok ? "Notes ready" : (res?.error ?? "Summarizing failed"));
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this meeting, its transcript and audio? This can't be undone.")) return;
    await deleteMeeting(id);
    await refresh();
    flash("Meeting deleted");
  };

  const stopRecording = async () => {
    const msg: BackgroundMessage = { target: "background", type: "stop-recording" };
    await chrome.runtime.sendMessage(msg);
  };

  const header = (
    <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
        Meetings
        <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, background: "#000", color: ACCENT, padding: "2px 8px", verticalAlign: "middle" }}>
          AI notes · Google Meet
        </span>
      </div>
      {ext && (
        <button style={btn(showSetup ? "primary" : "plain")} onClick={() => setShowSetup((v) => !v)}>
          ⚙ Setup
        </button>
      )}
    </div>
  );

  if (!ext) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ padding: 24 }}>
          <div style={card}>
            <strong>Meeting notes work in the ProdLi Chrome extension.</strong>
            <p style={{ fontSize: 14 }}>Install ProdLi, join a Google Meet, and click the ProdLi icon to get a transcript, summary and action items — without a bot joining the call.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  const elapsed = recState ? Math.max(0, Math.floor((now - new Date(recState.startedAt).getTime()) / 1000)) : 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      {header}

      {recState && (
        <div style={{ borderBottom: "var(--nb-border)", background: "#000", color: "#fff", padding: "8px 24px", display: "flex", alignItems: "center", gap: 12, fontWeight: 700, fontSize: 13 }}>
          <span className="timer-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "#E53935", display: "inline-block" }} />
          Recording · {formatTimestamp(elapsed * 1000)}
          <span style={{ opacity: 0.7 }}>{recState.captionsOn ? "Captions on — transcript is being captured" : "Waiting for captions — turn on CC in Meet if they don't appear"}</span>
          <button style={{ ...btn("primary"), marginLeft: "auto" }} onClick={() => void stopRecording()}>■ Stop</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {showSetup && (
          <SetupPanel
            apiKey={apiKey}
            onSaveKey={(k) => void saveKey(k)}
            recorderOn={recorderOn}
            onToggleRecorder={() => void toggleRecorder()}
            micOn={micOn}
            onToggleMic={() => void toggleMic()}
            autoSummarize={autoSummarize}
            onToggleAuto={() => void toggleAuto()}
            speech={{ on: speechOn, lang: speechLang, status: speechStatus, toggle: () => void toggleSpeech(), setLang: (l) => void changeSpeechLang(l), install: installSpeechModel }}
          />
        )}

        {meetings.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 36 }}>🎙️</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 8 }}>No meetings yet</div>
            <p style={{ fontSize: 14, opacity: 0.8 }}>Join a Google Meet and click the ProdLi icon (or press Alt+Shift+R) to start taking notes.</p>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ width: 280, flexShrink: 0, display: "grid", gap: 8 }}>
              {meetings.map((m) => {
                const active = m.id === selectedId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={{
                      ...card,
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
                  hasKey={!!apiKey}
                  onSummarize={() => void summarize(selected.id)}
                  onDelete={() => void remove(selected.id)}
                  flash={flash}
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
