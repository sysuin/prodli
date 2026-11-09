// "Recent files" for the Files previewer: the last 10 previewed files are
// kept on this device (IndexedDB) so they can be reopened with one click.
// Files over 1 MB aren't kept. Nothing is uploaded.

import type { OpenedFile } from "./filePreview";

export interface RecentFile extends OpenedFile {
  id: string;
  openedAt: string;
}

const DB = "prodli-files";
const STORE = "recent";
export const MAX_RECENT = 10;
export const MAX_RECENT_BYTES = 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function listRecent(): Promise<RecentFile[]> {
  const all = (await run<RecentFile[]>("readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function addRecent(file: OpenedFile): Promise<void> {
  if (file.size > MAX_RECENT_BYTES) return;
  const id = `${file.name}|${file.size}|${file.lastModified}`;
  await run("readwrite", (s) => s.put({ ...file, id, openedAt: new Date().toISOString() } satisfies RecentFile));
  const all = await listRecent();
  const extra = all.slice(MAX_RECENT);
  if (extra.length) await run("readwrite", (s) => extra.forEach((f) => s.delete(f.id)));
}

export async function removeRecent(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

export async function clearRecent(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}
