import { beforeEach, describe, expect, it } from "vitest";
import { kv } from "../../src/lib/kv";
import { read, resetCache } from "../../src/lib/store";
import { addTodoFromText, deleteTodo, findOrCreateList, setList, stampChanges, todosFor, toggleTodoDone, updateDay, updateTodo } from "../../src/lib/data";
import { getTombstones } from "../../src/lib/tombstones";
import type { DayRecord, Todo } from "../../src/shared";

beforeEach(() => {
  for (const k of kv.keys()) kv.remove(k);
  resetCache();
});

const T = (p: Partial<Todo>): Todo => ({ id: "x", title: "t", completed: false, createdAt: "2026-11-01T00:00:00.000Z", ...p });

describe("stampChanges", () => {
  it("stamps only what changed and reports removals", () => {
    const prev = [T({ id: "a", updatedAt: "2026-11-01T00:00:00.000Z" }), T({ id: "b", updatedAt: "2026-11-01T00:00:00.000Z" })];
    const next = [{ ...prev[0], title: "edited" }, T({ id: "c" })];
    const { items, removed } = stampChanges(prev, next, "2026-11-20T10:00:00.000Z");
    expect(items.map((i) => i.updatedAt)).toEqual(["2026-11-20T10:00:00.000Z", "2026-11-20T10:00:00.000Z"]);
    expect(removed).toEqual(["b"]);
    const same = stampChanges(prev, prev, "2026-11-20T10:00:00.000Z");
    expect(same.items[0].updatedAt).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("to-dos", () => {
  it("smart add understands dates, priority, lists and labels (the extension's parser)", () => {
    const t = addTodoFromText("Pay rent tomorrow !high #Home @bills")!;
    expect(t.title).toBe("Pay rent");
    expect(t.priority).toBe("high");
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.labels).toEqual(["bills"]);
    expect(t.listId).toBe(findOrCreateList("home"));
    expect(read<Todo[]>("todos", [])[0].updatedAt).toBeDefined();
  });

  it("repeating to-dos move to their next date and leave a done copy", () => {
    const t = addTodoFromText("Water plants every day")!;
    toggleTodoDone(t.id);
    const all = read<Todo[]>("todos", []);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === t.id)?.completed).toBe(false);
    expect(all.find((x) => x.id !== t.id)?.completed).toBe(true);
  });

  it("deleting records a tombstone so other devices delete it too", () => {
    const t = addTodoFromText("Temp")!;
    deleteTodo(t.id);
    expect(getTombstones().todos?.[t.id]).toBeDefined();
  });

  it("views: today, upcoming, done, lists", () => {
    const today = "2026-11-20";
    setList<Todo>("todos", () => [
      T({ id: "1", dueDate: "2026-11-19" }),
      T({ id: "2", plannedFor: today }),
      T({ id: "3", dueDate: "2026-11-25" }),
      T({ id: "4", completed: true, completedAt: "2026-11-20T09:00:00.000Z" }),
      T({ id: "5", listId: "L" }),
    ]);
    const all = read<Todo[]>("todos", []);
    expect(todosFor(all, "today", today).map((t) => t.id)).toEqual(["1", "2"]);
    expect(todosFor(all, "upcoming", today).map((t) => t.id)).toEqual(["3"]);
    expect(todosFor(all, "done", today).map((t) => t.id)).toEqual(["4"]);
    expect(todosFor(all, "list:L", today).map((t) => t.id)).toEqual(["5"]);
    expect(todosFor(all, "list:inbox", today).map((t) => t.id)).toEqual(["1", "2", "3"]);
    updateTodo("5", { title: "renamed" });
    expect(read<Todo[]>("todos", []).find((t) => t.id === "5")?.title).toBe("renamed");
  });
});

describe("days", () => {
  it("creates the day's record on first write, then updates it", () => {
    updateDay("2026-11-20", { focus: "Ship the app" });
    updateDay("2026-11-20", { reflection: "Went well" });
    expect(read<DayRecord[]>("days", [])).toEqual([expect.objectContaining({ id: "2026-11-20", focus: "Ship the app", reflection: "Went well" })]);
  });
});

describe("read later", () => {
  it("accepts web addresses (adding https:// when missing) and skips unread duplicates", async () => {
    const { addReadLater, markRead, normalizeUrl } = await import("../../src/lib/data");
    expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("http://x.org")).toBe("http://x.org/");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    const a = addReadLater("example.com/a")!;
    expect(a.title).toBe("example.com");
    expect(addReadLater("https://example.com/a")!.id).toBe(a.id);
    markRead(a.id);
    expect(addReadLater("example.com/a")!.id).not.toBe(a.id);
  });
});

describe("lists", () => {
  it("renames, and deleting a list moves its to-dos to the Inbox", async () => {
    const { addTodoFromText, deleteList, findOrCreateList, renameList } = await import("../../src/lib/data");
    const id = findOrCreateList("Work");
    const t = addTodoFromText("Ship it", { listId: id })!;
    renameList(id, "Job");
    expect(read<{ id: string; name: string }[]>("lists", []).find((l) => l.id === id)?.name).toBe("Job");
    deleteList(id);
    expect(read<{ id: string }[]>("lists", []).some((l) => l.id === id)).toBe(false);
    expect(read<Todo[]>("todos", []).find((x) => x.id === t.id)?.listId).toBeUndefined();
    expect(getTombstones().lists?.[id]).toBeDefined();
  });
});
