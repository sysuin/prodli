// IndexedDB storage for meetings and their audio.
// Meetings and audio are too large for chrome.storage.local (≈10 MB), so they
// live in IndexedDB, which the service worker, offscreen document and UI share.

import type { Meeting } from "./types";
import { recordDeletions } from "../lib/tombstones";

const DB_NAME = "prodli-meetings";
const DB_VERSION = 1;
const MEETINGS = "meetings";
const AUDIO = "audio";
const CHUNKS = "audioChunks";

interface AudioChunk {
  meetingId: string;
  seq: number;
  data: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEETINGS)) db.createObjectStore(MEETINGS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const store = db.createObjectStore(CHUNKS, { keyPath: ["meetingId", "seq"] });
        store.createIndex("byMeeting", "meetingId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const result = await fn(t);
  await done;
  return result;
}

// ── Meetings ──────────────────────────────────────────────────────────────────

/** IndexedDB has no change events; this tells ProdLi sync that meetings changed. */
export const MEETINGS_CHANNEL = "prodli-meetings";
function announceChange(): void {
  try {
    const ch = new BroadcastChannel(MEETINGS_CHANNEL);
    ch.postMessage("changed");
    ch.close();
  } catch {
    // BroadcastChannel unavailable — sync still runs on its timer
  }
}

export async function putMeeting(meeting: Meeting): Promise<void> {
  await tx(MEETINGS, "readwrite", (t) => reqToPromise(t.objectStore(MEETINGS).put(meeting)));
  announceChange();
}

export async function getMeeting(id: string): Promise<Meeting | undefined> {
  return tx(MEETINGS, "readonly", (t) => reqToPromise(t.objectStore(MEETINGS).get(id) as IDBRequest<Meeting | undefined>));
}

/** Read-modify-write a meeting. Returns the updated meeting, or undefined if it doesn't exist. */
export async function updateMeeting(id: string, patch: (m: Meeting) => Partial<Meeting>): Promise<Meeting | undefined> {
  const updated = await tx(MEETINGS, "readwrite", async (t) => {
    const store = t.objectStore(MEETINGS);
    const current = await reqToPromise(store.get(id) as IDBRequest<Meeting | undefined>);
    if (!current) return undefined;
    const next: Meeting = { ...current, ...patch(current), updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(next));
    return next;
  });
  if (updated) announceChange();
  return updated;
}

export async function listMeetings(): Promise<Meeting[]> {
  const all = await tx(MEETINGS, "readonly", (t) => reqToPromise(t.objectStore(MEETINGS).getAll() as IDBRequest<Meeting[]>));
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Deletes a meeting and its audio. `tombstone` marks the deletion for cross-device sync. */
export async function deleteMeeting(id: string, { tombstone = true }: { tombstone?: boolean } = {}): Promise<void> {
  await tx([MEETINGS, AUDIO], "readwrite", async (t) => {
    await reqToPromise(t.objectStore(MEETINGS).delete(id));
    await reqToPromise(t.objectStore(AUDIO).delete(id));
  });
  await deleteChunks(id);
  if (tombstone) await recordDeletions("meetings", [id]).catch(() => {});
  announceChange();
}

/** Removes a meeting's recording but keeps its transcript and notes (auto-delete, recorder/retention.ts). */
export async function deleteMeetingAudio(id: string): Promise<void> {
  await tx(AUDIO, "readwrite", (t) => reqToPromise(t.objectStore(AUDIO).delete(id)));
  await deleteChunks(id);
  await updateMeeting(id, () => ({ hasAudio: false, audioMimeType: null }));
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export async function appendAudioChunk(meetingId: string, seq: number, data: Blob): Promise<void> {
  const chunk: AudioChunk = { meetingId, seq, data };
  await tx(CHUNKS, "readwrite", (t) => reqToPromise(t.objectStore(CHUNKS).put(chunk)));
}

/** Joins all recorded chunks into one Blob, stores it, and removes the chunks. */
export async function finalizeAudio(meetingId: string, mimeType: string): Promise<boolean> {
  const chunks = await tx(CHUNKS, "readonly", (t) =>
    reqToPromise(t.objectStore(CHUNKS).index("byMeeting").getAll(meetingId) as IDBRequest<AudioChunk[]>),
  );
  if (chunks.length === 0) return false;
  chunks.sort((a, b) => a.seq - b.seq);
  // No type given (recovering an interrupted recording): use the chunks' own (WebM, or MP4 on iPhone).
  const blob = new Blob(chunks.map((c) => c.data), { type: mimeType || chunks[0].data.type || "audio/webm" });
  await tx(AUDIO, "readwrite", (t) => reqToPromise(t.objectStore(AUDIO).put(blob, meetingId)));
  await deleteChunks(meetingId);
  return blob.size > 0;
}

/** Stores a whole recording at once (an uploaded file). */
export async function putAudio(meetingId: string, blob: Blob): Promise<void> {
  await tx(AUDIO, "readwrite", (t) => reqToPromise(t.objectStore(AUDIO).put(blob, meetingId)));
}

export async function getAudio(meetingId: string): Promise<Blob | undefined> {
  return tx(AUDIO, "readonly", (t) => reqToPromise(t.objectStore(AUDIO).get(meetingId) as IDBRequest<Blob | undefined>));
}

async function deleteChunks(meetingId: string): Promise<void> {
  await tx(CHUNKS, "readwrite", async (t) => {
    const index = t.objectStore(CHUNKS).index("byMeeting");
    const keys = await reqToPromise(index.getAllKeys(meetingId));
    await Promise.all(keys.map((k) => reqToPromise(t.objectStore(CHUNKS).delete(k))));
  });
}
