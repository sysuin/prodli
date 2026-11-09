import { describe, expect, it } from "vitest";
import { mergeById, mergeSnapshots, type SyncSnapshot } from "../../src/lib/syncMerge";
import { mergeTombstones, pruneTombstones } from "../../src/lib/tombstones";

const T = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
const note = (id: string, title: string, day: number) => ({ id, title, content: "", createdAt: T(1), updatedAt: T(day) });
const snap = (data: Record<string, unknown>, extra: Partial<SyncSnapshot> = {}): SyncSnapshot => ({ version: "1.1", exportedAt: T(1), data, ...extra });

describe("mergeById", () => {
  it("unions items and keeps the newest edit", () => {
    const merged = mergeById([note("a", "A local", 5), note("b", "B", 2)], [note("a", "A remote", 6), note("c", "C", 3)]);
    expect(merged.map((n) => n.title)).toEqual(["C", "A remote", "B"]);
  });

  it("applies deletions unless the item was edited afterwards", () => {
    expect(mergeById([note("a", "A", 5)], [], { a: T(6) })).toEqual([]);
    expect(mergeById([note("a", "A edited later", 7)], [], { a: T(6) }).map((n) => n.title)).toEqual(["A edited later"]);
  });
});

describe("mergeSnapshots", () => {
  it("merges collections, keeps device settings, unions sessions, max counters and tracking", () => {
    const local = snap(
      { notes: [note("a", "A", 2)], todos: [], habits: [], theme: "dark", completedPomodoros: 3, pomodoroSessions: [{ id: "s1", completedAt: T(2) }] },
      { timeTracking: { "2026-11-07": { "github.com": 100 } } },
    );
    const remote = snap(
      { notes: [note("b", "B", 3)], todos: [{ id: "t", title: "T", createdAt: T(1) }], habits: [], theme: "light", completedPomodoros: 5, pomodoroSessions: [{ id: "s2", completedAt: T(3) }] },
      { timeTracking: { "2026-11-07": { "github.com": 60, "docs.google.com": 30 } } },
    );
    const m = mergeSnapshots(local, remote);
    expect((m.data.notes as { id: string }[]).map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(m.data.todos).toHaveLength(1);
    expect(m.data.theme).toBe("dark");
    expect(m.data.completedPomodoros).toBe(5);
    expect((m.data.pomodoroSessions as { id: string }[]).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(m.timeTracking).toEqual({ "2026-11-07": { "github.com": 100, "docs.google.com": 30 } });
  });

  it("a note deleted on one computer is removed on the other", () => {
    const local = snap({ notes: [note("a", "A", 2), note("b", "B", 2)] });
    const remote = snap({ notes: [note("b", "B", 2)] }, { tombstones: { notes: { a: T(4) } } });
    const m = mergeSnapshots(local, remote);
    expect((m.data.notes as { id: string }[]).map((n) => n.id)).toEqual(["b"]);
    expect(m.tombstones?.notes?.a).toBe(T(4));
  });

  it("first sync (no Drive copy yet) keeps everything", () => {
    const local = snap({ notes: [note("a", "A", 2)] });
    expect(mergeSnapshots(local, null).data.notes).toEqual(local.data.notes);
  });
});

describe("tombstones", () => {
  it("keeps the latest deletion and drops markers older than 90 days", () => {
    const now = Date.UTC(2026, 10, 30);
    const old = new Date(now - 100 * 86_400_000).toISOString();
    expect(pruneTombstones({ notes: { a: old, b: T(29) } }, now)).toEqual({ notes: { b: T(29) } });
    expect(mergeTombstones({ notes: { a: T(28) } }, { notes: { a: T(29), c: T(27) } })).toEqual({ notes: { a: T(29), c: T(27) } });
  });
});
