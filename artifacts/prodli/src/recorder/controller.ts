// Background-side control of meeting recording.
//
// Start: click the ProdLi toolbar icon (or press Alt+Shift+R) on a Google Meet
// tab. Chrome only lets an extension capture a tab's audio after one of those
// user actions, which is why recording can't start from a button inside Meet.

import { getMeeting, putMeeting, updateMeeting } from "./db";
import { canUseProdliAi, SIGN_IN_FOR_SUMMARIES, summarizeMeeting, SummarizeError } from "./summarize";
import {
  AUTO_SUMMARIZE_STORAGE_KEY,
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

/** The meeting code (abc-defg-hij) of a Google Meet call URL, wherever it is in the path. */
export function meetingCodeFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "meet.google.com") return null;
    return /(?:^|\/)([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Why recording can't start on this tab, in plain words (null when it can). */
export function notACallReason(url: string | undefined): string | null {
  if (meetingCodeFromUrl(url)) return null;
  if (!url) return "ProdLi couldn't read this tab's address. Click the ProdLi icon while the Google Meet call is the active tab.";
  try {
    const u = new URL(url);
    if (u.hostname === "meet.google.com") return "Join the call first: ProdLi records once you're in a meeting (the address looks like meet.google.com/abc-defg-hij).";
    if (u.hostname === "mail.google.com" || u.hostname === "calendar.google.com") return "Meet calls inside Gmail or Calendar can't be recorded. Open the call in its own tab at meet.google.com, then click the ProdLi icon.";
  } catch {
    // not a normal web address
  }
  return "ProdLi records Google Meet calls. Join a call at meet.google.com, then click the ProdLi icon (or press Alt+Shift+R) on that tab.";
}

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
    justification: "Record Google Meet audio for ProdLi meeting notes",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument().catch(() => {});
}

function notify(title: string, message: string): void {
  chrome.notifications.create(`rec_${Date.now()}`, {
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

const DEFAULT_TITLE = "ProdLi — click on a Google Meet tab to record";

/** REC (red) while recording with captions; CC (amber) when captions are missing, so there's no transcript. */
async function setRecordingBadge(tabId: number | null, captionsMissing = false): Promise<void> {
  if (tabId === null) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: DEFAULT_TITLE });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: captionsMissing ? "#F59E0B" : "#E53935" });
  await chrome.action.setBadgeTextColor?.({ color: captionsMissing ? "#000000" : "#FFFFFF" });
  await chrome.action.setBadgeText({ text: captionsMissing ? "CC" : "REC" });
  await chrome.action.setTitle({
    title: captionsMissing
      ? "ProdLi is recording audio, but captions are off — turn on captions (CC) in Meet for a transcript. Click to stop."
      : "ProdLi is recording and taking notes from captions. Click to stop.",
  });
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
  const code = meetingCodeFromUrl(url);
  if (!tab?.id || !code) {
    await reportProblem(notACallReason(url) ?? "This tab isn't a Google Meet call.");
    await openMeetingsSection();
    return;
  }
  await chrome.storage.local.remove(RECORDER_PROBLEM_KEY);
  await startRecording({ ...tab, url } as chrome.tabs.Tab & { id: number }, code);
}

async function startRecording(tab: chrome.tabs.Tab & { id: number }, code: string): Promise<void> {
  const granted = await chrome.permissions.contains(RECORDER_PERMISSIONS);
  if (!granted) {
    await reportProblem("The recorder isn't allowed to capture Google Meet yet. In Meetings → Setup, click “Turn on recorder” and choose Allow.");
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
      platform: "google-meet",
      title: `Google Meet · ${code}`,
      meetingCode: code,
      url: tab.url ?? `https://meet.google.com/${code}`,
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
    await setState({ meetingId, tabId: tab.id, startedAt: meeting.startedAt, captionsOn: false });

    const withMic = await getLocal<boolean>(MIC_ENABLED_STORAGE_KEY, false);
    const speechOn = await getLocal<boolean>(SPEECH_ENABLED_STORAGE_KEY, false);
    const speechLang = speechOn ? await getLocal<string>(SPEECH_LANG_STORAGE_KEY, "en-US") : null;
    const startCmd: OffscreenCommand = { target: "offscreen", type: "start", meetingId, streamId, withMic, speechLang };
    const res = (await chrome.runtime.sendMessage(startCmd)) as { ok: boolean; error?: string } | undefined;
    if (!res?.ok) throw new Error(res?.error ?? "The recorder didn't start.");

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["meet-captions.js"] });
    const showIndicator = await getLocal<boolean>(SHOW_INDICATOR_STORAGE_KEY, false);
    const captionsCmd: ContentCommand = { target: "captions", type: "start", meetingId, startedAtMs: startedAt.getTime(), showIndicator };
    await chrome.tabs.sendMessage(tab.id, captionsCmd);

    await setRecordingBadge(tab.id);
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

    // 1. Collect the final transcript from the Meet tab (if it's still open).
    let entries = finalEntries;
    if (!entries && reason !== "tab-closed") {
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
    try {
      const stopCmd: OffscreenCommand = { target: "offscreen", type: "stop" };
      const res = (await chrome.runtime.sendMessage(stopCmd)) as { speechEntries?: TranscriptEntry[] } | undefined;
      speechEntries = res?.speechEntries;
    } catch {
      // Offscreen document already gone.
    }
    await closeOffscreenDocument();

    // 3. Save the finished meeting.
    const endedAt = new Date();
    const meeting = await updateMeeting(state.meetingId, (m) => {
      const captions = entries && entries.length >= m.transcript.length ? entries : m.transcript;
      const speech = speechEntries && speechEntries.length >= (m.speechTranscript?.length ?? 0) ? speechEntries : (m.speechTranscript ?? []);
      // Meet captions have real speaker names, so they win; on-device speech fills in when captions were off.
      const usedSpeech = captions.length === 0 && speech.length > 0;
      const transcript = usedSpeech ? speech : captions;
      return {
        transcript,
        endedAt: endedAt.toISOString(),
        durationSec: Math.round((endedAt.getTime() - new Date(m.startedAt).getTime()) / 1000),
        status: "processing",
        speechTranscript: speech,
        notice:
          transcript.length === 0
            ? "No captions were captured. Next time, make sure captions (CC) are on in Google Meet — only you can see them — or turn on on-device transcription in Meetings → Setup."
            : usedSpeech
              ? "Captions were off, so this transcript was made on your computer (speakers: You / Others)."
              : null,
      };
    });
    if (meeting) await finishMeeting(meeting.id);
  } finally {
    stopping = false;
  }
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
      title: m.title.startsWith("Google Meet · ") && summary.title ? summary.title : m.title,
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
      if (state?.meetingId === msg.meetingId) await setRecordingBadge(state.tabId, !!msg.captionsMissing);
      await updateMeeting(msg.meetingId, (m) => ({
        transcript: msg.entries.length >= m.transcript.length ? msg.entries : m.transcript,
        title: msg.title && m.title.startsWith("Google Meet · ") ? msg.title : m.title,
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
  if (import.meta.env.VITE_E2E === "1") (globalThis as Record<string, unknown>).__prodliToggleRecording = toggleRecording;

  chrome.action.onClicked.addListener((tab) => {
    void toggleRecording(tab);
  });

  // Optional chaining: if this API is ever missing (e.g. Chrome loaded a
  // half-written build), the keyboard shortcut is lost but the rest of the
  // background worker — time tracking, Pomodoro, sync — still starts.
  chrome.commands?.onCommand.addListener((command, tab) => {
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
    if (!changeInfo.url) return;
    const state = await getState();
    if (state?.tabId !== tabId) return;
    if (!meetingCodeFromUrl(changeInfo.url)) await stopRecording("left-call");
  });

  void recoverIfStale();
}
