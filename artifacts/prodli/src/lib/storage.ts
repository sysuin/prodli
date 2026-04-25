type StorageArea = 'local' | 'sync';

declare const chrome: {
  storage: {
    local: {
      get: (keys: string[], callback: (result: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
      remove: (keys: string[], callback?: () => void) => void;
    };
    sync: {
      get: (keys: string[], callback: (result: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, callback?: () => void) => void;
      remove: (keys: string[], callback?: () => void) => void;
    };
  };
};

function isChromeExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage;
}

export async function storageGet<T>(key: string, defaultValue: T, area: StorageArea = 'local'): Promise<T> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] as T : defaultValue);
      });
    });
  }
  try {
    const raw = localStorage.getItem(`prodli_${key}`);
    return raw !== null ? JSON.parse(raw) as T : defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function storageSet<T>(key: string, value: T, area: StorageArea = 'local'): Promise<void> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].set({ [key]: value }, resolve);
    });
  }
  try {
    localStorage.setItem(`prodli_${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function storageRemove(key: string, area: StorageArea = 'local'): Promise<void> {
  if (isChromeExtension()) {
    return new Promise((resolve) => {
      chrome.storage[area].remove([key], resolve);
    });
  }
  localStorage.removeItem(`prodli_${key}`);
}
