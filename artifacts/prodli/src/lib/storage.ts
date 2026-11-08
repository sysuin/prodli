// Key/value storage: chrome.storage in the extension, localStorage in the web preview.

type StorageArea = "local" | "sync";

function isChromeExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

/** Thrown when a write fails (e.g. the browser's storage quota is full). */
export class StorageWriteError extends Error {}

export async function storageGet<T>(key: string, defaultValue: T, area: StorageArea = "local"): Promise<T> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].get([key], (result) => {
        resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
      });
    });
  }
  try {
    const raw = localStorage.getItem(`prodli_${key}`);
    return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function storageSet<T>(key: string, value: T, area: StorageArea = "local"): Promise<void> {
  if (isChromeExtension()) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].set({ [key]: value }, () => {
        const err = chrome.runtime?.lastError;
        if (err) reject(new StorageWriteError(err.message ?? "Couldn't save"));
        else resolve();
      });
    });
  }
  try {
    localStorage.setItem(`prodli_${key}`, JSON.stringify(value));
  } catch (err) {
    throw new StorageWriteError(err instanceof Error ? err.message : "Couldn't save");
  }
}

export async function storageRemove(key: string, area: StorageArea = "local"): Promise<void> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].remove([key], () => resolve());
    });
  }
  localStorage.removeItem(`prodli_${key}`);
}

/**
 * Calls `cb` when `key` changes in another ProdLi tab (or the background).
 * Works in the extension (chrome.storage.onChanged) and the web preview
 * (the "storage" event). Returns an unsubscribe function.
 */
export function onStorageChange<T>(key: string, cb: (value: T | undefined) => void): () => void {
  if (isChromeExtension()) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && key in changes) cb(changes[key].newValue as T | undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = (e: StorageEvent) => {
    if (e.key !== `prodli_${key}`) return;
    try {
      cb(e.newValue === null ? undefined : (JSON.parse(e.newValue) as T));
    } catch {
      // ignore malformed value
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
