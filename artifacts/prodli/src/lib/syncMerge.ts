// Pure merge of two ProdLi snapshots (this device + the copy in Google Drive).
//
// - Notes, to-dos, habits, meetings: merged item by item; the most recently
//   edited version wins; deletions (tombstones) win over older edits.
// - Pomodoro sessions: union; completed count: the higher one.
// - Time tracking: per day and site, the larger number (devices track their
//   own browsing; this never double-counts). Not written back locally.
// - Settings (theme, fonts, keys…): stay per device.

import type { ProdLiBackup } from "./backupRestore";
import { mergeTombstones, type Collection, type Tombstones } from "./tombstones";

export interface SyncSnapshot extends ProdLiBackup {
  tombstones?: Tombstones;
}

type Item = { id: string; updatedAt?: string; createdAt?: string; startedAt?: string };
const stamp = (x: Item) => x.updatedAt ?? x.createdAt ?? x.startedAt ?? "";

export function mergeById<T extends Item>(local: T[] = [], remote: T[] = [], tomb: Record<string, string> = {}): T[] {
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localIds = new Set(local.map((l) => l.id));
  const out: T[] = [];
  for (const r of remote) if (!localIds.has(r.id)) out.push(r); // new from the other device (on top)
  for (const l of local) {
    const r = remoteById.get(l.id);
    out.push(r && stamp(r) > stamp(l) ? r : l);
  }
  // A deletion wins unless the item was edited after it (e.g. Undo, or edited elsewhere later).
  return out.filter((i) => !(tomb[i.id] && tomb[i.id] >= stamp(i)));
}

function mergeSessions(a: { id: string; completedAt: string }[] = [], b: { id: string; completedAt: string }[] = []) {
  const byId = new Map([...a, ...b].map((s) => [s.id, s]));
  return [...byId.values()].sort((x, y) => y.completedAt.localeCompare(x.completedAt)).slice(0, 20);
}

function mergeTracking(a: Record<string, Record<string, number>> = {}, b: Record<string, Record<string, number>> = {}) {
  const out: Record<string, Record<string, number>> = {};
  for (const [day, sites] of [...Object.entries(a), ...Object.entries(b)]) {
    const d = (out[day] ??= {});
    for (const [site, secs] of Object.entries(sites)) d[site] = Math.max(d[site] ?? 0, secs);
  }
  return out;
}

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot | null): SyncSnapshot {
  if (!remote) return { ...local, tombstones: mergeTombstones(local.tombstones ?? {}, {}) };
  const tombstones = mergeTombstones(local.tombstones ?? {}, remote.tombstones ?? {});
  const t = (c: Collection) => tombstones[c] ?? {};
  const L = local.data as Record<string, unknown>;
  const R = remote.data as Record<string, unknown>;
  const data: Record<string, unknown> = { ...L }; // settings stay per device
  data.notes = mergeById(L.notes as Item[], R.notes as Item[], t("notes"));
  data.todos = mergeById(L.todos as Item[], R.todos as Item[], t("todos"));
  data.habits = mergeById(L.habits as Item[], R.habits as Item[], t("habits"));
  data.lists = mergeById((L.lists ?? []) as Item[], (R.lists ?? []) as Item[], t("lists"));
  data.tabSessions = mergeById((L.tabSessions ?? []) as Item[], (R.tabSessions ?? []) as Item[], t("tabSessions"));
  data.quickLinks = mergeById((L.quickLinks ?? []) as Item[], (R.quickLinks ?? []) as Item[], t("quickLinks"));
  data.readLater = mergeById((L.readLater ?? []) as Item[], (R.readLater ?? []) as Item[], t("readLater"));
  data.pomodoroSessions = mergeSessions(L.pomodoroSessions as never, R.pomodoroSessions as never);
  data.completedPomodoros = Math.max(Number(L.completedPomodoros ?? 0), Number(R.completedPomodoros ?? 0));
  return {
    ...local,
    exportedAt: new Date().toISOString(),
    data,
    timeTracking: mergeTracking(local.timeTracking, remote.timeTracking),
    meetings: mergeById(local.meetings as Item[] as never, remote.meetings as Item[] as never, t("meetings")) as never,
    tombstones,
  };
}
