// Meetings → ⬆ Upload recording: any audio or video file (a voice memo, a
// recorder's export, a Zoom local recording) becomes a meeting with a transcript
// and AI notes, like a recorded call.
//
// The file is kept as the meeting's audio (IndexedDB, on this device only, so it
// can be played back), then transcribed here in the page like an in-person
// recording: decoded piece by piece (recorder/audioTranscribe.ts), silence
// skipped, each piece sent to ProdLi's AI (Whisper) with the user's account.
// Then the usual summary. If it fails or the page closes, the meeting keeps the
// audio and offers Retry.

import { getAudio, getMeeting, listMeetings, putAudio, putMeeting, updateMeeting } from "./db";
import { transcribeRecording, TranscribeError, TRANSCRIBE_QUOTA_MESSAGE, type DonePiece, type TranscribeProgress } from "./audioTranscribe";
import { canUseProdliAi, summarizeMeeting } from "./summarize";
import { readMp4Audio, readWavInfo, sniffFormat, type MediaFormat, type ReadAt } from "./mediaFormats";
import { uploadMimeType, uploadProblem } from "./uploadFile";
import { accountsEnabled, getAiUsage } from "../lib/prodliAccount";
import { storageGet, storageRemove, storageSet } from "../lib/storage";
import { AUTO_SUMMARIZE_STORAGE_KEY, type Meeting } from "./types";

export const SIGN_IN_TO_TRANSCRIBE_UPLOAD = "Saved as audio. Transcribing it needs a free ProdLi account: sign in (👤), then press Transcribe below.";
const NOT_AVAILABLE = "Saved as audio. Audio transcription isn't available in this copy of ProdLi.";

// ── Jobs running in this page (progress survives switching sections) ──────────

export interface UploadJob {
  meetingId: string;
  progress: TranscribeProgress;
  abort: AbortController;
}
const jobs = new Map<string, UploadJob>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function uploadJob(meetingId: string): UploadJob | null {
  return jobs.get(meetingId) ?? null;
}
export function onUploadChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// Leaving the page would stop the transcription: ask first.
const warn = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};
function setWarning() {
  if (typeof window === "undefined") return;
  window.removeEventListener("beforeunload", warn);
  if (jobs.size) window.addEventListener("beforeunload", warn);
}

const stubbed = () => import.meta.env.VITE_E2E === "1" && !!(globalThis as { __prodliTranscribeStub?: unknown }).__prodliTranscribeStub;

/** Holds a lock (other tabs of this page see it) while `fn` runs; skips if another tab holds it. */
async function withLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) {
    await fn();
    return true;
  }
  return locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await fn();
    return true;
  });
}
const lockName = (id: string) => `prodli-upload-${id}`;

// ── Pieces already transcribed (Retry continues instead of starting over) ─────

/** Where an upload's finished pieces wait until the whole recording is transcribed (this device only; not synced or backed up). */
export const piecesKey = (meetingId: string) => `uploadPieces_${meetingId}`;
export const loadDonePieces = (meetingId: string) => storageGet<DonePiece[]>(piecesKey(meetingId), []);
export const clearDonePieces = (meetingId: string) => storageRemove(piecesKey(meetingId));

/** Keeps finished pieces as they arrive, writing at most every second. */
function pieceSaver(meetingId: string, start: DonePiece[]) {
  const all = new Map(start.map((d) => [d.startMs, d]));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  const write = () => {
    timer = null;
    const list = [...all.values()];
    writing = writing.then(() => storageSet(piecesKey(meetingId), list)).catch(() => {});
  };
  return {
    add(d: DonePiece) {
      all.set(d.startMs, d);
      timer ??= setTimeout(write, 1000);
    },
    /** Writes what's pending now (before reporting a failure). */
    async flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
      await writing;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// ── Checking the file ─────────────────────────────────────────────────────────

const readerFor =
  (blob: Blob): ReadAt =>
  async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

/** How long the browser says the file is; "error" if it can't open it. */
function mediaDuration(file: Blob): Promise<number | null | "error"> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement("video"); // plays audio-only files too
    el.preload = "metadata";
    el.muted = true;
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (v: number | null | "error") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 8000);
    const known = () => Number.isFinite(el.duration) && el.duration > 0;
    el.onloadedmetadata = () => {
      if (known()) return finish(el.duration);
      // Files from MediaRecorder don't say how long they are until the end is read.
      el.ondurationchange = () => known() && finish(el.duration);
      el.currentTime = 1e101;
    };
    el.onerror = () => finish("error");
    el.src = url;
  });
}

export interface ProbedFile {
  format: MediaFormat;
  durationSec: number | null;
  /** Why it can't be uploaded, or null. */
  problem: string | null;
}

/** Looks at a picked file: its format, how long it is, and whether it can be uploaded. */
export async function probeFile(file: File): Promise<ProbedFile> {
  const quick = uploadProblem(file, null);
  if (quick) return { format: "unknown", durationSec: null, problem: quick };
  const read = readerFor(file);
  const format = sniffFormat(await read(0, 65_536));
  let durationSec: number | null = null;
  // Where the file itself says how long the audio is, use that (works for videos the browser can't play).
  if (format === "wav") {
    const w = await readWavInfo(read, file.size).catch(() => null);
    if (w) durationSec = w.dataLength / w.blockAlign / w.sampleRate;
  } else if (format === "mp4") {
    const m = await readMp4Audio(read, file.size).catch(() => null);
    if (m && m.codec !== "mp3") durationSec = (m.sizes.length * 1024) / m.sampleRate;
  }
  if (durationSec === null) {
    const d = await mediaDuration(file);
    if (d === "error") return { format, durationSec: null, problem: "ProdLi can't read this file. Try an MP3, M4A, WAV, MP4 or WebM file." };
    durationSec = d;
  }
  return { format, durationSec, problem: uploadProblem(file, durationSec, format) };
}

// ── Uploading ─────────────────────────────────────────────────────────────────

/**
 * Saves the file as a new meeting and starts transcribing it (when signed in).
 * Returns the meeting's id right away; transcription carries on in this page.
 */
export async function createUpload(file: File, { title, date, durationSec }: { title: string; date: Date; durationSec: number | null }): Promise<string> {
  const now = new Date();
  const id = `mtg_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const mime = uploadMimeType(file);
  const sec = Math.max(0, Math.round(durationSec ?? 0));
  const canTranscribe = stubbed() || (await canUseProdliAi());
  await putAudio(id, file.type ? file : new Blob([file], { type: mime }));
  const meeting: Meeting = {
    id,
    platform: "upload",
    title: title.trim().slice(0, 200) || "Uploaded recording",
    meetingCode: null,
    url: "",
    startedAt: date.toISOString(),
    endedAt: new Date(date.getTime() + sec * 1000).toISOString(),
    durationSec: sec,
    status: canTranscribe ? "processing" : "ready",
    transcript: [],
    summary: null,
    error: null,
    notice: canTranscribe ? null : accountsEnabled() ? SIGN_IN_TO_TRANSCRIBE_UPLOAD : NOT_AVAILABLE,
    hasAudio: true,
    micIncluded: true,
    audioMimeType: mime,
    uploadedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await putMeeting(meeting);
  if (canTranscribe) void processUpload(id);
  return id;
}

export interface UploadResult {
  transcribed: boolean;
  summarized: boolean;
  problem?: string;
}

/** Transcribes (and summarizes) an uploaded recording. Also Retry. */
export async function processUpload(meetingId: string): Promise<UploadResult> {
  const result: UploadResult = { transcribed: false, summarized: false };
  if (jobs.has(meetingId)) return result;
  const job: UploadJob = { meetingId, progress: { doneMs: 0, pieces: 0 }, abort: new AbortController() };
  jobs.set(meetingId, job);
  notify();
  setWarning();
  const fail = async (problem: string, field: "error" | "notice" = "error") => {
    result.problem = problem;
    await updateMeeting(meetingId, () => ({ status: "ready", error: field === "error" ? problem : null, notice: field === "notice" ? problem : null }));
  };
  try {
    const ran = await withLock(lockName(meetingId), async () => {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return;
      const signedIn = await canUseProdliAi();
      if (!signedIn && !stubbed()) return fail(accountsEnabled() ? SIGN_IN_TO_TRANSCRIBE_UPLOAD : NOT_AVAILABLE, "notice");
      // Pieces a failed or stopped run already transcribed: not sent (or counted) again.
      const earlier = await loadDonePieces(meetingId);
      const earlierMs = earlier.reduce((n, d) => n + d.durationMs, 0);
      // Out of minutes: say so before sending anything.
      if (signedIn && !stubbed()) {
        const usage = await getAiUsage().catch(() => null);
        const t = usage?.transcribeSeconds;
        const left = Math.max(0, (meeting.durationSec || 60) - earlierMs / 1000);
        if (t && t.limit - t.used < Math.min(left || 60, 60)) return fail(TRANSCRIBE_QUOTA_MESSAGE);
      }
      await updateMeeting(meetingId, () => ({ status: "processing", error: null, notice: null }));
      const blob = await getAudio(meetingId);
      if (!blob) return fail("The recording isn't on this device any more.");
      let r: Awaited<ReturnType<typeof transcribeRecording>>;
      const saver = pieceSaver(meetingId, earlier);
      try {
        r = await transcribeRecording(blob, meeting.audioMimeType, {
          signal: job.abort.signal,
          resume: earlier,
          onPiece: (d) => saver.add(d),
          onProgress: (p) => {
            job.progress = p;
            notify();
          },
        });
      } catch (err) {
        await saver.flush();
        const kept = (await loadDonePieces(meetingId)).length;
        const resumeNote = kept ? " Retry carries on from where it stopped; the minutes already used aren't counted again." : "";
        if (job.abort.signal.aborted) return fail(`Transcription was stopped.${kept ? resumeNote : " Press Retry to start again."}`, "notice");
        return fail(`Couldn't transcribe this recording: ${err instanceof TranscribeError || err instanceof Error ? err.message : "something went wrong."}${resumeNote}`);
      }
      saver.cancel();
      await clearDonePieces(meetingId);
      const last = r.entries[r.entries.length - 1];
      await updateMeeting(meetingId, (m) => ({
        transcript: r.entries,
        transcriptSource: "audio",
        audioLanguages: r.languages,
        notice: null,
        error: null,
        // The browser couldn't tell how long it was: at least as long as what was said.
        ...(m.durationSec ? {} : { durationSec: Math.round(last.endMs / 1000), endedAt: new Date(Date.parse(m.startedAt) + last.endMs).toISOString() }),
      }));
      result.transcribed = true;
      const done = await getMeeting(meetingId);
      if (done && signedIn && (await storageGet<boolean>(AUTO_SUMMARIZE_STORAGE_KEY, true))) {
        try {
          const summary = await summarizeMeeting(done);
          await updateMeeting(meetingId, () => ({ status: "ready", summary }));
          result.summarized = true;
        } catch (err) {
          await updateMeeting(meetingId, () => ({ status: "ready", error: err instanceof Error ? err.message : "Summarizing failed." }));
        }
      } else {
        await updateMeeting(meetingId, () => ({ status: "ready" }));
      }
    });
    if (!ran) result.problem = "This recording is being transcribed in another ProdLi tab.";
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Something went wrong. Try again.").catch(() => {});
  } finally {
    jobs.delete(meetingId);
    notify();
    setWarning();
  }
  return result;
}

/** Stops a transcription running in this page (the meeting keeps its audio; Retry starts again). */
export function stopUpload(meetingId: string): void {
  jobs.get(meetingId)?.abort.abort();
}

/**
 * Uploads left "processing" when their page closed mid-transcription: mark them
 * so they offer Retry. Call when Meetings opens.
 */
export async function recoverUploads(): Promise<number> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const held = new Set(((await locks?.query().catch(() => null))?.held ?? []).map((l) => l.name));
  const stale = (await listMeetings()).filter((m) => m.platform === "upload" && m.status === "processing" && !jobs.has(m.id) && !held.has(lockName(m.id)));
  for (const m of stale) await updateMeeting(m.id, () => ({ status: "ready", notice: "The page closed before this recording was transcribed. Press Retry to transcribe it." }));
  return stale.length;
}
