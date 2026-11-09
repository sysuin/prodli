// Offscreen document: records the Meet tab's audio (other participants) mixed
// with the microphone (you) and saves it to IndexedDB in 10-second chunks, so a
// crash or closed tab loses at most a few seconds.

import { appendAudioChunk, finalizeAudio } from "./db";
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

async function start(meetingId: string, streamId: string, withMic: boolean, speechLang: string | null): Promise<void> {
  if (session) await stop();

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
  if (withMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      audioCtx.createMediaStreamSource(mic).connect(destination);
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

  const s: Session = { meetingId, recorder, audioCtx, streams, mimeType: recorder.mimeType || mimeType || "audio/webm", seq: 0, pendingWrites: [], transcribers };
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
}

async function stop(): Promise<TranscriptEntry[]> {
  const s = session;
  if (!s) return [];
  session = null;
  // Collect the on-device transcript before the audio tracks are stopped.
  const speech = mergeSpeechEntries(...(await Promise.all(s.transcribers.map((t) => t.stop()))));

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
  return speech;
}

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "start") {
    start(msg.meetingId, msg.streamId, msg.withMic, msg.speechLang ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        // The background's start flow reports this failure to the user.
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  if (msg.type === "stop") {
    stop().then((speechEntries) => sendResponse({ ok: true, speechEntries }));
    return true;
  }
  return undefined;
});
