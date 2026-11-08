import { describe, expect, it } from "vitest";
import { mergeLists } from "../../src/lib/syncedList";

type Item = { id: string; v: string; updatedAt?: string };
const it_ = (id: string, v: string, updatedAt = "2026-01-01T00:00:00.000Z"): Item => ({ id, v, updatedAt });
const none = new Set<string>();

describe("mergeLists (multi-tab merge)", () => {
  it("takes the stored version of items this tab didn't touch", () => {
    const local = [it_("a", "old")];
    const incoming = [it_("a", "new from other tab", "2026-01-02T00:00:00.000Z")];
    expect(mergeLists(local, incoming, none, none)).toEqual(incoming);
  });

  it("keeps this tab's edit unless the stored copy is newer", () => {
    const mine = it_("a", "mine", "2026-01-03T00:00:00.000Z");
    expect(mergeLists([mine], [it_("a", "older", "2026-01-02T00:00:00.000Z")], new Set(["a"]), none)).toEqual([mine]);
    const newer = it_("a", "newer elsewhere", "2026-01-04T00:00:00.000Z");
    expect(mergeLists([mine], [newer], new Set(["a"]), none)).toEqual([newer]);
  });

  it("adds items created in another tab at the top and keeps local order", () => {
    const local = [it_("a", "A"), it_("b", "B")];
    const incoming = [it_("b", "B"), it_("c", "C"), it_("a", "A")];
    expect(mergeLists(local, incoming, none, none).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps items created here that aren't saved yet", () => {
    const local = [it_("new", "draft"), it_("a", "A")];
    expect(mergeLists(local, [it_("a", "A")], new Set(["new"]), none).map((i) => i.id)).toEqual(["new", "a"]);
  });

  it("drops items deleted in another tab (and keeps local deletes deleted)", () => {
    const local = [it_("a", "A"), it_("b", "B")];
    expect(mergeLists(local, [it_("b", "B")], none, none).map((i) => i.id)).toEqual(["b"]);
    expect(mergeLists([it_("b", "B")], [it_("a", "A"), it_("b", "B")], none, new Set(["a"])).map((i) => i.id)).toEqual(["b"]);
  });
});
