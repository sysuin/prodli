// Shared videos, the app side: uploads a screen recording to ProdLi in equal
// parts (resuming parts already sent, retrying each a few times), finishes it,
// and keeps the page's notes up to date when the transcript and summary arrive.
// Server: prodli-api/src/videos.ts.

import { accountRequest } from "../lib/prodliAccount";
import { getAudio, getMeeting, updateMeeting } from "../recorder/db";
import type { Meeting } from "../recorder/types";

export interface SharedVideo {
  id: string;
  url: string;
  status: "uploading" | "ready";
  partSize: number;
  parts: number[];
  views: number;
}

const VIDEO_MESSAGES = {
  videos_unavailable: "Video links aren't available right now. Try again later.",
  rate_limited: "Too many uploads at once. Try again in a minute.",
};

/** The notes and transcript shown on the page (no audio or private settings). */
export function videoDetails(m: Meeting) {
  return {
    title: (m.summary?.title || m.title).slice(0, 300),
    summary: m.summary ? { overview: m.summary.overview, keyPoints: m.summary.keyPoints, decisions: m.summary.decisions, actionItems: m.summary.actionItems.map((a) => ({ task: a.task, owner: a.owner, dueDate: a.dueDate })), openQuestions: m.summary.openQuestions } : null,
    transcript: m.transcript.slice(0, 4000).map((e) => ({ at: Math.max(0, Math.round(e.startMs)), speaker: e.speaker.slice(0, 80), text: e.text.slice(0, 2000) })),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads the recording (if it isn't already) and returns its link. `onProgress` gets 0–1. */
export async function shareVideo(meetingId: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<SharedVideo> {
  const meeting = await getMeeting(meetingId);
  const blob = await getAudio(meetingId);
  if (!meeting || !blob) throw new Error("The video isn't on this device any more.");
  const { video, uploaded } = await accountRequest<{ video: SharedVideo; uploaded: boolean }>(
    "/api/videos",
    {
      method: "POST",
      body: JSON.stringify({ meetingId, title: (meeting.summary?.title || meeting.title).slice(0, 300), date: meeting.startedAt.slice(0, 10), durationSec: Math.max(1, meeting.durationSec), size: blob.size, mime: blob.type || meeting.audioMimeType || "video/webm" }),
    },
    VIDEO_MESSAGES,
  );
  if (!uploaded) {
    const total = Math.max(1, Math.ceil(blob.size / video.partSize));
    const done = new Set(video.parts);
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!done.has(n)) {
        const part = blob.slice((n - 1) * video.partSize, n * video.partSize);
        for (let attempt = 1; ; attempt++) {
          try {
            await accountRequest(`/api/videos/${encodeURIComponent(video.id)}/parts/${n}`, { method: "PUT", body: part, headers: { "Content-Type": "application/octet-stream" }, signal }, VIDEO_MESSAGES);
            break;
          } catch (err) {
            if (signal?.aborted || attempt >= 4 || ((err as { status?: number }).status ?? 500) < 500) throw err;
            await sleep(1000 * 2 ** attempt);
          }
        }
      }
      onProgress(n / total);
    }
    await accountRequest(`/api/videos/${encodeURIComponent(video.id)}/complete`, { method: "POST", body: JSON.stringify(videoDetails(meeting)) }, VIDEO_MESSAGES);
  } else onProgress(1);
  await updateMeeting(meetingId, () => ({ videoShare: { id: video.id, url: video.url, notesAt: meeting.summary?.generatedAt ?? null } }));
  return { ...video, status: "ready" };
}

/** Sends the notes again when the summary arrived (or changed) after the video was shared. */
export async function refreshVideoNotes(m: Meeting): Promise<boolean> {
  if (!m.videoShare || !m.summary || m.videoShare.notesAt === m.summary.generatedAt) return false;
  await accountRequest(`/api/videos/${encodeURIComponent(m.videoShare.id)}`, { method: "PUT", body: JSON.stringify(videoDetails(m)) }, VIDEO_MESSAGES);
  await updateMeeting(m.id, (cur) => ({ videoShare: cur.videoShare ? { ...cur.videoShare, notesAt: m.summary!.generatedAt } : cur.videoShare }));
  return true;
}

/** Stops sharing: the page and the uploaded file are removed (the video stays on this device). */
export async function unshareVideo(m: Meeting): Promise<void> {
  if (m.videoShare) await accountRequest(`/api/videos/${encodeURIComponent(m.videoShare.id)}`, { method: "DELETE" }).catch((err: { status?: number }) => {
    if (err.status !== 404) throw err;
  });
  await updateMeeting(m.id, () => ({ videoShare: undefined }));
}

export async function videoViews(id: string): Promise<number | null> {
  const r = await accountRequest<{ videos: { id: string; views: number }[] }>("/api/videos").catch(() => null);
  return r?.videos.find((v) => v.id === id)?.views ?? null;
}
