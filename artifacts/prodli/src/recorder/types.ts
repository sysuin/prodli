// Shared types for the ProdLi meeting recorder (background, offscreen, content script, UI).

import type { CallPlatform } from "./calls";

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  /** ms since the recording started */
  startMs: number;
  /** ms since the recording started */
  endMs: number;
  /** "device": from on-device transcription, filling a gap in Meet's captions. "audio": from "Transcribe audio with AI". */
  source?: "device" | "audio";
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
  /** Your own template's sections, filled in (Pro: custom meeting templates). */
  customSections?: { heading: string; points: string[] }[];
  model: string;
  generatedAt: string;
}

/** Feedback from "🎯 Coach me" (Pro). */
export interface MeetingCoaching {
  verdict: string;
  strengths: string[];
  improvements: string[];
  nextStepsAgreed: boolean;
  nextStepsNote: string;
  missedQuestions: string[];
  focus: CoachFocus;
  model: string;
  generatedAt: string;
}
export const COACH_FOCUS = [
  { id: "general", label: "Any meeting" },
  { id: "sales", label: "Sales call" },
  { id: "interview", label: "Interview I ran" },
  { id: "one-on-one", label: "One-on-one I ran" },
  { id: "presentation", label: "I was presenting" },
] as const;
export type CoachFocus = (typeof COACH_FOCUS)[number]["id"];

export type MeetingStatus = "recording" | "processing" | "ready" | "error";

export interface Meeting {
  id: string;
  platform: CallPlatform;
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
  /** Meeting type for its summary (built-in, or "custom:<id>" for your own); missing = the default from Setup. */
  template?: MeetingTemplate | CustomTemplateRef;
  /** Who talked when (mic vs. call), to label AI transcripts "You" / "Others" (recorder/speakers.ts). */
  speakerActivity?: [number, number, 0 | 1][];
  /** Your own notes, typed during or after the meeting ("📝 Your notes"; Pro summaries build on them). */
  userNotes?: string;
  /** "🎯 Coach me" feedback on this meeting (Pro; prodli-api coach.ts). */
  coaching?: MeetingCoaching;
  /** Moments marked while recording ("★ Mark moment"), in ms since the start (lib/moments.ts). */
  marks?: number[];
  /** Action items marked done in Meetings → Action items (their task text). */
  doneActions?: string[];
  /** The meeting's shared link, if it's shared (server: /api/shares). */
  share?: { id: string; url: string; expiresAt: number | null };
  /** On-device transcript (used when Meet captions weren't available) */
  speechTranscript?: TranscriptEntry[];
  /** Where `transcript` came from. Missing means Meet's captions (with on-device gap filling). "file": imported from a transcript file (⬆ Upload recording). */
  transcriptSource?: "captions" | "audio" | "file";
  /** The captions transcript, kept when `transcript` was replaced by "Transcribe audio with AI". */
  captionTranscript?: TranscriptEntry[];
  /** Languages Whisper heard, most-spoken first (e.g. ["en", "tl"]). */
  audioLanguages?: string[];
  audioMimeType: string | null;
  /** The recording is a video (🎥 Record screen): the player shows it, and it can be downloaded. */
  hasVideo?: boolean;
  /** The video's share link (src/screenrec/share.ts); `notesAt` is the summary the page last got. */
  videoShare?: { id: string; url: string; notesAt?: string | null };
  /** The Google Calendar event this meeting belongs to, matched when recording starts (lib/calendarLink.ts). */
  calendarEvent?: CalendarEventRef;
  /** Uploaded recordings (⬆ Upload recording): when the file was added. `startedAt` is when it was recorded. */
  uploadedAt?: string;
  updatedAt: string;
}

/** What a meeting keeps of its calendar event. */
export interface CalendarEventRef {
  id: string;
  title: string;
  /** "HH:MM" local, or null (all-day). */
  start: string | null;
  end: string | null;
  attendees?: { name?: string; email?: string }[];
}

/** Live recording state kept in chrome.storage.session under RECORDING_STATE_KEY. */
export interface RecordingState {
  meetingId: string;
  tabId: number;
  startedAt: string;
  captionsOn: boolean;
  /** Missing in recordings started by older versions: Google Meet. */
  platform?: CallPlatform;
}

export const RECORDING_STATE_KEY = "rec_state";
export const CLAUDE_KEY_STORAGE_KEY = "claudeApiKey";
export const MIC_ENABLED_STORAGE_KEY = "recorderMicEnabled";
export const SPEECH_ENABLED_STORAGE_KEY = "recorderSpeechEnabled";
export const SPEECH_LANG_STORAGE_KEY = "recorderSpeechLang";
/** Default meeting type for summaries (a meeting can pick its own). */
export const MEETING_TEMPLATE_STORAGE_KEY = "recorderDefaultTemplate";
/** Names and terms to spell exactly (summaries and audio transcription). */
export const VOCABULARY_STORAGE_KEY = "recorderVocabulary";
/** The "I'm taking AI notes" message people paste into the meeting chat. */
export const DISCLOSURE_STORAGE_KEY = "recorderDisclosure";
export const DEFAULT_DISCLOSURE = "Heads-up: I'm taking AI-assisted notes of this call so I can share a summary afterwards.";

/** Meeting types: they shape what the summary pulls out (server: prodli-api/src/ai.ts MEETING_TEMPLATES). */
export const MEETING_TEMPLATES = [
  { id: "general", label: "General" },
  { id: "one_on_one", label: "1:1" },
  { id: "interview", label: "Interview" },
  { id: "sales", label: "Sales / customer call" },
  { id: "standup", label: "Stand-up" },
  { id: "planning", label: "Planning" },
] as const;
export type MeetingTemplate = (typeof MEETING_TEMPLATES)[number]["id"];

/** Your own meeting template (Pro): what to focus on and your own sections (server: ai.ts cleanCustomTemplate). */
export interface CustomMeetingTemplate {
  id: string;
  name: string;
  instructions: string;
  sections: string[];
}
export type CustomTemplateRef = `custom:${string}`;
export const CUSTOM_TEMPLATES_STORAGE_KEY = "recorderCustomTemplates";
/** Write notes in this language whatever was spoken (Pro); "" = the meeting's own language. Server: ai.ts SUMMARY_LANGUAGES. */
export const SUMMARY_LANGUAGE_STORAGE_KEY = "recorderSummaryLanguage";
export const SUMMARY_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" }, { code: "es", label: "Español" }, { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" }, { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" }, { code: "nl", label: "Nederlands" }, { code: "sv", label: "Svenska" }, { code: "pl", label: "Polski" }, { code: "tr", label: "Türkçe" },
  { code: "ru", label: "Русский" }, { code: "uk", label: "Українська" }, { code: "ar", label: "العربية" }, { code: "hi", label: "हिन्दी" }, { code: "bn", label: "বাংলা" },
  { code: "ta", label: "தமிழ்" }, { code: "te", label: "తెలుగు" }, { code: "mr", label: "मराठी" }, { code: "ur", label: "اردو" }, { code: "gu", label: "ગુજરાતી" }, { code: "kn", label: "ಕನ್ನಡ" }, { code: "ml", label: "മലയാളം" }, { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ms", label: "Bahasa Melayu" }, { code: "fil", label: "Filipino" }, { code: "vi", label: "Tiếng Việt" }, { code: "th", label: "ไทย" }, { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" }, { code: "zh", label: "中文 (简体)" },
];
export const isCustomRef = (t: string | undefined): t is CustomTemplateRef => !!t && t.startsWith("custom:");

/** "Ghill John, Flynn\nDSR" → ["Ghill John", "Flynn", "DSR"] */
export function parseVocabulary(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((x) => x.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, 60);
}
export const AUTO_SUMMARIZE_STORAGE_KEY = "recorderAutoSummarize";
/** "Record any website": the ProdLi icon records any tab, not just the call apps ProdLi recognises. Off by default. */
export const RECORD_ANY_TAB_STORAGE_KEY = "recorderAnyTab";
/** Zoom and Teams (no captions): transcribe the recording with AI right after the call. On by default. */
export const AUTO_TRANSCRIBE_STORAGE_KEY = "recorderAutoTranscribe";
/** Show a small "recording" label inside the Meet call (only the recorder sees it). Off by default. */
export const SHOW_INDICATOR_STORAGE_KEY = "recorderShowIndicator";
/** Google Meet: post the heads-up message (DISCLOSURE_STORAGE_KEY) in the call chat when recording starts. Off by default. */
export const AUTO_POST_DISCLOSURE_STORAGE_KEY = "recorderAutoPostDisclosure";

/** Optional permissions requested when the user turns the recorder on. */
export const RECORDER_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ["tabCapture", "offscreen"],
  origins: ["https://meet.google.com/*"],
};

// ── Messages ──────────────────────────────────────────────────────────────────

export type OffscreenCommand =
  | { target: "offscreen"; type: "start"; meetingId: string; streamId: string; withMic: boolean; speechLang: string | null }
  | { target: "offscreen"; type: "stop" }
  /** Transcribe a saved recording with AI (Zoom and Teams, after the call). */
  | { target: "offscreen"; type: "transcribe"; meetingId: string; mimeType: string | null };

export type BackgroundMessage =
  | { target: "background"; type: "offscreen-started"; meetingId: string; micIncluded: boolean }
  | { target: "background"; type: "offscreen-stopped"; meetingId: string; hasAudio: boolean; mimeType: string | null }
  | { target: "background"; type: "offscreen-error"; meetingId: string; error: string }
  | { target: "background"; type: "captions-update"; meetingId: string; entries: TranscriptEntry[]; captionsOn: boolean; title: string | null; /** Still no captions after the grace period: warn the user. */ captionsMissing?: boolean }
  | { target: "background"; type: "captions-ended"; meetingId: string; entries: TranscriptEntry[] }
  | { target: "background"; type: "speech-update"; meetingId: string; entries: TranscriptEntry[] }
  | { target: "background"; type: "stop-recording" }
  | { target: "background"; type: "mark-moment" }
  /** One piece of audio (WAV, base64) to transcribe with the user's account. */
  | { target: "background"; type: "transcribe-piece"; meetingId: string; wav: string; startMs: number }
  | { target: "background"; type: "summarize"; meetingId: string };

export type ContentCommand =
  | { target: "captions"; type: "start"; meetingId: string; startedAtMs: number; showIndicator?: boolean; disclosure?: string | null }
  | { target: "captions"; type: "stop" };
