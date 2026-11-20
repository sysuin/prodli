// Meetings on the phone: recorded by the extension on a computer, synced here
// as text (transcripts, summaries, action items). Audio never syncs.
import { useMemo } from "react";
import { read, useStored, write } from "./store";
import { recordDeletions } from "./tombstones";

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
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
  model: string;
  generatedAt: string;
}

/** The fields the phone reads; everything else in a synced meeting is kept as is. */
export interface Meeting {
  id: string;
  platform?: string;
  title: string;
  url?: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  status: "recording" | "processing" | "ready" | "error";
  transcript: TranscriptEntry[];
  summary: MeetingSummary | null;
  error: string | null;
  notice?: string | null;
  template?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export const MEETINGS_KEY = "meetings";

export function useMeetings(): Meeting[] {
  const all = useStored<Meeting[]>(MEETINGS_KEY, []);
  return useMemo(() => [...all].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")), [all]);
}

export function useMeeting(id: string): Meeting | undefined {
  const all = useStored<Meeting[]>(MEETINGS_KEY, []);
  return useMemo(() => all.find((m) => m.id === id), [all, id]);
}

export function updateMeeting(id: string, patch: Partial<Meeting>): void {
  const now = new Date().toISOString();
  write(MEETINGS_KEY, read<Meeting[]>(MEETINGS_KEY, []).map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)));
}

/** Deletes everywhere (the tombstone tells other devices it was on purpose). */
export function deleteMeeting(id: string): void {
  recordDeletions("meetings", [id]);
  write(MEETINGS_KEY, read<Meeting[]>(MEETINGS_KEY, []).filter((m) => m.id !== id));
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The same transcript text the extension sends to the summarizer. */
export const transcriptToText = (t: TranscriptEntry[]): string => t.map((e) => `[${formatTimestamp(e.startMs)}] ${e.speaker}: ${e.text}`).join("\n");

export function durationLabel(sec: number): string {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
