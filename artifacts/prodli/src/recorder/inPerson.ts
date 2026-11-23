// In-person meetings (and voice notes): record from the microphone right in the
// open ProdLi page (the extension's tab or the web app, including on a phone).
//
// The recording runs here, not in the background, so it needs this page to stay
// open; it keeps going while you switch ProdLi sections (the session is held at
// module level, not in a component). Audio is saved to IndexedDB in 10-second
// chunks, like call recordings, so closing the tab keeps what was recorded.
//
// When it stops: the transcript comes from AI transcription (signed in, and
// "transcribe the recording with AI after the call" is on), or from on-device
// speech recognition if that's turned on in Setup; then the usual AI summary.

import { appendAudioChunk, finalizeAudio, getAudio, listMeetings, putMeeting, updateMeeting } from "./db";
import { LiveTranscriber, speechAvailability } from "./speech";
import { transcribeRecording } from "./audioTranscribe";
import { canUseProdliAi, summarizeMeeting } from "./summarize";
import { isPlaceholderTitle } from "./calls";
import { setCurrentInPerson, type RecordingKind } from "./inPersonState";
import { callTitle, captureCall } from "./desktopCall";
import { desktop } from "../lib/desktop";
import { storageGet } from "../lib/storage";
import { AUTO_SUMMARIZE_STORAGE_KEY, AUTO_TRANSCRIBE_STORAGE_KEY, SPEECH_ENABLED_STORAGE_KEY, SPEECH_LANG_STORAGE_KEY, type Meeting, type TranscriptEntry } from "./types";

const CHUNK_MS = 10_000;

interface Session {
  meetingId: string;
  startedAt: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
  seq: number;
  writes: Promise<void>[];
  speech: LiveTranscriber | null;
  wakeLock: { release(): Promise<void> } | null;
  kind: RecordingKind;
  /** Calls: whether the other people's audio was recorded directly (else the microphone only). */
  systemAudio: boolean;
  release: () => void;
}

let session: Session | null = null;
const changed = () => {
  setCurrentInPerson(session ? { meetingId: session.meetingId, startedAt: session.startedAt, kind: session.kind } : null);
  desktop()?.setRecording(!!session);
};
export { currentInPerson, onInPersonChange } from "./inPersonState";

export function inPersonSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** "In person · Thu 20 Nov, 14:05" until a summary gives it a real name. */
export function inPersonTitle(d = new Date()): string {
  return `In person · ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const pickMime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";

/** Desktop app only: a call in any app can be recorded (recorder/desktopCall.ts). */
export function callRecordingSupported(): boolean {
  return !!desktop() && inPersonSupported() && !!navigator.mediaDevices?.getDisplayMedia;
}

/**
 * Starts recording: from the microphone ("room"), or a call in any app ("call",
 * desktop app). Throws an Error with a message to show (e.g. microphone blocked).
 */
export function startInPerson(kind: RecordingKind = "room"): Promise<string> {
  if (session) return Promise.resolve(session.meetingId);
  // One start at a time (a tray "Record" and a button click can arrive together).
  starting ??= begin(kind).finally(() => (starting = null));
  return starting;
}
let starting: Promise<string> | null = null;

async function begin(kind: RecordingKind): Promise<string> {
  let stream: MediaStream;
  let systemAudio = false;
  let release = () => stream.getTracks().forEach((t) => t.stop());
  if (kind === "call") {
    const c = await captureCall();
    stream = c.stream;
    systemAudio = c.systemAudio;
    release = c.stop;
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      throw new Error(name === "NotAllowedError" ? (desktop() ? "ProdLi isn't allowed to use the microphone. Allow it in your computer's privacy settings, then try again." : "Microphone access was blocked. Allow the microphone for ProdLi (the icon in the address bar) and try again.") : name === "NotFoundError" ? "No microphone was found." : "The microphone couldn't be started.");
    }
  }
  const startedAt = Date.now();
  const meetingId = `mtg_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  const iso = new Date(startedAt).toISOString();
  const meeting: Meeting = {
    id: meetingId,
    platform: kind === "call" ? "desktop" : "in-person",
    title: kind === "call" ? callTitle(new Date(startedAt)) : inPersonTitle(new Date(startedAt)),
    meetingCode: null,
    url: "",
    startedAt: iso,
    endedAt: null,
    durationSec: 0,
    status: "recording",
    transcript: [],
    summary: null,
    error: null,
    notice: null,
    hasAudio: false,
    micIncluded: true,
    audioMimeType: null,
    updatedAt: iso,
  };
  await putMeeting(meeting);
  // In person, by time: the calendar event that's on now (lib/calendarLink.ts).
  void import("../lib/calendarLink").then((c) => c.linkCalendarEvent(meetingId, { at: new Date(iso) }));

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
  const s: Session = { meetingId, startedAt, recorder, stream, mimeType: recorder.mimeType || mime || "audio/webm", seq: 0, writes: [], speech: null, wakeLock: null, kind, systemAudio, release };
  recorder.ondataavailable = (e) => {
    if (e.data.size) s.writes.push(appendAudioChunk(meetingId, s.seq++, e.data));
  };
  recorder.start(CHUNK_MS);

  // On-device transcription, if turned on in Setup (works without an account).
  if (await storageGet<boolean>(SPEECH_ENABLED_STORAGE_KEY, false)) {
    const lang = await storageGet<string>(SPEECH_LANG_STORAGE_KEY, "en-US");
    const track = stream.getAudioTracks()[0];
    if (track && (await speechAvailability(lang)) === "available") {
      s.speech = new LiveTranscriber(track, "Speaker", lang, startedAt);
      s.speech.start();
    }
  }
  // Keep a phone's screen from sleeping (which would pause the page).
  try {
    s.wakeLock = (await (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen")) ?? null;
  } catch {
    s.wakeLock = null;
  }
  session = s;
  changed();
  return meetingId;
}

export interface StopResult {
  meetingId: string;
  transcribed: boolean;
  summarized: boolean;
  problem?: string;
}

/** Stops, saves the audio, then transcribes and summarizes when possible. `onPhase` reports progress. */
export async function stopInPerson(onPhase?: (phase: "saving" | "transcribing" | "summarizing") => void): Promise<StopResult | null> {
  const s = session;
  if (!s) return null;
  session = null;
  changed();
  onPhase?.("saving");
  const speech: TranscriptEntry[] = s.speech ? await s.speech.stop() : [];
  if (s.recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      s.recorder.addEventListener("stop", () => resolve(), { once: true });
      s.recorder.stop();
    });
  }
  s.release();
  s.stream.getTracks().forEach((t) => t.stop());
  await s.wakeLock?.release().catch(() => {});
  await Promise.all(s.writes).catch(() => {});
  const hasAudio = await finalizeAudio(s.meetingId, s.mimeType).catch(() => false);
  const ended = new Date();
  const signedIn = await canUseProdliAi();
  // Test builds: a stubbed transcription service stands in for the account.
  const stubbed = import.meta.env.VITE_E2E === "1" && !!(globalThis as { __prodliTranscribeStub?: unknown }).__prodliTranscribeStub;
  const autoTranscribe = await storageGet<boolean>(AUTO_TRANSCRIBE_STORAGE_KEY, true);
  const transcribe = hasAudio && (signedIn || stubbed) && autoTranscribe;
  await updateMeeting(s.meetingId, () => ({
    endedAt: ended.toISOString(),
    durationSec: Math.round((ended.getTime() - s.startedAt) / 1000),
    hasAudio,
    audioMimeType: hasAudio ? s.mimeType : null,
    speechTranscript: speech,
    transcript: speech,
    status: "processing",
    notice: !hasAudio
      ? "Nothing was recorded."
      : transcribe
        ? "Transcribing the recording with AI…"
        : speech.length
          ? "This transcript was made on your device."
          : signedIn
            ? "Saved as audio. Use 🌐 Transcribe audio with AI below for a transcript."
            : "Saved as audio. Sign in (👤, free) to transcribe it with AI, or turn on on-device transcription in Meetings → Setup.",
  }));

  const result: StopResult = { meetingId: s.meetingId, transcribed: false, summarized: false };
  if (transcribe) {
    onPhase?.("transcribing");
    try {
      const blob = await getAudio(s.meetingId);
      if (!blob) throw new Error("The recording couldn't be found.");
      const r = await transcribeRecording(blob, s.mimeType);
      await updateMeeting(s.meetingId, () => ({ transcript: r.entries, transcriptSource: "audio", audioLanguages: r.languages, notice: null }));
      result.transcribed = true;
    } catch (err) {
      result.problem = err instanceof Error ? err.message : "Transcription didn't work.";
      await updateMeeting(s.meetingId, (m) => ({ notice: `The recording couldn't be transcribed: ${result.problem} Try “Transcribe audio with AI” on this meeting.${m.transcript.length ? " The on-device transcript is shown for now." : ""}` }));
    }
  }

  const meeting = (await listMeetings()).find((m) => m.id === s.meetingId);
  if (meeting && meeting.transcript.length && signedIn && (await storageGet<boolean>(AUTO_SUMMARIZE_STORAGE_KEY, true))) {
    onPhase?.("summarizing");
    try {
      const summary = await summarizeMeeting(meeting);
      await updateMeeting(s.meetingId, (m) => ({ status: "ready", summary, title: isPlaceholderTitle(m.title) && summary.title ? summary.title : m.title }));
      result.summarized = true;
    } catch (err) {
      await updateMeeting(s.meetingId, () => ({ status: "ready", error: err instanceof Error ? err.message : "Summarizing failed." }));
    }
  } else {
    await updateMeeting(s.meetingId, () => ({ status: "ready" }));
  }
  if (s.kind === "call" && !s.systemAudio && hasAudio) {
    // Always say it, alongside any other notice (e.g. "sign in to transcribe").
    await updateMeeting(s.meetingId, (m) => ({ notice: m.notice ? `${MIC_ONLY_NOTICE} ${m.notice}` : MIC_ONLY_NOTICE }));
  }
  return result;
}

export const MIC_ONLY_NOTICE =
  "Only your microphone was recorded: ProdLi couldn't capture the computer's sound. On a Mac (macOS 13 or later), allow ProdLi in System Settings → Privacy & Security → Screen & System Audio Recording.";

/**
 * In-person recordings left "recording" when their page closed: keep the audio
 * that was saved and mark them done. Call when Meetings opens.
 */
export async function recoverInPerson(): Promise<number> {
  const stale = (await listMeetings()).filter((m) => (m.platform === "in-person" || m.platform === "desktop") && m.status === "recording" && m.id !== session?.meetingId);
  for (const m of stale) {
    const hasAudio = await finalizeAudio(m.id, "").catch(() => false);
    const mime = hasAudio ? ((await getAudio(m.id))?.type || "audio/webm") : null;
    await updateMeeting(m.id, () => ({
      status: "ready",
      hasAudio,
      audioMimeType: mime,
      endedAt: m.updatedAt,
      notice: hasAudio ? "The page closed during this recording; the audio up to then was kept. Use 🌐 Transcribe audio with AI below for a transcript." : "The page closed before anything was saved.",
    }));
  }
  return stale.length;
}
