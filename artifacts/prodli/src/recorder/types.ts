// Shared types for the ProdLi meeting recorder (background, offscreen, content script, UI).

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  /** ms since the recording started */
  startMs: number;
  /** ms since the recording started */
  endMs: number;
}

export interface ActionItem {
  task: string;
  owner: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
}

export interface MeetingSummary {
  title: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
  model: string;
  generatedAt: string;
}

export type MeetingStatus = "recording" | "processing" | "ready" | "error";

export interface Meeting {
  id: string;
  platform: "google-meet";
  title: string;
  meetingCode: string | null;
  url: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  status: MeetingStatus;
  transcript: TranscriptEntry[];
  summary: MeetingSummary | null;
  /** Human-readable problem with summarizing or recording, if any */
  error: string | null;
  /** Non-fatal notes, e.g. "No captions were captured" */
  notice: string | null;
  hasAudio: boolean;
  micIncluded: boolean;
  /** On-device transcript (used when Meet captions weren't available) */
  speechTranscript?: TranscriptEntry[];
  audioMimeType: string | null;
  updatedAt: string;
}

/** Live recording state kept in chrome.storage.session under RECORDING_STATE_KEY. */
export interface RecordingState {
  meetingId: string;
  tabId: number;
  startedAt: string;
  captionsOn: boolean;
}

export const RECORDING_STATE_KEY = "rec_state";
export const CLAUDE_KEY_STORAGE_KEY = "claudeApiKey";
export const MIC_ENABLED_STORAGE_KEY = "recorderMicEnabled";
export const SPEECH_ENABLED_STORAGE_KEY = "recorderSpeechEnabled";
export const SPEECH_LANG_STORAGE_KEY = "recorderSpeechLang";
export const AUTO_SUMMARIZE_STORAGE_KEY = "recorderAutoSummarize";
/** Show a small "recording" label inside the Meet call (only the recorder sees it). Off by default. */
export const SHOW_INDICATOR_STORAGE_KEY = "recorderShowIndicator";

/** Optional permissions requested when the user turns the recorder on. */
export const RECORDER_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ["tabCapture", "offscreen", "scripting"],
  origins: ["https://meet.google.com/*"],
};

// ── Messages ──────────────────────────────────────────────────────────────────

export type OffscreenCommand =
  | { target: "offscreen"; type: "start"; meetingId: string; streamId: string; withMic: boolean; speechLang: string | null }
  | { target: "offscreen"; type: "stop" };

export type BackgroundMessage =
  | { target: "background"; type: "offscreen-started"; meetingId: string; micIncluded: boolean }
  | { target: "background"; type: "offscreen-stopped"; meetingId: string; hasAudio: boolean; mimeType: string | null }
  | { target: "background"; type: "offscreen-error"; meetingId: string; error: string }
  | { target: "background"; type: "captions-update"; meetingId: string; entries: TranscriptEntry[]; captionsOn: boolean; title: string | null }
  | { target: "background"; type: "captions-ended"; meetingId: string; entries: TranscriptEntry[] }
  | { target: "background"; type: "speech-update"; meetingId: string; entries: TranscriptEntry[] }
  | { target: "background"; type: "stop-recording" }
  | { target: "background"; type: "summarize"; meetingId: string };

export type ContentCommand =
  | { target: "captions"; type: "start"; meetingId: string; startedAtMs: number; showIndicator?: boolean }
  | { target: "captions"; type: "stop" };
