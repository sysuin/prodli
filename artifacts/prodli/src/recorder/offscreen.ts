// Offscreen document: records the Meet tab's audio (other participants) mixed
// with the microphone (you) and saves it to IndexedDB in 10-second chunks, so a
// crash or closed tab loses at most a few seconds.

import { appendAudioChunk, finalizeAudio, getAudio } from "./db";
import { TranscribeError, transcribeRecording, type PieceResult } from "./audioTranscribe";
import { bytesToBase64 } from "./format";
import { ActivityTracker, rmsOf, type SpeakerActivity } from "./speakers";
import { LiveTranscriber, mergeSpeechEntries, speechAvailability } from "./speech";

// Test hook: lets the end-to-end tests exercise on-device transcription here.
(globalThis as unknown as { __prodliSpeech?: unknown }).__prodliSpeech = { LiveTranscriber, mergeSpeechEntries, speechAvailability };
import type { BackgroundMessage, OffscreenCommand, TranscriptEntry } from "./types";

const CHUNK_MS = 10_000;

interface Session {
  meetingId: string;
  recorder: MediaRecorder;
  audioCtx: AudioContext;
  streams: MediaStream[];
  mimeType: string;
  seq: number;
  pendingWrites: Promise<void>[];
  transcribers: LiveTranscriber[];
  /** Who's talking (mic vs. call), when the mic is included: labels AI transcripts "You" / "Others". */
  activity: ActivityTracker | null;
  activityTimer: ReturnType<typeof setInterval> | null;
}

let session: Session | null = null;

function send(msg: BackgroundMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Background may be restarting; it re-reads state from IndexedDB.
  });
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

async function start(meetingId: string, streamId: string, withMic: boolean, speechLang: string | null): Promise<boolean> {
  if (session) await stop();
  lastStopped = null;

  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: false,
  } as unknown as MediaStreamConstraints);

  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();
  const tabSource = audioCtx.createMediaStreamSource(tabStream);
  // Capturing a tab mutes it for the user; route it back to the speakers.
  tabSource.connect(audioCtx.destination);
  tabSource.connect(destination);

  const streams: MediaStream[] = [tabStream];
  let micIncluded = false;
  let micAnalyser: AnalyserNode | null = null;
  if (withMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const micSource = audioCtx.createMediaStreamSource(mic);
      micSource.connect(destination);
      micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 2048;
      micSource.connect(micAnalyser);
      streams.push(mic);
      micIncluded = true;
    } catch {
      // Mic permission not granted — record the other participants only.
    }
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(destination.stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 32_000,
  });

  // Optional on-device transcription: "Others" from the tab, "You" from the mic.
  const transcribers: LiveTranscriber[] = [];
  if (speechLang && (await speechAvailability(speechLang)) === "available") {
    const startedAt = Date.now();
    const tabTrack = tabStream.getAudioTracks()[0];
    if (tabTrack) transcribers.push(new LiveTranscriber(tabTrack, "Others", speechLang, startedAt));
    const micTrack = streams[1]?.getAudioTracks()[0];
    if (micTrack) transcribers.push(new LiveTranscriber(micTrack, "You", speechLang, startedAt));
    transcribers.forEach((t) => t.start());
  }

  // Who's talking: compare the mic and the call every 100 ms (only possible with the mic).
  let activity: ActivityTracker | null = null;
  let activityTimer: ReturnType<typeof setInterval> | null = null;
  if (micAnalyser) {
    const tabAnalyser = audioCtx.createAnalyser();
    tabAnalyser.fftSize = 2048;
    tabSource.connect(tabAnalyser);
    const buf = new Float32Array(2048);
    const startedAt = Date.now();
    const tracker = new ActivityTracker();
    const mic = micAnalyser;
    activity = tracker;
    activityTimer = setInterval(() => tracker.push(Date.now() - startedAt, rmsOf(mic, buf), rmsOf(tabAnalyser, buf)), 100);
  }

  const s: Session = { meetingId, recorder, audioCtx, streams, mimeType: recorder.mimeType || mimeType || "audio/webm", seq: 0, pendingWrites: [], transcribers, activity, activityTimer };
  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    s.pendingWrites.push(appendAudioChunk(meetingId, s.seq++, e.data));
  };
  // If the Meet tab closes, the tab track ends — stop cleanly.
  tabStream.getAudioTracks()[0]?.addEventListener("ended", () => {
    if (session === s) void stop();
  });

  recorder.start(CHUNK_MS);
  session = s;
  if (transcribers.length) {
    const tick = setInterval(() => {
      if (session !== s) return clearInterval(tick);
      send({ target: "background", type: "speech-update", meetingId, entries: mergeSpeechEntries(...transcribers.map((t) => t.list())) });
    }, 5000);
  }
  send({ target: "background", type: "offscreen-started", meetingId, micIncluded });
  return micIncluded;
}

interface Stopped {
  speechEntries: TranscriptEntry[];
  hasAudio: boolean;
  mimeType: string | null;
  speakerActivity?: SpeakerActivity;
}

let stopping: Promise<Stopped> | null = null;
let lastStopped: Stopped | null = null;

/**
 * Stops recording. A second call while stopping (or after) gets the same result:
 * when the call's tab closes, the tab audio ends and stops the recorder here a
 * moment before the background asks, and the background must still learn that
 * there is audio (and wait until it's saved).
 */
function stop(): Promise<Stopped> {
  if (stopping) return stopping;
  if (!session) return Promise.resolve(lastStopped ?? { speechEntries: [], hasAudio: false, mimeType: null });
  stopping = finishRecording().then((r) => {
    lastStopped = r;
    stopping = null;
    return r;
  });
  return stopping;
}

async function finishRecording(): Promise<Stopped> {
  const s = session;
  if (!s) return { speechEntries: [], hasAudio: false, mimeType: null };
  session = null;
  // Collect the on-device transcript before the audio tracks are stopped.
  const speech = mergeSpeechEntries(...(await Promise.all(s.transcribers.map((t) => t.stop()))));
  if (s.activityTimer) clearInterval(s.activityTimer);
  const speakerActivity = s.activity?.result();

  if (s.recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      s.recorder.addEventListener("stop", () => resolve(), { once: true });
      s.recorder.stop();
    });
  }
  s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
  await s.audioCtx.close().catch(() => {});

  let hasAudio = false;
  try {
    await Promise.all(s.pendingWrites);
    hasAudio = await finalizeAudio(s.meetingId, s.mimeType);
  } catch {
    hasAudio = false;
  }
  send({ target: "background", type: "offscreen-stopped", meetingId: s.meetingId, hasAudio, mimeType: hasAudio ? s.mimeType : null });
  return { speechEntries: speech, hasAudio, mimeType: hasAudio ? s.mimeType : null, ...(speakerActivity?.length ? { speakerActivity } : {}) };
}

/** AI transcription of a saved recording (runs here: it needs audio decoding, which the background can't do). */
async function transcribe(meetingId: string, mimeType: string | null): Promise<{ ok: true; entries: TranscriptEntry[]; languages: string[] } | { ok: false; error: string }> {
  const blob = await getAudio(meetingId);
  if (!blob) return { ok: false, error: "The recording couldn't be found." };
  try {
    // Offscreen documents can't reach the account, so each piece goes through the background.
    const send = async (wav: Uint8Array, startMs: number): Promise<PieceResult> => {
      const msg: BackgroundMessage = { target: "background", type: "transcribe-piece", meetingId, wav: bytesToBase64(wav), startMs };
      const r = (await chrome.runtime.sendMessage(msg)) as { ok: true; result: PieceResult } | { ok: false; error: string } | undefined;
      if (!r?.ok) throw new TranscribeError(r && !r.ok ? r.error : "ProdLi's background stopped responding.");
      return r.result;
    };
    const r = await transcribeRecording(blob, mimeType, { send });
    return { ok: true, entries: r.entries, languages: r.languages };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Transcription didn't work." };
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "start") {
    start(msg.meetingId, msg.streamId, msg.withMic, msg.speechLang ?? null)
      .then((micIncluded) => sendResponse({ ok: true, micIncluded }))
      .catch((err: unknown) => {
        // The background's start flow reports this failure to the user.
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  if (msg.type === "stop") {
    stop().then((r) => sendResponse({ ok: true, ...r }));
    return true;
  }
  if (msg.type === "transcribe") {
    transcribe(msg.meetingId, msg.mimeType).then(sendResponse);
    return true;
  }
  return undefined;
});
