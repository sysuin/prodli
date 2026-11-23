// Auto-delete for meetings (Setup → Meeting notes → "Auto-delete"). Off by
// default. Recordings (audio) and whole meetings each have their own setting;
// deleting a whole meeting also removes it from your other devices (sync).
// Runs in the extension's background twice a day and whenever Meetings opens
// (so the web app applies it too).

import { storageGet } from "../lib/storage";
import type { Meeting } from "./types";

export const RETENTION_KEY = "meetingRetention";
export const AUDIO_RETENTION_CHOICES = [0, 7, 30, 90] as const;
export const MEETING_RETENTION_CHOICES = [0, 30, 90, 365] as const;

export interface MeetingRetention {
  /** Delete recordings older than this many days (0 = keep). Transcripts and notes stay. */
  audioDays: number;
  /** Delete whole meetings older than this many days (0 = keep). */
  meetingDays: number;
}
export const DEFAULT_RETENTION: MeetingRetention = { audioDays: 0, meetingDays: 0 };

const DAY = 86_400_000;
const valid = (n: unknown, choices: readonly number[]) => (typeof n === "number" && choices.includes(n) ? n : 0);

export function cleanRetention(r: Partial<MeetingRetention> | null | undefined): MeetingRetention {
  return { audioDays: valid(r?.audioDays, AUDIO_RETENTION_CHOICES), meetingDays: valid(r?.meetingDays, MEETING_RETENTION_CHOICES) };
}

/** What to delete now. Meetings still recording or being processed are never touched. */
export function retentionPlan(meetings: Pick<Meeting, "id" | "startedAt" | "status" | "hasAudio">[], r: MeetingRetention, now: number): { deleteMeetings: string[]; deleteAudio: string[] } {
  const deleteMeetings: string[] = [];
  const deleteAudio: string[] = [];
  for (const m of meetings) {
    if (m.status === "recording" || m.status === "processing") continue;
    const age = now - Date.parse(m.startedAt);
    if (!Number.isFinite(age)) continue;
    if (r.meetingDays && age > r.meetingDays * DAY) deleteMeetings.push(m.id);
    else if (r.audioDays && m.hasAudio && age > r.audioDays * DAY) deleteAudio.push(m.id);
  }
  return { deleteMeetings, deleteAudio };
}

/** Applies the user's auto-delete setting. Returns how many meetings and recordings were removed. */
export async function applyRetention(now = Date.now()): Promise<{ meetings: number; recordings: number }> {
  const r = cleanRetention(await storageGet<MeetingRetention>(RETENTION_KEY, DEFAULT_RETENTION));
  if (!r.audioDays && !r.meetingDays) return { meetings: 0, recordings: 0 };
  const db = await import("./db");
  const plan = retentionPlan(await db.listMeetings(), r, now);
  for (const id of plan.deleteMeetings) await db.deleteMeeting(id);
  for (const id of plan.deleteAudio) await db.deleteMeetingAudio(id);
  return { meetings: plan.deleteMeetings.length, recordings: plan.deleteAudio.length };
}

const ALARM = "meeting_retention";

/** Extension background: run at start-up and every 12 hours. */
export function registerMeetingRetention(): void {
  chrome.alarms.create(ALARM, { periodInMinutes: 720, delayInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void applyRetention().catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[RETENTION_KEY]) void applyRetention().catch(() => {});
  });
}
