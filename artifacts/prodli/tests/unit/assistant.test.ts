import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addNote, addTask, captureFromUrl, noteHtml, safeUrl } from "../../src/lib/capture";
import { askProdli, pickSnippets, terms } from "../../src/lib/ask";
import { storageGet, storageSet } from "../../src/lib/storage";
import { MOBILE_TABS, SECTIONS, sectionByShortcut } from "../../src/sections/registry";
import type { Note, Todo } from "../../src/types";
import type { Meeting } from "../../src/recorder/types";

describe("Add to ProdLi", () => {
  it("adds a to-do on top, keeping the link and details as subtasks", async () => {
    await storageSet("todos", [{ id: "old", title: "Old", completed: false, createdAt: "" }]);
    const t = await addTask({ title: "  Read   this article ", text: "Important part", url: "https://example.com/a", planToday: true });
    const todos = await storageGet<Todo[]>("todos", []);
    expect(todos.map((x) => x.title)).toEqual(["Read this article", "Old"]);
    expect(t.subtasks?.map((s) => s.title)).toEqual(["Important part", "https://example.com/a"]);
    expect(t.plannedFor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("saves a selection as a note with a safe source link", async () => {
    const n = await addNote({ title: "Article", text: "Line <b>one</b>\n\nPara two", url: "https://example.com/x?a=1&b=2" });
    expect((await storageGet<Note[]>("notes", []))[0].id).toBe(n.id);
    expect(n.content).toBe('<p>Line &lt;b&gt;one&lt;/b&gt;</p><p>Para two</p><p>Source: <a href="https://example.com/x?a=1&amp;b=2">Article</a></p>');
    expect(noteHtml({ title: "x", url: "javascript:alert(1)" })).toBe("<p></p>");
    expect(safeUrl("data:text/html,hi")).toBeUndefined();
  });

  it("reads shared values from the URL (phone share sheet, Quick add window)", () => {
    expect(captureFromUrl("title=Hello&url=https%3A%2F%2Fa.com%2F")).toEqual({ title: "Hello", text: "", url: "https://a.com/" });
    expect(captureFromUrl("text=https%3A%2F%2Fshared.link%2Fpost")).toEqual({ title: "", text: "", url: "https://shared.link/post" }); // Android puts links in text
    expect(captureFromUrl("text=just+a+thought")).toMatchObject({ text: "just a thought" });
    expect(captureFromUrl("section=today")).toBeNull();
  });
});

describe("Ask ProdLi", () => {
  const note = (title: string, content: string, updatedAt = "2026-11-01T00:00:00.000Z"): Note => ({ id: title, title, content, createdAt: updatedAt, updatedAt });
  const meeting = (title: string, startedAt: string, overview: string, lines: string[]): Meeting =>
    ({ id: title, title, startedAt, transcript: lines.map((t, i) => ({ id: String(i), speaker: "Ann", text: t, startMs: 0, endMs: 0 })), summary: { title, overview, keyPoints: [], decisions: ["Ship Friday"], actionItems: [{ task: "Send deck", owner: "You", dueDate: null, priority: "high" }], openQuestions: [], model: "", generatedAt: "" } }) as unknown as Meeting;

  it("keeps the meaningful words of a question", () => {
    expect(terms("What did we decide about the Budget in the meeting?")).toEqual(["decide", "about", "budget", "meeting"]);
  });

  it("sends only the notes and meetings relevant to the question", () => {
    const notes = [note("Budget 2027", "<p>Marketing gets <b>20%</b> more</p>"), note("Groceries", "<p>milk, eggs</p>"), note("Ideas", "<p>budget review in March</p>")];
    const meetings = [meeting("Finance sync", "2026-11-05T10:00:00Z", "Discussed the budget split", ["The budget is final", "Lunch?"]), meeting("Standup", "2026-11-06T09:00:00Z", "Daily update", ["All good"])];
    const s = pickSnippets("What's the budget plan?", notes, meetings);
    expect(s.map((x) => x.title)).toEqual(["Finance sync", "Budget 2027", "Ideas"]);
    expect(s[0].text).toContain("Discussed the budget split");
    expect(s[0].text).toContain("Ann: The budget is final");
    expect(s[0].text).not.toContain("Lunch");
    expect(s[1].text).toBe("Marketing gets 20% more");
  });

  it("includes the latest meetings when asked about 'the last meeting'", () => {
    const meetings = [meeting("Old one", "2026-10-01T10:00:00Z", "x", []), meeting("Latest", "2026-11-06T09:00:00Z", "Decided to ship", [])];
    expect(pickSnippets("Summarize my last meeting", [], meetings)[0].title).toBe("Latest");
  });

  describe("asking", () => {
    beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
    afterEach(() => vi.unstubAllEnvs());

    it("sends the question, recent turns, today's context and relevant snippets", async () => {
      await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
      await storageSet("notes", [note("Launch plan", "<p>Launch on the 20th</p>")]);
      await storageSet("todos", [{ id: "t", title: "Write launch email", completed: false, createdAt: "" }]);
      let sent: Record<string, unknown> = {};
      globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ answer: "Do the launch email first.", actions: [{ type: "plan_today", title: "Write launch email", details: "" }], usage: { used: 1, limit: 100 } });
      }) as typeof fetch;
      const r = await askProdli("When is the launch?", [{ role: "user", text: "hi" }, { role: "assistant", text: "oops", error: true }, { role: "assistant", text: "Hello" }]);
      expect(r.answer).toBe("Do the launch email first.");
      expect(sent.question).toBe("When is the launch?");
      expect(sent.history).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "Hello" }]); // errors aren't sent
      expect((sent.context as { tasks: { title: string }[] }).tasks[0].title).toBe("Write launch email");
      expect(sent.snippets).toEqual([{ kind: "note", title: "Launch plan", date: "2026-11-01", text: "Launch on the 20th" }]);
    });
  });
});

describe("section registry", () => {
  it("has unique keys and shortcuts, and every phone tab exists", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.shortcut)).size).toBe(SECTIONS.length);
    expect(MOBILE_TABS.every((k) => SECTIONS.some((s) => s.key === k))).toBe(true);
    expect(sectionByShortcut("0")?.key).toBe("today");
    expect(sectionByShortcut("1")?.label).toBe("Notes");
  });
});
