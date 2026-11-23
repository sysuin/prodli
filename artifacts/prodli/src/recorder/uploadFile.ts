// Meetings → ⬆ Upload recording: which files are accepted, the limits, and the
// title and date a new meeting starts with. Pure (unit-tested); the upload
// itself is in recorder/upload.ts.

import type { MediaFormat } from "./mediaFormats";

/** For the file picker. */
export const UPLOAD_ACCEPT = "audio/*,video/mp4,video/webm,video/quicktime,video/x-m4v,.m4a,.mp3,.wav,.ogg,.oga,.opus,.aac,.flac,.webm,.mp4,.m4v,.mov";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_SECONDS = 3 * 3600;
/** Formats the browser has to decode in one go (not in pieces): kept shorter so it doesn't run out of memory. */
export const MAX_WHOLE_DECODE_SECONDS = 3600;

const EXT_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  webm: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime|x-m4v)$/i;

const extension = (name: string) => /\.([a-z0-9]{1,5})$/i.exec(name)?.[1].toLowerCase() ?? "";

/** An audio or video file ProdLi can try to transcribe? (By its type, or its extension when the type is missing.) */
export function isRecordingFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith("audio/") || VIDEO_TYPES.test(type)) return true;
  return extension(file.name) in EXT_TYPES;
}

/** The file's type, from its extension when the browser didn't give one. */
export function uploadMimeType(file: { name: string; type: string }): string {
  return file.type || EXT_TYPES[extension(file.name)] || "application/octet-stream";
}

/** "Team sync 2026-11-20.m4a" → "Team sync 2026-11-20". */
export function defaultUploadTitle(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/\s+/g, " ").trim();
  return (base || "Uploaded recording").slice(0, 200);
}

/** When it was recorded: the file's last-modified time, unless that's missing or in the future. */
export function defaultUploadDate(lastModified: number | undefined, now = Date.now()): Date {
  return new Date(lastModified && Number.isFinite(lastModified) && lastModified > 0 && lastModified <= now ? lastModified : now);
}

const pad = (n: number) => String(n).padStart(2, "0");
/** For <input type="datetime-local">, in local time. */
export function toDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** From <input type="datetime-local">; null if it isn't a date. */
export function fromDateTimeLocal(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Why this file can't be uploaded, in plain words (null when it can).
 * `durationSec`: from the browser (null when it couldn't tell). `format`: from the file's first bytes.
 */
export function uploadProblem(file: { name: string; type: string; size: number }, durationSec: number | null, format?: MediaFormat): string | null {
  if (!isRecordingFile(file)) return "That isn't an audio or video file. Try an MP3, M4A, WAV, MP4 or WebM file.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return `This file is ${formatBytes(file.size)}. Files up to 500 MB can be uploaded: for a long video, save just the audio (e.g. as M4A or MP3) and upload that.`;
  if (durationSec !== null && durationSec > MAX_UPLOAD_SECONDS) return "Recordings up to 3 hours can be uploaded. Split a longer one into parts and upload each.";
  const whole = format === "ogg" || format === "flac" || format === "unknown";
  if (whole && durationSec !== null && durationSec > MAX_WHOLE_DECODE_SECONDS) return "Recordings over 1 hour need to be MP3, M4A, MP4, WAV or WebM. Convert this one, or split it into parts.";
  return null;
}
