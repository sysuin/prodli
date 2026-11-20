// Runs sync in the app: shortly after local edits, when the app comes to the
// foreground, every few minutes while it's open, and right away when another
// device changes something (a live WebSocket that only says "something
// changed"; data always comes through /api/sync).
import { AppState, type AppStateStatus } from "react-native";
import * as Crypto from "expo-crypto";
import { AccountError, apiBase, getAccount, hasSession, request, ACCOUNT_KEY } from "./api";
import { onAnyChange, subscribe, useStored } from "./store";
import { deviceId, EMPTY_STATUS, syncOnce, SYNC_STATUS_KEY, WATCHED_KEYS, type SyncStatus, type Transport } from "./sync";

export const transport: Transport = {
  post: <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  isOffline: (err) => err instanceof AccountError && err.status === 0,
  isSignedOut: (err) => err instanceof AccountError && err.status === 401,
};

const EVERY_MS = 5 * 60_000;
let started = false;

export function syncNow(onlyIfLocalChanges = false): Promise<void> {
  const user = getAccount();
  if (!user || !hasSession()) return Promise.resolve();
  return syncOnce(user.id, transport, { onlyIfLocalChanges }).catch(() => {
    // the status records the error; the next trigger retries
  });
}

/** Starts background syncing for the life of the app. Safe to call more than once. */
export function startSync(): void {
  if (started) return;
  started = true;
  deviceId(() => Crypto.getRandomBytes(12));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFull = false;
  const schedule = (full: boolean, delay: number) => {
    pendingFull = pendingFull || full;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const f = pendingFull;
      pendingFull = false;
      void syncNow(!f);
    }, delay);
  };

  onAnyChange((key) => {
    if (WATCHED_KEYS.has(key)) schedule(false, 700);
  });

  let ws: WebSocket | null = null;
  let backoff = 2000;
  let wsTimer: ReturnType<typeof setTimeout> | undefined;
  let foreground = AppState.currentState === "active";

  const closeLive = () => {
    clearTimeout(wsTimer);
    const s = ws;
    ws = null;
    s?.close();
  };
  const openLive = async () => {
    if (ws || !foreground || !getAccount() || !hasSession()) return;
    try {
      const { path } = await request<{ path: string }>("/api/sync/ticket", { method: "POST", body: JSON.stringify({ deviceId: deviceId() }) });
      if (!foreground || ws) return;
      const socket = new WebSocket(apiBase().replace(/^http/, "ws") + path);
      ws = socket;
      socket.onopen = () => (backoff = 2000);
      socket.onmessage = () => schedule(true, 200);
      socket.onclose = () => {
        if (ws !== socket) return;
        ws = null;
        if (foreground) wsTimer = setTimeout(() => void openLive(), (backoff = Math.min(backoff * 2, 60_000)));
      };
    } catch {
      if (foreground) wsTimer = setTimeout(() => void openLive(), (backoff = Math.min(backoff * 2, 60_000)));
    }
  };

  let interval: ReturnType<typeof setInterval> | undefined;
  const onState = (s: AppStateStatus) => {
    foreground = s === "active";
    if (foreground) {
      schedule(true, 0);
      void openLive();
      clearInterval(interval);
      interval = setInterval(() => schedule(true, 0), EVERY_MS);
    } else {
      clearInterval(interval);
      closeLive();
      void syncNow(true); // send what was just typed before the phone suspends the app
    }
  };
  AppState.addEventListener("change", onState);
  onState(AppState.currentState as AppStateStatus);

  // Signing in or out starts or stops the live connection.
  subscribe(ACCOUNT_KEY, () => {
    if (getAccount()) {
      schedule(true, 0);
      void openLive();
    } else closeLive();
  });
}

export const useSyncStatus = (): SyncStatus => useStored<SyncStatus>(SYNC_STATUS_KEY, EMPTY_STATUS);
