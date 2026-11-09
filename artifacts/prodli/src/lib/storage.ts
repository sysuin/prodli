// Key/value storage: chrome.storage in the extension, localStorage in the web preview.

type StorageArea = "local" | "sync";

function isChromeExtension(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

// The web build has no chrome.storage.onChanged. The browser's "storage" event
// only reaches *other* tabs, so same-tab writes are announced with this event
// (matching the extension, where the writing page is notified too).
const LOCAL_EVENT = "prodli-storage";
function announce(key: string, newValue: unknown): void {
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: { key, newValue } }));
  } catch {
    // no window (tests / workers)
  }
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
  announce(key, value);
}

export async function storageRemove(key: string, area: StorageArea = "local"): Promise<void> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].remove([key], () => resolve());
    });
  }
  localStorage.removeItem(`prodli_${key}`);
  announce(key, undefined);
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
  const local = (e: Event) => {
    const d = (e as CustomEvent<{ key: string; newValue: unknown }>).detail;
    if (d?.key === key) cb(d.newValue as T | undefined);
  };
  window.addEventListener("storage", listener);
  window.addEventListener(LOCAL_EVENT, local);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(LOCAL_EVENT, local);
  };
}

/** Calls `cb` with the names of keys that changed (any tab, including this one). */
export function onAnyStorageChange(cb: (keys: string[]) => void): () => void {
  if (isChromeExtension()) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local") cb(Object.keys(changes));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const other = (e: StorageEvent) => e.key?.startsWith("prodli_") && cb([e.key.slice(7)]);
  const local = (e: Event) => {
    const d = (e as CustomEvent<{ key: string }>).detail;
    if (d?.key) cb([d.key]);
  };
  window.addEventListener("storage", other);
  window.addEventListener(LOCAL_EVENT, local);
  return () => {
    window.removeEventListener("storage", other);
    window.removeEventListener(LOCAL_EVENT, local);
  };
}

/** Every stored key/value (used to find per-day Time Tracker keys). */
export async function storageGetAll(): Promise<Record<string, unknown>> {
  if (isChromeExtension()) return new Promise((resolve) => chrome.storage.local.get(null, (all) => resolve(all as Record<string, unknown>)));
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("prodli_")) continue;
    try {
      out[k.slice(7)] = JSON.parse(localStorage.getItem(k)!);
    } catch {
      // skip unreadable values
    }
  }
  return out;
}
