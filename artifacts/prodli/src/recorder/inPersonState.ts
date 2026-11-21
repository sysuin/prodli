// Whether an in-person recording is running in this page, and since when.
// Kept apart from recorder/inPerson.ts so the floating chip (App) can show it
// without loading the recorder, transcription and summary code.

/** "room": the microphone (in person). "call": a call in any app (desktop app: computer's sound + microphone). */
export type RecordingKind = "room" | "call";
export interface CurrentRecording {
  meetingId: string;
  startedAt: number;
  kind: RecordingKind;
}

let current: CurrentRecording | null = null;
const listeners = new Set<() => void>();

export function currentInPerson(): CurrentRecording | null {
  return current;
}
export function setCurrentInPerson(v: CurrentRecording | null): void {
  current = v;
  listeners.forEach((f) => f());
}
export function onInPersonChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
