// The ProdLi desktop app (artifacts/prodli-desktop, Electron) runs this same
// React code and exposes a small, typed bridge as `window.prodliDesktop` (its
// preload script). Everything here is a no-op outside the desktop app.
//
// The bridge is the only way the page reaches the computer: storage on disk,
// signing in through the system browser, recording calls from any app, and a
// few window helpers. The page never gets Node or Electron itself.

export type DesktopPlatform = "mac" | "windows" | "linux";

export interface StorageChange {
  key: string;
  newValue: unknown;
}

/** App preferences kept by the app itself (not synced). */
export interface DesktopPrefs {
  openAtLogin: boolean;
  keepRunning: boolean;
}

/** A local file opened with the app (File → Open, Open With, dropped on the dock icon). */
export interface OpenedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export type DesktopSignInResult = { ok: true } | { ok: false; error: string; cancelled?: boolean };

export interface DesktopBridge {
  platform: DesktopPlatform;
  version: string;
  /** The saved theme when this window opened, for a first paint without a flash. */
  initialTheme: "light" | "dark" | null;
  /** chrome.storage-like key/value store kept on disk by the app (the session token is encrypted with the OS keychain). */
  storage: {
    get(key: string): Promise<unknown>;
    getAll(): Promise<Record<string, unknown>>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    /** Every change from any ProdLi window, including this one (like chrome.storage.onChanged). */
    onChanged(cb: (changes: StorageChange[]) => void): () => void;
  };
  account: {
    /** Opens app.prodli.com in the system browser and waits for the hand-off back (see prodli-api/src/desktopAuth.ts). */
    signIn(): Promise<DesktopSignInResult>;
    cancelSignIn(): Promise<void>;
  };
  prefs: {
    get(): Promise<DesktopPrefs>;
    set(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  };
  files: {
    /** Files waiting for the Files viewer (taken once). */
    take(): Promise<OpenedFile[]>;
    /** New files are waiting: call take(). */
    onAvailable(cb: () => void): () => void;
    openDialog(): Promise<void>;
  };
  /** Opens an http(s) or mailto link in the default browser / mail app. */
  openExternal(url: string): Promise<void>;
  /** Whether the app may record what the computer plays (other apps' call audio). */
  systemAudio(): Promise<{ supported: boolean; permission: "granted" | "denied" | "not-determined" | "restricted" | "unknown" }>;
  /** macOS: opens System Settings at Screen & System Audio Recording. */
  openSystemAudioSettings(): Promise<void>;
  /** The Quick add window calls this when it's done. */
  closeWindow(): void;
  /** Main window: sections opened from the menu bar / tray / dock menu ("today", "quick-add", …). */
  onCommand(cb: (command: string) => void): () => void;
  /** Sets the dock / taskbar badge. Empty string clears it. */
  setBadge(text: string): void;
  /** Tells the app a recording started / stopped (tray menu, dock badge, "quit while recording?"). */
  setRecording(recording: boolean): void;
}

declare global {
  interface Window {
    prodliDesktop?: DesktopBridge;
  }
}

export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" && window.prodliDesktop ? window.prodliDesktop : null;
}

export function isDesktop(): boolean {
  return desktop() !== null;
}

/** "Mac" / "Windows" for wording ("Download for Mac"). */
export function desktopPlatformName(p: DesktopPlatform | undefined = desktop()?.platform): string {
  return p === "mac" ? "Mac" : p === "windows" ? "Windows" : p === "linux" ? "Linux" : "computer";
}
