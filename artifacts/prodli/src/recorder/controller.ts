// Background-side control of meeting recording.
//
// Start: click the ProdLi toolbar icon (or press Alt+Shift+R) on a Google Meet,
// Zoom or Teams call tab (see calls.ts). Chrome only lets an extension capture a
// tab's audio after one of those user actions, which is why recording can't
// start from a button inside the call.
//
// Meet: transcript from Meet's captions (content script meet-captions.js).
// Other calls (Zoom, Teams, Webex…): no captions are read; the audio is transcribed with AI right
// after the call (in the offscreen document, piece by piece through here,
// where the account is), or by on-device transcription if that's on.

import { getMeeting, putMeeting, updateMeeting } from "./db";
import { base64ToBytes, fillCaptionGaps } from "./format";
import { anyWebsiteCall, callFromUrl, isPlaceholderTitle, notACallReason, placeholderTitle, PLATFORM_LABEL, stillInCall, titleFromTab, type CallInfo, type CallPlatform } from "./calls";
import { sendWithRetry } from "./audioTranscribe";
import { labelSpeakers, type SpeakerActivity } from "./speakers";
import { addMark } from "../lib/moments";
import { canUseProdliAi, SIGN_IN_FOR_SUMMARIES, summarizeMeeting, SummarizeError } from "./summarize";
import {
  AUTO_SUMMARIZE_STORAGE_KEY,
  AUTO_TRANSCRIBE_STORAGE_KEY,
  RECORD_ANY_TAB_STORAGE_KEY,
  VOCABULARY_STORAGE_KEY,
  CLAUDE_KEY_STORAGE_KEY,
  MIC_ENABLED_STORAGE_KEY,
  SPEECH_ENABLED_STORAGE_KEY,
  SPEECH_LANG_STORAGE_KEY,
  SHOW_INDICATOR_STORAGE_KEY,
  RECORDER_PERMISSIONS,
  RECORDING_STATE_KEY,
  type BackgroundMessage,
  type ContentCommand,
  type Meeting,
  type OffscreenCommand,
  type RecordingState,
  type TranscriptEntry,
} from "./types";

/** Last reason recording didn't start (shown in Meetings), so it never fails silently. */
export const RECORDER_PROBLEM_KEY = "recorderLastProblem";
const OFFSCREEN_URL = "offscreen.html";

let stopping = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

export { meetingCodeFromUrl, notACallReason } from "./calls";

async function reportProblem(message: string): Promise<void> {
  await chrome.storage.local.set({ [RECORDER_PROBLEM_KEY]: { message, at: new Date().toISOString() } });
  notify("ProdLi didn't start recording", message);
}

async function getState(): Promise<RecordingState | null> {
  const r = await chrome.storage.session.get(RECORDING_STATE_KEY);
  return (r[RECORDING_STATE_KEY] as RecordingState | undefined) ?? null;
}

async function setState(state: RecordingState | null): Promise<void> {
  if (state) await chrome.storage.session.set({ [RECORDING_STATE_KEY]: state });
  else await chrome.storage.session.remove(RECORDING_STATE_KEY);
}

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}

async function hasOffscreenDocument(): Promise<boolean> {
  if (!chrome.offscreen) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the call's audio for ProdLi meeting notes",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument().catch(() => {});
}

function notify(title: string, message: string, id = `rec_${Date.now()}`): void {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
  });
}

async function openMeetingsSection(): Promise<void> {
  await chrome.storage.local.set({ lastSection: "meetings" });
  await chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
}

const DEFAULT_TITLE = "ProdLi — click on a call's tab (Meet, Zoom, Teams, Webex, Slack, Discord…) to record";

/**
 * Calls other than Meet: ProdLi records the call's tab, which plays only the other
 * people, so your own voice is in the recording only with the microphone on.
 * (Meet doesn't need it: its captions include you.)
 */
export const MIC_OFF_NOTIFICATION_ID = "rec_mic_off";
export function micOffNote(platform: CallPlatform, micIncluded: boolean, micWanted: boolean): string | null {
  if (platform === "google-meet" || micIncluded) return null;
  return micWanted
    ? "ProdLi couldn't use your microphone, so your own voice isn't in this recording. Allow the microphone for ProdLi (Meetings → Setup → Include my microphone)."
    : "Your own voice isn't in this recording: the microphone is off. Turn on “Include my microphone” in Meetings → Setup for calls other than Google Meet.";
}

/** REC (red) while recording with captions; CC (amber) when captions are missing, so there's no transcript. */
async function setRecordingBadge(tabId: number | null, captionsMissing = false, platform: CallPlatform = "google-meet", micOff = false): Promise<void> {
  if (tabId === null) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: DEFAULT_TITLE });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: captionsMissing ? "#F59E0B" : "#E53935" });
  await chrome.action.setBadgeTextColor?.({ color: captionsMissing ? "#000000" : "#FFFFFF" });
  await chrome.action.setBadgeText({ text: captionsMissing ? "CC" : "REC" });
  await chrome.action.setTitle({
    title: platform !== "google-meet"
      ? `ProdLi is recording this ${platform === "browser" ? "tab" : `${PLATFORM_LABEL[platform]} call`}'s audio; the transcript is made after the call.${micOff ? " Your microphone is off, so your own voice isn't recorded." : ""} Click to stop.`
      : captionsMissing
      ? "ProdLi is recording audio, but captions are off — turn on captions (CC) in Meet for a transcript. Click to stop."
      : "ProdLi is recording and taking notes from captions. Click to stop.",
  });
}

// ── Marked moments ──────────────────────────────────────────────────────────

/** "★ Mark moment" during a call: saves the time on the meeting and flashes ★ on the icon. */
export async function markMoment(): Promise<{ ok: boolean; count?: number; error?: string }> {
  const state = await getState();
  if (!state) return { ok: false, error: "Nothing is being recorded." };
  const at = Date.now() - new Date(state.startedAt).getTime();
  let count = 0;
  await updateMeeting(state.meetingId, (m) => {
    const marks = addMark(m.marks, at);
    count = marks.length;
    return { marks };
  });
  void flashMarked();
  return { ok: true, count };
}

async function flashMarked(): Promise<void> {
  try {
    const before = await chrome.action.getBadgeText({});
    await chrome.action.setBadgeText({ text: "★" });
    setTimeout(() => {
      // Only put it back if the recording is still going (stopping clears it).
      void getState().then((s) => (s ? chrome.action.setBadgeText({ text: before }) : undefined));
    }, 1200);
  } catch {
    // The badge is only feedback.
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────

export async function toggleRecording(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const state = await getState();
  if (state) {
    await stopRecording("user");
    return;
  }
  // The click's tab normally carries its address; if not, look it up.
  let url = tab?.url ?? tab?.pendingUrl;
  if (!url && tab?.id) url = await chrome.tabs.get(tab.id).then((t) => t.url ?? t.pendingUrl, () => undefined);
  // A recognised call app, or (with "Record any website" on) any web page.
  const call = callFromUrl(url) ?? ((await getLocal<boolean>(RECORD_ANY_TAB_STORAGE_KEY, false)) ? anyWebsiteCall(url) : null);
  if (!tab?.id || !call) {
    await reportProblem(notACallReason(url) ?? "This tab isn't a call ProdLi can record.");
    await openMeetingsSection();
    return;
  }
  await chrome.storage.local.remove(RECORDER_PROBLEM_KEY);
  await startRecording({ ...tab, url } as chrome.tabs.Tab & { id: number }, call);
}

async function startRecording(tab: chrome.tabs.Tab & { id: number }, call: CallInfo): Promise<void> {
  const granted = await chrome.permissions.contains(RECORDER_PERMISSIONS);
  if (!granted) {
    await reportProblem("The recorder isn't turned on yet. In Meetings → Setup, click “Turn on recorder” and choose Allow.");
    await openMeetingsSection();
    return;
  }

  const meetingId = `mtg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  try {
    await ensureOffscreenDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    const meeting: Meeting = {
      id: meetingId,
      platform: call.platform,
      title: titleFromTab(call.platform, tab.title) ?? placeholderTitle(call),
      meetingCode: call.code,
      url: tab.url ?? "",
      startedAt: startedAt.toISOString(),
      endedAt: null,
      durationSec: 0,
      status: "recording",
      transcript: [],
      summary: null,
      error: null,
      notice: null,
      hasAudio: false,
      micIncluded: false,
      audioMimeType: null,
      updatedAt: startedAt.toISOString(),
    };
    await putMeeting(meeting);
    await setState({ meetingId, tabId: tab.id, startedAt: meeting.startedAt, captionsOn: false, platform: call.platform });

    const withMic = await getLocal<boolean>(MIC_ENABLED_STORAGE_KEY, false);
    const speechOn = await getLocal<boolean>(SPEECH_ENABLED_STORAGE_KEY, false);
    const speechLang = speechOn ? await getLocal<string>(SPEECH_LANG_STORAGE_KEY, "en-US") : null;
    const startCmd: OffscreenCommand = { target: "offscreen", type: "start", meetingId, streamId, withMic, speechLang };
    const res = (await chrome.runtime.sendMessage(startCmd)) as { ok: boolean; error?: string; micIncluded?: boolean } | undefined;
    if (!res?.ok) throw new Error(res?.error ?? "The recorder didn't start.");
    // Calls other than Meet with no microphone: say so now, while there's still time to fix it.
    const micNote = micOffNote(call.platform, !!res.micIncluded, withMic);

    if (call.platform === "google-meet") {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["meet-captions.js"] });
      const showIndicator = await getLocal<boolean>(SHOW_INDICATOR_STORAGE_KEY, false);
      const captionsCmd: ContentCommand = { target: "captions", type: "start", meetingId, startedAtMs: startedAt.getTime(), showIndicator };
      await chrome.tabs.sendMessage(tab.id, captionsCmd);
    }

    await setRecordingBadge(tab.id, false, call.platform, !!micNote);
    if (micNote) notify("Your voice isn't being recorded", micNote, MIC_OFF_NOTIFICATION_ID);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setState(null);
    await setRecordingBadge(null);
    await closeOffscreenDocument();
    await updateMeeting(meetingId, () => ({ status: "error", error: `Recording couldn't start: ${message}`, endedAt: new Date().toISOString() }));
    await reportProblem(`Recording couldn't start: ${message}`);
  }
}

export async function stopRecording(reason: "user" | "tab-closed" | "left-call" | "error", finalEntries?: TranscriptEntry[]): Promise<void> {
  if (stopping) return;
  const state = await getState();
  if (!state) return;
  stopping = true;
  try {
    await setState(null);
    await setRecordingBadge(null);

    const platform = state.platform ?? "google-meet";
    // 1. Collect the final transcript from the Meet tab (if it's still open).
    let entries = finalEntries;
    if (!entries && reason !== "tab-closed" && platform === "google-meet") {
      try {
        const stopCmd: ContentCommand = { target: "captions", type: "stop" };
        const res = (await chrome.tabs.sendMessage(state.tabId, stopCmd)) as { entries?: TranscriptEntry[] } | undefined;
        entries = res?.entries;
      } catch {
        // Tab is gone or navigated away; use what was already saved.
      }
    }

    // 2. Stop the audio recorder (it saves the audio, and returns any on-device transcript).
    let speechEntries: TranscriptEntry[] | undefined;
    let audio: { hasAudio: boolean; mimeType: string | null } = { hasAudio: false, mimeType: null };
    let speakerActivity: SpeakerActivity | undefined;
    try {
      const stopCmd: OffscreenCommand = { target: "offscreen", type: "stop" };
      const res = (await chrome.runtime.sendMessage(stopCmd)) as { speechEntries?: TranscriptEntry[]; hasAudio?: boolean; mimeType?: string | null; speakerActivity?: SpeakerActivity } | undefined;
      speechEntries = res?.speechEntries;
      speakerActivity = res?.speakerActivity;
      audio = { hasAudio: !!res?.hasAudio, mimeType: res?.mimeType ?? null };
    } catch {
      // Offscreen document already gone.
    }
    // Calls other than Meet: transcribe the recording with AI now (before the offscreen document closes).
    const autoTranscribe = await getLocal<boolean>(AUTO_TRANSCRIBE_STORAGE_KEY, true);
    const transcribe = platform !== "google-meet" && audio.hasAudio && autoTranscribe && (await canTranscribe());

    // 3. Save the finished meeting.
    const endedAt = new Date();
    const micWanted = await getLocal<boolean>(MIC_ENABLED_STORAGE_KEY, false);
    const meeting = await updateMeeting(state.meetingId, (m) => {
      const micNote = micOffNote(platform, m.micIncluded, micWanted);
      const captions = entries && entries.length >= m.transcript.length ? entries : m.transcript;
      const speech = speechEntries && speechEntries.length >= (m.speechTranscript?.length ?? 0) ? speechEntries : (m.speechTranscript ?? []);
      // Meet captions have real speaker names, so they win; on-device speech fills in when
      // captions were off for the whole call, or for stretches of it.
      const usedSpeech = captions.length === 0 && speech.length > 0;
      const { transcript, filled } = fillCaptionGaps(captions, speech);
      return {
        transcript,
        endedAt: endedAt.toISOString(),
        durationSec: Math.round((endedAt.getTime() - new Date(m.startedAt).getTime()) / 1000),
        status: "processing",
        speechTranscript: speech,
        ...(speakerActivity?.length ? { speakerActivity } : {}),
        notice: withNote(
          platform !== "google-meet"
            ? transcribe
              ? "Transcribing the recording with AI…"
              : transcript.length === 0
                ? autoTranscribe
                  ? `${PLATFORM_LABEL[platform]} calls are saved as audio. Sign in (👤, free) to transcribe them with AI after the call, or turn on on-device transcription in Meetings → Setup.`
                  : `${PLATFORM_LABEL[platform]} calls are saved as audio. Use 🌐 Transcribe audio with AI below for a transcript, or turn on on-device transcription in Meetings → Setup.`
                : `This transcript was made on your computer (speakers: You / Others).`
            : transcript.length === 0
            ? "No captions were captured. Next time, make sure captions (CC) are on in Google Meet — only you can see them — or turn on on-device transcription in Meetings → Setup."
            : usedSpeech
              ? "Captions were off, so this transcript was made on your computer (speakers: You / Others)."
              : filled
                ? `Captions missed part of the call; ${filled} line${filled > 1 ? "s" : ""} from on-device transcription fill${filled > 1 ? "" : "s"} the gaps (marked “on device”, speakers: You / Others).`
                : null,
          micNote,
        ),
      };
    });
    if (meeting && transcribe) await transcribeAfterCall(meeting.id, audio.mimeType, micOffNote(platform, meeting.micIncluded, micWanted));
    await closeOffscreenDocument();
    if (meeting) await finishMeeting(meeting.id);
  } finally {
    stopping = false;
  }
}

const withNote = (notice: string | null, extra: string | null) => [notice, extra].filter(Boolean).join(" ") || null;

/** May the recording be sent for AI transcription? (Signed in; test builds use a stub.) */
async function canTranscribe(): Promise<boolean> {
  if (import.meta.env.VITE_E2E === "1" && (globalThis as { __prodliTranscribeStub?: unknown }).__prodliTranscribeStub) return true;
  return canUseProdliAi();
}

/** AI transcript of a recording of a call other than Meet, made in the offscreen document; on failure the meeting keeps what it had. */
async function transcribeAfterCall(meetingId: string, mimeType: string | null, micNote: string | null): Promise<void> {
  let res: { ok: true; entries: TranscriptEntry[]; languages: string[] } | { ok: false; error: string } | undefined;
  try {
    const cmd: OffscreenCommand = { target: "offscreen", type: "transcribe", meetingId, mimeType };
    res = await chrome.runtime.sendMessage(cmd);
  } catch {
    res = undefined;
  }
  await updateMeeting(meetingId, (m) =>
    res?.ok
      ? { transcript: labelSpeakers(res.entries, m.speakerActivity), transcriptSource: "audio", audioLanguages: res.languages, notice: micNote }
      : { notice: withNote(`The recording couldn't be transcribed${res && !res.ok ? `: ${res.error}` : "."} Try “Transcribe audio with AI” on this meeting.${m.transcript.length ? " The on-device transcript is shown for now." : ""}`, micNote) },
  );
}

async function finishMeeting(meetingId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return;
  const autoSummarize = await getLocal<boolean>(AUTO_SUMMARIZE_STORAGE_KEY, true);
  const canSummarize = await canUseProdliAi();

  if (meeting.transcript.length === 0 || !autoSummarize || !canSummarize) {
    await updateMeeting(meetingId, () => ({ status: "ready" }));
    notify("Meeting saved", canSummarize || meeting.transcript.length === 0 || !autoSummarize ? "Open ProdLi → Meetings to see it." : SIGN_IN_FOR_SUMMARIES);
    return;
  }
  await runSummary(meetingId);
}

export async function runSummary(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const meeting = await updateMeeting(meetingId, () => ({ status: "processing", error: null }));
  if (!meeting) return { ok: false, error: "Meeting not found." };
  try {
    const summary = await summarizeMeeting(meeting);
    await updateMeeting(meetingId, (m) => ({
      status: "ready",
      summary,
      title: isPlaceholderTitle(m.title) && summary.title ? summary.title : m.title,
    }));
    notify("Meeting notes ready", `${summary.title} — ${summary.actionItems.length} action item(s).`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof SummarizeError || err instanceof Error ? err.message : "Summarizing failed.";
    await updateMeeting(meetingId, () => ({ status: "ready", error }));
    return { ok: false, error };
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

async function handleMessage(msg: BackgroundMessage): Promise<unknown> {
  switch (msg.type) {
    case "captions-update": {
      const state = await getState();
      if (state?.meetingId === msg.meetingId && state.captionsOn !== msg.captionsOn) {
        await setState({ ...state, captionsOn: msg.captionsOn });
      }
      if (state?.meetingId === msg.meetingId) await setRecordingBadge(state.tabId, !!msg.captionsMissing, state.platform);
      await updateMeeting(msg.meetingId, (m) => ({
        transcript: msg.entries.length >= m.transcript.length ? msg.entries : m.transcript,
        title: msg.title && isPlaceholderTitle(m.title) ? msg.title : m.title,
      }));
      return { ok: true };
    }
    case "speech-update":
      await updateMeeting(msg.meetingId, (m) => ({ speechTranscript: msg.entries.length >= (m.speechTranscript?.length ?? 0) ? msg.entries : m.speechTranscript }));
      return { ok: true };
    case "captions-ended":
      await stopRecording("left-call", msg.entries);
      return { ok: true };
    case "stop-recording":
      await stopRecording("user");
      return { ok: true };
    case "mark-moment":
      return markMoment();
    case "offscreen-started":
      await updateMeeting(msg.meetingId, () => ({ micIncluded: msg.micIncluded }));
      return { ok: true };
    case "offscreen-stopped":
      await updateMeeting(msg.meetingId, () => ({ hasAudio: msg.hasAudio, audioMimeType: msg.mimeType }));
      return { ok: true };
    case "offscreen-error":
      notify("Recording problem", msg.error);
      await stopRecording("error");
      return { ok: true };
    case "summarize":
      return runSummary(msg.meetingId);
    case "transcribe-piece": {
      const vocabulary = await getLocal<string[]>(VOCABULARY_STORAGE_KEY, []);
      try {
        return { ok: true, result: await sendWithRetry(base64ToBytes(msg.wav), msg.startMs, vocabulary) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Transcription didn't work." };
      }
    }
  }
}

/** If the service worker restarted mid-recording and the recorder is gone, close the meeting out. */
async function recoverIfStale(): Promise<void> {
  const state = await getState();
  if (state && !(await hasOffscreenDocument())) await stopRecording("error");
}

export function registerRecorder(): void {
  // Summaries now always go through the user's ProdLi account; forget any API key saved by older versions.
  void chrome.storage.local.remove(CLAUDE_KEY_STORAGE_KEY);
  // End-to-end tests (test builds only) drive the same code path as the toolbar click.
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliToggleRecording: toggleRecording, __prodliMarkMoment: markMoment });

  chrome.action.onClicked.addListener((tab) => {
    void toggleRecording(tab);
  });

  // Optional chaining: if this API is ever missing (e.g. Chrome loaded a
  // half-written build), the keyboard shortcut is lost but the rest of the
  // background worker — time tracking, Pomodoro, sync — still starts.
  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command === "mark-moment") return void markMoment();
    if (command !== "toggle-recording") return;
    if (tab) {
      void toggleRecording(tab);
    } else {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => toggleRecording(t));
    }
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
    if (msg?.target !== "background") return undefined;
    handleMessage(msg).then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getState();
    if (state?.tabId === tabId) await stopRecording("tab-closed");
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url && !changeInfo.title) return;
    const state = await getState();
    if (state?.tabId !== tabId) return;
    const platform = state.platform ?? "google-meet";
    if (changeInfo.url && !stillInCall(platform, changeInfo.url)) return void (await stopRecording("left-call"));
    // Calls other than Meet: the meeting's name comes from the tab title.
    const name = titleFromTab(platform, changeInfo.title);
    if (name) await updateMeeting(state.meetingId, (m) => (isPlaceholderTitle(m.title) ? { title: name } : {}));
  });

  void recoverIfStale();
}
