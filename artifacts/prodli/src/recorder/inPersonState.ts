// Whether an in-person recording is running in this page, and since when.
// Kept apart from recorder/inPerson.ts so the floating chip (App) can show it
// without loading the recorder, transcription and summary code.

let current: { meetingId: string; startedAt: number } | null = null;
const listeners = new Set<() => void>();

export function currentInPerson(): { meetingId: string; startedAt: number } | null {
  return current;
}
export function setCurrentInPerson(v: { meetingId: string; startedAt: number } | null): void {
  current = v;
  listeners.forEach((f) => f());
}
export function onInPersonChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
