// ProdLi sync (phase 2 of docs/PLAN-WEB-APP.md): keeps notes, to-dos, habits,
// meetings (text only — audio never leaves the device), Pomodoro history and
// Time Tracker history the same on every device signed in to the same ProdLi
// account. Settings (theme, fonts, API keys…) stay per device.
//
// Local-first: every device keeps its full copy and works offline. The server
// (one private database per user) is the meeting point. Logic: syncCore.ts.
//
// Who runs it:
// - In open ProdLi pages, one tab at a time is the "leader" (Web Locks). It
//   syncs shortly after local edits and holds a WebSocket for live updates.
// - The extension's background syncs every 15 minutes, so data stays current
//   even with no ProdLi tab open.
// A shared lock makes sure two syncs never run at once.

import { AUTO_BACKUP_KEY, ACCOUNT_KEY as DRIVE_ACCOUNT_KEY, googleConfigured, syncWithDrive } from "./google";
import { accountRequest, apiBase, getProdliAccount, onProdliAccountChange, AccountError, type ProdliUser } from "./prodliAccount";
import { onAnyStorageChange, onStorageChange, storageGet, storageGetAll, storageRemove, storageSet } from "./storage";
import { batches, decide, localChanges, normStamp, pushedHash, shadowKey, type Change, type Coll, type CollectionState, type Incoming, type Kind, type LocalItem } from "./syncCore";
import { getTombstones } from "./tombstones";
import { deleteMeeting, getMeeting, listMeetings, MEETINGS_CHANNEL, putMeeting } from "../recorder/db";
import type { Meeting } from "../recorder/types";

import { SYNC_STATE_KEY, SYNC_STATUS_KEY } from "./prodliAccount";
export { SYNC_STATE_KEY, SYNC_STATUS_KEY };
export const DEVICE_ID_KEY = "prodliDeviceId";
/** Per device: whether meetings recorded here are uploaded (transcripts contain other people's words). */
export const SYNC_MEETINGS_KEY = "prodliSyncMeetings";
export const SYNC_ALARM = "prodli_sync";

const TRACKING_EVERY_MS = 15 * 60_000;
const TRACKING_DAY = /^tt_(\d{4}-\d{2}-\d{2})$/;

interface SyncState {
  userId: string;
  seq: number;
  shadow: Record<string, string>;
  lastTrackingPush: number;
  driveImported?: boolean;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error";
  lastSyncAt: number | null;
  error: string | null;
  /** Items skipped because they're larger than the server accepts. */
  tooLarge: number;
  usage: { bytes: number; quota: number } | null;
}

interface SyncResponse {
  seq: number;
  changes: Incoming[];
  more: boolean;
  usage: { bytes: number; quota: number };
}

// ── Collections on this device ───────────────────────────────────────────────

interface Adapter {
  c: Coll;
  kind: Kind;
  deletable: boolean;
  /** See CollectionState.requireTombstone. */
  requireTombstone?: boolean;
  /** Ids present here that aren't sent right now (see CollectionState.held). */
  held?: () => Promise<Set<string>>;
  read(): Promise<Map<string, LocalItem>>;
  apply(puts: Map<string, unknown>, deletes: Set<string>): Promise<void>;
}

type Stamped = { id: string; updatedAt?: unknown; createdAt?: unknown };

function listAdapter(c: "notes" | "todos" | "habits" | "days", newOnTop: boolean): Adapter {
  return {
    c,
    kind: "lww",
    deletable: true,
    async read() {
      const items = await storageGet<Stamped[]>(c, []);
      return new Map(items.filter((i) => typeof i?.id === "string").map((i) => [i.id, { u: normStamp(i.updatedAt ?? i.createdAt), v: i }]));
    },
    async apply(puts, deletes) {
      const items = (await storageGet<Stamped[]>(c, [])).filter((i) => !deletes.has(i.id));
      const fresh: Stamped[] = [];
      for (const [id, value] of puts) {
        const at = items.findIndex((i) => i.id === id);
        if (at >= 0) items[at] = value as Stamped;
        else fresh.push(value as Stamped);
      }
      await storageSet(c, newOnTop ? [...fresh, ...items] : [...items, ...fresh]);
    },
  };
}

const live = (m: Meeting) => m.status === "recording" || m.status === "processing";

const meetingsAdapter: Adapter = {
  c: "meetings",
  kind: "lww",
  deletable: true,
  // Every deletion of a meeting goes through deleteMeeting(), which records it.
  requireTombstone: true,
  // Being recorded or summarized: not uploaded yet, but certainly not deleted.
  async held() {
    return new Set((await listMeetings()).filter(live).map((m) => m.id));
  },
  async read() {
    const out = new Map<string, LocalItem>();
    // Upload only finished meetings, and never audio.
    for (const m of await listMeetings()) if (!live(m)) out.set(m.id, { u: normStamp(m.updatedAt), v: { ...m, hasAudio: false, audioMimeType: null } });
    return out;
  },
  async apply(puts, deletes) {
    for (const id of deletes) {
      const mine = await getMeeting(id);
      if (mine && !live(mine)) await deleteMeeting(id, { tombstone: false });
    }
    for (const [id, value] of puts) {
      const mine = await getMeeting(id);
      if (mine && live(mine)) continue; // never touch a recording in progress
      const m = value as Meeting;
      await putMeeting({ ...m, status: live(m) ? "ready" : m.status, hasAudio: mine?.hasAudio ?? false, audioMimeType: mine?.audioMimeType ?? null });
    }
  },
};

const pomodoroSessionsAdapter: Adapter = {
  c: "pomodoroSessions",
  kind: "lww",
  deletable: false, // "Clear history" here shouldn't wipe other devices' history
  async read() {
    const items = await storageGet<{ id: string; completedAt: string }[]>("pomodoroSessions", []);
    return new Map(items.map((s) => [s.id, { u: normStamp(s.completedAt), v: s }]));
  },
  async apply(puts) {
    const items = await storageGet<{ id: string; completedAt: string }[]>("pomodoroSessions", []);
    const byId = new Map(items.map((s) => [s.id, s]));
    for (const [id, v] of puts) byId.set(id, v as { id: string; completedAt: string });
    await storageSet("pomodoroSessions", [...byId.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 20));
  },
};

const statsAdapter: Adapter = {
  c: "stats",
  kind: "max",
  deletable: false,
  async read() {
    const n = await storageGet<number>("completedPomodoros", 0);
    return new Map(n > 0 ? [["completedPomodoros", { u: "", v: n }]] : []);
  },
  async apply(puts) {
    const n = puts.get("completedPomodoros");
    if (typeof n === "number") await storageSet("completedPomodoros", n);
  },
};

const trackingAdapter: Adapter = {
  c: "tracking",
  kind: "max",
  deletable: false,
  async read() {
    const out = new Map<string, LocalItem>();
    for (const [k, v] of Object.entries(await storageGetAll())) {
      const m = TRACKING_DAY.exec(k);
      if (m && v && typeof v === "object") out.set(m[1], { u: "", v });
    }
    return out;
  },
  async apply(puts) {
    for (const [day, v] of puts) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) await storageSet(`tt_${day}`, v);
  },
};

const ADAPTERS: Adapter[] = [
  listAdapter("notes", true),
  listAdapter("todos", true),
  listAdapter("habits", false),
  listAdapter("days", true),
  meetingsAdapter,
  pomodoroSessionsAdapter,
  statsAdapter,
  trackingAdapter,
];

/** Storage keys whose change means "sync soon". (Time Tracker days sync every 15 minutes instead.) */
const WATCHED_KEYS = new Set(["notes", "todos", "habits", "days", "pomodoroSessions", "completedPomodoros"]);

// ── State ────────────────────────────────────────────────────────────────────

async function deviceId(): Promise<string> {
  let id = await storageGet<string | null>(DEVICE_ID_KEY, null);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    await storageSet(DEVICE_ID_KEY, id);
  }
  return id;
}

async function loadState(user: ProdliUser): Promise<SyncState> {
  const s = await storageGet<SyncState | null>(SYNC_STATE_KEY, null);
  // A different account (or the first sync): start fresh. Local data is merged into this account.
  if (!s || s.userId !== user.id) return { userId: user.id, seq: 0, shadow: {}, lastTrackingPush: 0 };
  return s;
}

const EMPTY_STATUS: SyncStatus = { state: "idle", lastSyncAt: null, error: null, tooLarge: 0, usage: null };

export function getSyncStatus(): Promise<SyncStatus> {
  return storageGet<SyncStatus>(SYNC_STATUS_KEY, EMPTY_STATUS);
}

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  return onStorageChange<SyncStatus>(SYNC_STATUS_KEY, (v) => cb(v ?? EMPTY_STATUS));
}

async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
  await storageSet(SYNC_STATUS_KEY, { ...(await getSyncStatus()), ...patch });
}

/** After signing out: forget what this device knows about the server (local data stays). */
export async function resetSyncState(): Promise<void> {
  await Promise.all([storageRemove(SYNC_STATE_KEY), storageRemove(SYNC_STATUS_KEY)]);
}

// ── One sync ─────────────────────────────────────────────────────────────────

export interface CycleOptions {
  /** Skip the network entirely if nothing changed here (used after local edits). */
  onlyIfLocalChanges?: boolean;
  /** Push Time Tracker changes now instead of waiting for the 15-minute window. */
  forceTracking?: boolean;
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks.request("prodli-sync-run", fn) as Promise<T>) : fn();
}

/** One-time: bring in what's in the user's Google Drive copy before the first ProdLi sync. */
async function importFromDrive(): Promise<void> {
  try {
    if (!googleConfigured() || !(await storageGet(DRIVE_ACCOUNT_KEY, null))) return;
    await syncWithDrive(true, false); // merges the Drive copy into this device
    await storageSet(AUTO_BACKUP_KEY, false); // ProdLi sync replaces Drive sync
  } catch {
    // Drive unavailable: local data still syncs; nothing is lost.
  }
}

export function syncOnce(opts: CycleOptions = {}): Promise<void> {
  return withLock(() => cycle(opts));
}

async function cycle(opts: CycleOptions): Promise<void> {
  const user = await getProdliAccount();
  if (!user) return;
  const state = await loadState(user);
  const device = await deviceId();
  if (!state.driveImported && state.seq === 0) {
    await importFromDrive();
    state.driveImported = true;
  }
  const now = Date.now();
  const includeTracking = opts.forceTracking || state.seq === 0 || now - state.lastTrackingPush >= TRACKING_EVERY_MS;
  const syncMeetingsFromHere = await storageGet<boolean>(SYNC_MEETINGS_KEY, true);
  const pushes = (a: Adapter) => (a.c !== "tracking" || includeTracking) && (a.c !== "meetings" || syncMeetingsFromHere);

  let tooLarge = 0;
  let usage: SyncResponse["usage"] | null = null;
  let contacted = false;
  try {
    for (let round = 0; round < 3; round++) {
      const local = new Map<Coll, Map<string, LocalItem>>();
      const held = new Map<Coll, Set<string>>();
      for (const a of ADAPTERS) {
        local.set(a.c, await a.read());
        if (a.held) held.set(a.c, await a.held());
      }
      const cols: CollectionState[] = ADAPTERS.filter(pushes).map((a) => ({ c: a.c, kind: a.kind, deletable: a.deletable, local: local.get(a.c)!, requireTombstone: a.requireTombstone, held: held.get(a.c) }));
      const tomb = await getTombstones();
      const { changes, tooLarge: big, missing } = localChanges(cols, state.shadow, tomb, new Date().toISOString());
      // Synced before, gone here without being deleted (e.g. this browser's storage was
      // cleared): forget we had them and download everything again; nothing is deleted.
      if (missing.length) {
        for (const key of missing) delete state.shadow[key];
        state.seq = 0;
      }
      tooLarge = big.length;
      if (round === 0 && opts.onlyIfLocalChanges && changes.length === 0 && !missing.length) return;
      if (round > 0 && changes.length === 0) break;

      if (!contacted) await setStatus({ state: "syncing" });
      contacted = true;
      let again = false;
      for (const batch of changes.length ? batches(changes) : [[] as Change[]]) {
        let res = await accountRequest<SyncResponse>("/api/sync", { method: "POST", body: JSON.stringify({ deviceId: device, since: state.seq, changes: batch }) });
        const kinds = new Map(ADAPTERS.map((a) => [a.c, a.kind]));
        for (const ch of batch) state.shadow[shadowKey(ch.c, ch.id)] = pushedHash(kinds.get(ch.c)!, ch);
        for (;;) {
          again = (await applyIncoming(res.changes, local, state, pushes)) || again;
          state.seq = res.seq;
          usage = res.usage;
          if (!res.more) break;
          res = await accountRequest<SyncResponse>("/api/sync", { method: "POST", body: JSON.stringify({ deviceId: device, since: state.seq, changes: [] }) });
        }
        await storageSet(SYNC_STATE_KEY, state);
      }
      if (includeTracking) state.lastTrackingPush = now;
      await storageSet(SYNC_STATE_KEY, state);
      if (!again) break;
    }
    if (contacted) await setStatus({ state: "idle", lastSyncAt: Date.now(), error: null, tooLarge, usage });
  } catch (err) {
    await storageSet(SYNC_STATE_KEY, state); // keep what did get through
    if (err instanceof AccountError && err.status === 401) return; // signed out; the account panel shows it
    const offline = err instanceof AccountError && err.status === 0;
    await setStatus({ state: offline ? "offline" : "error", error: err instanceof Error ? err.message : String(err), tooLarge });
    if (!offline) throw err;
  }
}

/** Applies server versions here. Returns true if this device has newer data to send back. */
async function applyIncoming(changes: Incoming[], local: Map<Coll, Map<string, LocalItem>>, state: SyncState, pushes: (a: Adapter) => boolean): Promise<boolean> {
  let again = false;
  for (const a of ADAPTERS) {
    const mine = changes.filter((ch) => ch.c === a.c);
    if (!mine.length) continue;
    const items = local.get(a.c)!;
    const puts = new Map<string, unknown>();
    const deletes = new Set<string>();
    // Remembered only once applied here: a pull that fails half-way must not leave
    // fingerprints of items this device doesn't have (they'd look deleted here).
    const shadows: [string, string][] = [];
    for (const inc of mine) {
      const { decision, shadow, again: newerHere } = decide(a.kind, inc, items.get(inc.id));
      shadows.push([shadowKey(a.c, inc.id), shadow]);
      if (newerHere && pushes(a)) again = true;
      if (decision.action === "put") {
        puts.set(inc.id, decision.value);
        items.set(inc.id, { u: inc.u, v: decision.value });
      } else if (decision.action === "delete") {
        deletes.add(inc.id);
        items.delete(inc.id);
      }
    }
    if (puts.size || deletes.size) await a.apply(puts, deletes);
    for (const [key, shadow] of shadows) state.shadow[key] = shadow;
  }
  return again;
}

// ── Leader (open pages) ──────────────────────────────────────────────────────

/**
 * Starts sync in this page. Only one ProdLi page at a time actually syncs and
 * holds the live connection; the others take over if it closes.
 * Returns a function that stops it.
 */
export function startSync(): () => void {
  let stopLeading: (() => void) | null = null;
  const abort = new AbortController();
  const lead = () =>
    new Promise<void>((release) => {
      if (abort.signal.aborted) return release();
      const stop = runLeader();
      stopLeading = () => {
        stop();
        release();
      };
    });
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) locks.request("prodli-sync-leader", { signal: abort.signal }, lead).catch(() => {});
  else void lead();
  return () => {
    abort.abort();
    stopLeading?.();
    stopLeading = null;
  };
}

function runLeader(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: CycleOptions | null = null;
  let running = false;
  let ws: WebSocket | null = null;
  let wsTimer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let backoff = 2000;
  let signedIn = false;
  let closed = false;

  const run = async () => {
    if (running || !pending) return;
    const opts = pending;
    pending = null;
    running = true;
    try {
      await syncOnce(opts);
    } catch {
      // status already records the error; retry on the next trigger
    } finally {
      running = false;
      if (pending) schedule(pending, 500);
    }
  };

  /** Merge requests: a full sync beats "only if local changes". */
  const schedule = (opts: CycleOptions, delay: number) => {
    if (closed || !signedIn) return;
    pending = pending
      ? { onlyIfLocalChanges: pending.onlyIfLocalChanges && opts.onlyIfLocalChanges, forceTracking: pending.forceTracking || opts.forceTracking }
      : opts;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };

  const connect = async () => {
    if (closed || !signedIn || ws) return;
    try {
      const { path } = await accountRequest<{ path: string }>("/api/sync/ticket", { method: "POST", body: JSON.stringify({ deviceId: await deviceId() }) });
      const base = apiBase() || location.origin;
      const socket = new WebSocket(base.replace(/^http/, "ws") + path);
      ws = socket;
      socket.onopen = () => {
        backoff = 2000;
        clearInterval(ping);
        ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
      };
      socket.onmessage = (e) => {
        if (typeof e.data === "string" && e.data !== "pong") schedule({}, 150); // another device changed something
      };
      socket.onclose = () => {
        if (ws === socket) ws = null;
        clearInterval(ping);
        reconnectLater();
      };
    } catch (err) {
      if (err instanceof AccountError && err.status === 401) return;
      reconnectLater();
    }
  };
  const reconnectLater = () => {
    if (closed || !signedIn) return;
    clearTimeout(wsTimer);
    wsTimer = setTimeout(() => void connect(), backoff);
    backoff = Math.min(backoff * 2, 60_000);
  };
  const disconnect = () => {
    clearTimeout(wsTimer);
    clearInterval(ping);
    const s = ws;
    ws = null;
    s?.close(1000, "bye");
  };

  const setSignedIn = (user: ProdliUser | null) => {
    signedIn = !!user;
    if (signedIn) {
      schedule({}, 0);
      void connect();
    } else {
      disconnect();
    }
  };
  void getProdliAccount().then(setSignedIn);

  const offAccount = onProdliAccountChange((u) => {
    const was = signedIn;
    if (!!u !== was) setSignedIn(u);
  });
  const offStorage = onAnyStorageChange((keys) => {
    if (keys.some((k) => WATCHED_KEYS.has(k))) schedule({ onlyIfLocalChanges: true }, 700);
  });
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(MEETINGS_CHANNEL);
    channel.onmessage = () => schedule({ onlyIfLocalChanges: true }, 3000);
  } catch {
    // no BroadcastChannel: meetings sync on the timer
  }
  const onVisible = () => document.visibilityState === "visible" && schedule({}, 0);
  const onOnline = () => {
    schedule({}, 0);
    if (!ws) void connect();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  // Safety net: catch up regularly (rarely needed while the live connection is up).
  const periodic = setInterval(() => schedule({}, 0), 5 * 60_000);

  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(periodic);
    disconnect();
    offAccount();
    offStorage();
    channel?.close();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}

// ── Background (extension service worker) ────────────────────────────────────

export function registerBackgroundSync(): void {
  void chrome.alarms.get(SYNC_ALARM).then((existing) => {
    if (!existing) void chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncOnce().catch(() => {});
  });
}
