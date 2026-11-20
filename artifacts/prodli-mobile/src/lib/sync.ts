// ProdLi sync on the phone: the same protocol and rules as the extension and
// web app (artifacts/prodli/src/lib/prodliSync.ts), using the very same pure
// logic (syncCore, via src/shared). Every device keeps a full local copy and
// works offline; the server (one private database per user) is the meeting
// point. The newest edit wins; Time Tracker days and the Pomodoro counter merge
// by taking the larger number.
//
// What the phone keeps under which key (same keys as the extension):
//   notes, todos, habits, days, lists, tabSessions, quickLinks, readLater  arrays
//   meetings            array (text only — audio never syncs)
//   pomodoroSessions    the last 20 finished focus sessions
//   completedPomodoros  the all-time counter
//   tracking            { "YYYY-MM-DD": { site: seconds } } (view only: phones don't track)
import { batches, decide, localChanges, normStamp, pushedHash, shadowKey, type Change, type Coll, type CollectionState, type Incoming, type Kind, type LocalItem } from "../shared";
import { read, write } from "./store";
import { getTombstones } from "./tombstones";

export const SYNC_STATE_KEY = "prodliSyncState";
export const SYNC_STATUS_KEY = "prodliSyncStatus";
export const DEVICE_ID_KEY = "prodliDeviceId";
export const TRACKING_KEY = "tracking";

export interface SyncState {
  userId: string;
  seq: number;
  shadow: Record<string, string>;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error";
  lastSyncAt: number | null;
  error: string | null;
  tooLarge: number;
  usage: { bytes: number; quota: number } | null;
}

interface SyncResponse {
  seq: number;
  changes: Incoming[];
  more: boolean;
  usage: { bytes: number; quota: number };
}

/** How sync talks to the server (src/lib/api.ts in the app; a fake in tests). */
export interface Transport {
  post<T>(path: string, body: unknown): Promise<T>;
  /** True when the error means "no connection" (status 0). */
  isOffline(err: unknown): boolean;
  /** True when the error means "signed out" (401). */
  isSignedOut(err: unknown): boolean;
}

// ── Collections on this device ───────────────────────────────────────────────

interface Adapter {
  c: Coll;
  kind: Kind;
  deletable: boolean;
  requireTombstone?: boolean;
  read(): Map<string, LocalItem>;
  apply(puts: Map<string, unknown>, deletes: Set<string>): void;
}

type Stamped = { id: string; updatedAt?: unknown; createdAt?: unknown };
type ListColl = "notes" | "todos" | "habits" | "days" | "lists" | "tabSessions" | "quickLinks" | "readLater";

function listAdapter(c: ListColl, newOnTop: boolean): Adapter {
  return {
    c,
    kind: "lww",
    deletable: true,
    read() {
      const items = read<Stamped[]>(c, []);
      return new Map(items.filter((i) => typeof i?.id === "string").map((i) => [i.id, { u: normStamp(i.updatedAt ?? i.createdAt), v: i }]));
    },
    apply(puts, deletes) {
      const items = read<Stamped[]>(c, []).filter((i) => !deletes.has(i.id));
      const fresh: Stamped[] = [];
      for (const [id, value] of puts) {
        const at = items.findIndex((i) => i.id === id);
        if (at >= 0) items[at] = value as Stamped;
        else fresh.push(value as Stamped);
      }
      write(c, newOnTop ? [...fresh, ...items] : [...items, ...fresh]);
    },
  };
}

interface MeetingLike {
  id: string;
  startedAt?: string;
  updatedAt?: string;
}

const meetingsAdapter: Adapter = {
  c: "meetings",
  kind: "lww",
  deletable: true,
  // Every deletion on the phone records a tombstone (deleteMeeting in meetings.ts),
  // so a meeting merely missing here is fetched again, never deleted everywhere.
  requireTombstone: true,
  read() {
    return new Map(read<MeetingLike[]>("meetings", []).map((m) => [m.id, { u: normStamp(m.updatedAt), v: m }]));
  },
  apply(puts, deletes) {
    const byId = new Map(read<MeetingLike[]>("meetings", []).filter((m) => !deletes.has(m.id)).map((m) => [m.id, m]));
    // Kept exactly as the server has it (any change here would be sent back as an edit).
    // Audio is never synced; the screens don't offer playback.
    for (const [id, value] of puts) byId.set(id, value as MeetingLike);
    write("meetings", [...byId.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")));
  },
};

type PomodoroSession = { id: string; completedAt: string };
const pomodoroSessionsAdapter: Adapter = {
  c: "pomodoroSessions",
  kind: "lww",
  deletable: false,
  read() {
    return new Map(read<PomodoroSession[]>("pomodoroSessions", []).map((s) => [s.id, { u: normStamp(s.completedAt), v: s }]));
  },
  apply(puts) {
    const byId = new Map(read<PomodoroSession[]>("pomodoroSessions", []).map((s) => [s.id, s]));
    for (const [id, v] of puts) byId.set(id, v as PomodoroSession);
    write("pomodoroSessions", [...byId.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 20));
  },
};

const statsAdapter: Adapter = {
  c: "stats",
  kind: "max",
  deletable: false,
  read() {
    const n = read<number>("completedPomodoros", 0);
    return new Map(n > 0 ? [["completedPomodoros", { u: "", v: n }]] : []);
  },
  apply(puts) {
    const n = puts.get("completedPomodoros");
    if (typeof n === "number") write("completedPomodoros", n);
  },
};

const trackingAdapter: Adapter = {
  c: "tracking",
  kind: "max",
  deletable: false,
  read() {
    return new Map(Object.entries(read<Record<string, Record<string, number>>>(TRACKING_KEY, {})).map(([day, v]) => [day, { u: "", v }]));
  },
  apply(puts) {
    const all = { ...read<Record<string, unknown>>(TRACKING_KEY, {}) };
    for (const [day, v] of puts) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) all[day] = v;
    write(TRACKING_KEY, all);
  },
};

export const ADAPTERS: Adapter[] = [
  listAdapter("notes", true),
  listAdapter("todos", true),
  listAdapter("habits", false),
  listAdapter("days", true),
  listAdapter("lists", false),
  listAdapter("tabSessions", true),
  listAdapter("quickLinks", false),
  listAdapter("readLater", true),
  meetingsAdapter,
  pomodoroSessionsAdapter,
  statsAdapter,
  trackingAdapter,
];

/** Keys whose change means "sync soon". */
export const WATCHED_KEYS = new Set(["notes", "todos", "habits", "days", "lists", "tabSessions", "quickLinks", "readLater", "meetings", "pomodoroSessions", "completedPomodoros"]);

// ── State ────────────────────────────────────────────────────────────────────

export function deviceId(random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(12))): string {
  let id = read<string | null>(DEVICE_ID_KEY, null);
  if (!id) {
    id = Array.from(random(), (b) => b.toString(16).padStart(2, "0")).join("");
    write(DEVICE_ID_KEY, id);
  }
  return id;
}

function loadState(userId: string): SyncState {
  const s = read<SyncState | null>(SYNC_STATE_KEY, null);
  // A different account (or the first sync): start fresh; what's on the phone is added to this account.
  if (!s || s.userId !== userId) return { userId, seq: 0, shadow: {} };
  return { ...s, shadow: { ...s.shadow } };
}

export const EMPTY_STATUS: SyncStatus = { state: "idle", lastSyncAt: null, error: null, tooLarge: 0, usage: null };
export const getSyncStatus = (): SyncStatus => read<SyncStatus>(SYNC_STATUS_KEY, EMPTY_STATUS);
const setStatus = (patch: Partial<SyncStatus>) => write(SYNC_STATUS_KEY, { ...getSyncStatus(), ...patch });

export interface CycleOptions {
  /** Skip the network if nothing changed here (after local edits). */
  onlyIfLocalChanges?: boolean;
}

let running: Promise<void> | null = null;

/** One sync. Calls made while one is running wait for it, then run once more. */
export async function syncOnce(userId: string, transport: Transport, opts: CycleOptions = {}): Promise<void> {
  while (running) await running.catch(() => {});
  running = cycle(userId, transport, opts);
  try {
    await running;
  } finally {
    running = null;
  }
}

async function cycle(userId: string, transport: Transport, opts: CycleOptions): Promise<void> {
  const state = loadState(userId);
  const device = deviceId();
  let tooLarge = 0;
  let usage: SyncResponse["usage"] | null = null;
  let contacted = false;
  try {
    for (let round = 0; round < 3; round++) {
      const local = new Map<Coll, Map<string, LocalItem>>();
      for (const a of ADAPTERS) local.set(a.c, a.read());
      const cols: CollectionState[] = ADAPTERS.map((a) => ({ c: a.c, kind: a.kind, deletable: a.deletable, local: local.get(a.c)!, requireTombstone: a.requireTombstone }));
      const { changes, tooLarge: big, missing } = localChanges(cols, state.shadow, getTombstones(), new Date().toISOString());
      // Synced before but gone here without a deletion (e.g. app data cleared): fetch it again.
      if (missing.length) {
        for (const key of missing) delete state.shadow[key];
        state.seq = 0;
      }
      tooLarge = big.length;
      if (round === 0 && opts.onlyIfLocalChanges && changes.length === 0 && !missing.length) return;
      if (round > 0 && changes.length === 0) break;

      if (!contacted) setStatus({ state: "syncing" });
      contacted = true;
      let again = false;
      const kinds = new Map(ADAPTERS.map((a) => [a.c, a.kind]));
      for (const batch of changes.length ? batches(changes) : [[] as Change[]]) {
        let res = await transport.post<SyncResponse>("/api/sync", { deviceId: device, since: state.seq, changes: batch });
        for (const ch of batch) state.shadow[shadowKey(ch.c, ch.id)] = pushedHash(kinds.get(ch.c)!, ch);
        for (;;) {
          again = applyIncoming(res.changes, local, state) || again;
          state.seq = res.seq;
          usage = res.usage;
          if (!res.more) break;
          res = await transport.post<SyncResponse>("/api/sync", { deviceId: device, since: state.seq, changes: [] });
        }
        write(SYNC_STATE_KEY, state);
      }
      write(SYNC_STATE_KEY, state);
      if (!again) break;
    }
    if (contacted) setStatus({ state: "idle", lastSyncAt: Date.now(), error: null, tooLarge, usage });
  } catch (err) {
    write(SYNC_STATE_KEY, state); // keep what did get through
    if (transport.isSignedOut(err)) return;
    const offline = transport.isOffline(err);
    setStatus({ state: offline ? "offline" : "error", error: err instanceof Error ? err.message : String(err), tooLarge });
    if (!offline) throw err;
  }
}

/** Applies server versions here. Returns true if this phone has newer data to send back. */
function applyIncoming(changes: Incoming[], local: Map<Coll, Map<string, LocalItem>>, state: SyncState): boolean {
  let again = false;
  for (const a of ADAPTERS) {
    const mine = changes.filter((ch) => ch.c === a.c);
    if (!mine.length) continue;
    const items = local.get(a.c)!;
    const puts = new Map<string, unknown>();
    const deletes = new Set<string>();
    const shadows: [string, string][] = [];
    for (const inc of mine) {
      const { decision, shadow, again: newerHere } = decide(a.kind, inc, items.get(inc.id));
      shadows.push([shadowKey(a.c, inc.id), shadow]);
      if (newerHere) again = true;
      if (decision.action === "put") {
        puts.set(inc.id, decision.value);
        items.set(inc.id, { u: inc.u, v: decision.value });
      } else if (decision.action === "delete") {
        deletes.add(inc.id);
        items.delete(inc.id);
      }
    }
    if (puts.size || deletes.size) a.apply(puts, deletes);
    for (const [key, shadow] of shadows) state.shadow[key] = shadow;
  }
  return again;
}

/** After signing out: forget what this phone knows about the server (local data stays). */
export function resetSyncState(): void {
  write(SYNC_STATE_KEY, null);
  write(SYNC_STATUS_KEY, EMPTY_STATUS);
}
