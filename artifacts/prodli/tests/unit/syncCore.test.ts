import { describe, expect, it } from "vitest";
import { batches, decide, fingerprint, localChanges, maxMerge, normStamp, stable, versionHash, type CollectionState, type LocalItem } from "../../src/lib/syncCore";

const T = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();
const notes = (entries: [string, LocalItem][]): CollectionState => ({ c: "notes", kind: "lww", deletable: true, local: new Map(entries) });

describe("syncCore", () => {
  it("fingerprints values independently of key order", () => {
    expect(stable({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(stable({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });

  it("normalises stamps to ISO strings", () => {
    expect(normStamp(T(1))).toBe(T(1));
    expect(normStamp(Date.parse(T(2)))).toBe(T(2));
    expect(normStamp("2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
    expect(normStamp(undefined)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("finds new, edited and deleted items against the shadow", () => {
    const n1 = { u: T(1), v: { id: "n1", t: "a" } };
    const n2 = { u: T(2), v: { id: "n2", t: "b" } };
    const shadow = { "notes/n1": versionHash("lww", T(1), false, n1.v), "notes/gone": versionHash("lww", T(0), false, {}) };
    const { changes } = localChanges([notes([["n1", n1], ["n2", n2]])], shadow, { notes: { gone: T(5) } }, T(9));
    expect(changes).toEqual([
      { c: "notes", id: "n2", u: T(2), v: n2.v },
      { c: "notes", id: "gone", u: T(5), d: true },
    ]);
  });

  it("pushes deletions made before the device ever synced, once", () => {
    const { changes } = localChanges([notes([])], {}, { notes: { old: T(3) } }, T(9));
    expect(changes).toEqual([{ c: "notes", id: "old", u: T(3), d: true }]);
    const again = localChanges([notes([])], { "notes/old": versionHash("lww", T(3), true, null) }, { notes: { old: T(3) } }, T(9));
    expect(again.changes).toEqual([]);
  });

  it("never deletes append-only data elsewhere, and stamps growing numbers with now", () => {
    const tracking: CollectionState = { c: "tracking", kind: "max", deletable: false, local: new Map([["2026-11-01", { u: "", v: { a: 5 } }]]) };
    const shadow = { "tracking/2026-10-31": versionHash("max", "", false, { a: 1 }) };
    expect(localChanges([tracking], shadow, {}, T(9)).changes).toEqual([{ c: "tracking", id: "2026-11-01", u: T(9), v: { a: 5 } }]);
  });

  it("skips items too large for the server", () => {
    const { changes, tooLarge } = localChanges([notes([["big", { u: T(1), v: "x".repeat(1_500_000) }]])], {}, {}, T(9));
    expect(changes).toEqual([]);
    expect(tooLarge).toEqual(["notes/big"]);
  });

  it("takes the newer version, keeps a newer local edit, and applies deletions", () => {
    const local = { u: T(5), v: { id: "n", t: "mine" } };
    expect(decide("lww", { c: "notes", id: "n", u: T(9), d: false, v: { id: "n", t: "theirs" } }, local).decision).toEqual({ action: "put", value: { id: "n", t: "theirs" } });
    expect(decide("lww", { c: "notes", id: "n", u: T(1), d: false, v: {} }, local)).toMatchObject({ decision: { action: "none" }, again: true });
    expect(decide("lww", { c: "notes", id: "n", u: T(9), d: true, v: null }, local).decision).toEqual({ action: "delete" });
    expect(decide("lww", { c: "notes", id: "n", u: T(1), d: true, v: null }, local)).toMatchObject({ decision: { action: "none" }, again: true });
    expect(decide("lww", { c: "notes", id: "x", u: T(1), d: true, v: null }, undefined).decision).toEqual({ action: "none" });
  });

  it("merges growing numbers by taking the larger one per site", () => {
    expect(maxMerge({ a: 10, b: 2 }, { b: 7, c: 1 })).toEqual({ a: 10, b: 7, c: 1 });
    expect(maxMerge(3, 8)).toBe(8);
    const r = decide("max", { c: "tracking", id: "d", u: T(1), d: false, v: { a: 5, b: 7 } }, { u: "", v: { a: 10 } });
    expect(r.decision).toEqual({ action: "put", value: { a: 10, b: 7 } });
    expect(r.again).toBe(true); // this device has a:10 the server doesn't
    expect(r.shadow).toBe(versionHash("max", "", false, { a: 5, b: 7 }));
  });

  it("splits large pushes", () => {
    const ch = (n: number) => ({ c: "notes" as const, id: String(n), u: T(1), v: "x".repeat(1000) });
    const out = batches(Array.from({ length: 10 }, (_, i) => ch(i)), 3500);
    expect(out.map((b) => b.length)).toEqual([3, 3, 3, 1]);
  });
});
