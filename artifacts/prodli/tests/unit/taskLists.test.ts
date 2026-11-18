import { describe, expect, it } from "vitest";
import { describeQuery, findList, labelsInUse, matchesQuery, normLabel } from "../../src/lib/taskLists";
import { parseTask } from "../../src/lib/taskParse";
import { parseLabels } from "../../src/sections/todo/TaskDetails";
import { selectionQuery } from "../../src/sections/todo/TodoNav";
import type { ListItem, Todo } from "../../src/types";

const today = "2026-11-18";
const t = (over: Partial<Todo>): Todo => ({ id: Math.random().toString(36), title: "Task", completed: false, createdAt: "x", ...over });
const lists: ListItem[] = [
  { id: "w", kind: "list", name: "Work", emoji: "💼", createdAt: "x" },
  { id: "h", kind: "list", name: "Home", createdAt: "x" },
  { id: "f", kind: "filter", name: "Urgent work", query: { list: "w", priority: "high" }, createdAt: "x" },
];

describe("to-do lists: which tasks a view shows", () => {
  it("matches lists, the inbox, labels, priority and status", () => {
    const work = t({ listId: "w", labels: ["calls"], priority: "high" });
    const inbox = t({ completed: true });
    expect(matchesQuery(work, { list: "w" })).toBe(true);
    expect(matchesQuery(work, { list: "inbox" })).toBe(false);
    expect(matchesQuery(inbox, { list: "inbox" })).toBe(true);
    expect(matchesQuery(work, { label: "calls" })).toBe(true);
    expect(matchesQuery(work, { label: "errands" })).toBe(false);
    expect(matchesQuery(work, { list: "w", priority: "high", status: "active" })).toBe(true);
    expect(matchesQuery(inbox, { status: "active" })).toBe(false);
    expect(matchesQuery(work, {})).toBe(true);
  });

  it("matches due dates the way the Today view does", () => {
    expect(matchesQuery(t({ dueDate: "2026-11-17" }), { due: "today" }, today)).toBe(true); // overdue shows on Today
    expect(matchesQuery(t({ plannedFor: today }), { due: "today" }, today)).toBe(true);
    expect(matchesQuery(t({ dueDate: "2026-11-19" }), { due: "today" }, today)).toBe(false);
    expect(matchesQuery(t({ dueDate: "2026-11-17" }), { due: "overdue" }, today)).toBe(true);
    expect(matchesQuery(t({ dueDate: "2026-11-25" }), { due: "week" }, today)).toBe(true);
    expect(matchesQuery(t({ dueDate: "2026-11-26" }), { due: "week" }, today)).toBe(false);
    expect(matchesQuery(t({}), { due: "none" }, today)).toBe(true);
  });

  it("searches titles and subtasks", () => {
    const x = t({ title: "Quarterly report", subtasks: [{ id: "s", title: "Invoice totals", completed: false }] });
    expect(matchesQuery(x, { text: "REPORT" })).toBe(true);
    expect(matchesQuery(x, { text: "invoice" })).toBe(true);
    expect(matchesQuery(x, { text: "budget" })).toBe(false);
  });

  it("turns side-panel choices into queries, including saved filters", () => {
    expect(selectionQuery({ kind: "inbox" }, lists)).toEqual({ list: "inbox" });
    expect(selectionQuery({ kind: "today" }, lists)).toEqual({ due: "today" });
    expect(selectionQuery({ kind: "filter", id: "f" }, lists)).toEqual({ list: "w", priority: "high" });
    expect(selectionQuery({ kind: "filter", id: "gone" }, lists)).toEqual({});
  });

  it("describes saved filters", () => {
    expect(describeQuery({ list: "w", label: "calls", priority: "high", text: "invoice" }, lists)).toBe("Work · @calls · High · “invoice”");
    expect(describeQuery({ list: "gone" }, lists)).toBe("A deleted list");
    expect(describeQuery({}, lists)).toBe("All tasks");
  });
});

describe("to-do labels", () => {
  it("normalises and counts labels", () => {
    expect(normLabel(" @Waiting On ")).toBe("waiting-on");
    expect(parseLabels("errands, @Waiting  home,errands")).toEqual(["errands", "waiting", "home"]);
    const todos = [t({ labels: ["errands"] }), t({ labels: ["errands", "calls"] }), t({ labels: ["calls"], completed: true })];
    expect(labelsInUse(todos)).toEqual([{ name: "errands", open: 2 }, { name: "calls", open: 1 }]);
    expect(findList(lists, " work ")?.id).toBe("w");
    expect(findList(lists, "Urgent work")).toBeUndefined(); // filters aren't lists
  });

  it("quick add reads #list and @labels", () => {
    const now = new Date(2026, 10, 18, 10);
    expect(parseTask("Buy milk #Groceries @errands @quick tomorrow", now)).toMatchObject({ title: "Buy milk", listName: "Groceries", labels: ["errands", "quick"], dueDate: "2026-11-19" });
    const plan = parseTask("Plan trip #today", now);
    expect(plan).toMatchObject({ title: "Plan trip", planToday: true });
    expect(plan.listName).toBeUndefined();
    expect(parseTask("Email sam@example.com about #2 issue", now)).toMatchObject({ title: "Email sam@example.com about #2 issue" });
  });
});

describe("quick add from anywhere (⌘K, Quick add window)", () => {
  it("saves the time, repeat, list and labels, creating the list once", async () => {
    const { addTask } = await import("../../src/lib/capture");
    const { storageGet, storageSet } = await import("../../src/lib/storage");
    await storageSet("todos", []);
    await storageSet("lists", []);
    const a = await addTask({ title: "Pay rent monthly Dec 1 #Home @bills at 9am !high", smart: true });
    expect(a).toMatchObject({ title: "Pay rent", dueDate: expect.stringMatching(/-12-01$/), dueTime: "09:00", priority: "high", labels: ["bills"], repeat: { unit: "month", every: 1, monthDay: 1 } });
    const b = await addTask({ title: "Fix tap #home", smart: true });
    const lists = await storageGet<ListItem[]>("lists", []);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ kind: "list", name: "Home" });
    expect(a.listId).toBe(lists[0].id);
    expect(b.listId).toBe(lists[0].id);
    // Right-click saves of a page title are never parsed.
    const c = await addTask({ title: "Best #Home tips for tomorrow" });
    expect(c).toMatchObject({ title: "Best #Home tips for tomorrow" });
    expect(c.listId).toBeUndefined();
  });
});
