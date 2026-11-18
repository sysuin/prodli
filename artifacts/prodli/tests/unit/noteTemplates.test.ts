// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, dailyNoteHtml, fillTemplate, newNoteFromTemplate, prepareDailyNote, titleFrom } from "../../src/lib/noteTemplates";
import { storageSet } from "../../src/lib/storage";
import type { Note } from "../../src/types";

const now = new Date(2026, 10, 18, 9, 30);

describe("note templates", () => {
  it("fills in the date, weekday and time", () => {
    const out = fillTemplate("<p>{{weekday}} · {{ date }} · {{TIME}}</p>", now);
    expect(out).toContain(now.toLocaleDateString([], { weekday: "long" }));
    expect(out).toContain(now.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }));
    expect(out).not.toMatch(/\{\{/);
  });
  it("names new notes after their heading", () => {
    expect(titleFrom("<h1>1:1 · 18 November 2026</h1>", "x")).toBe("1:1 · 18 November 2026");
    expect(titleFrom("<h1>Meeting: </h1><p>…</p>", "Meeting notes")).toBe("Meeting");
    expect(titleFrom("<p>no heading</p>", "Fallback")).toBe("Fallback");
    const n = newNoteFromTemplate(BUILTIN_TEMPLATES.find((t) => t.id === "decision")!.html, "Decision record", now);
    expect(n.title).toBe("Decision");
    expect(n.content).toContain("<h2>Options</h2>");
  });
  it("every built-in template has a name, an icon and a heading", () => {
    for (const t of BUILTIN_TEMPLATES) expect(t.name && t.emoji && /<h1>/.test(t.html)).toBeTruthy();
  });
});

describe("daily note", () => {
  it("puts today's focus and planned tasks in", () => {
    const html = dailyNoteHtml({ now, focus: "Ship <beta>", tasks: ["Write release notes", "Email Priya"] });
    expect(html).toContain("<h2>Main focus</h2><p>Ship &lt;beta&gt;</p>");
    expect(html).toContain('<li data-type="taskItem" data-checked="false"><p>Write release notes</p></li>');
    expect(html).toContain("Email Priya");
  });
  it("uses your own Daily note template when it has a Today section, or adds one", () => {
    expect(dailyNoteHtml({ now, tasks: ["A"], template: "<h1>{{date}}</h1><h2>Gratitude</h2><p></p>" })).toMatch(/<h2>Gratitude<\/h2><p><\/p><h2>Today<\/h2>/);
  });
  it("opens the same note all day, created once", async () => {
    await storageSet("todos", [{ id: "t", title: "Plan sprint", completed: false, plannedFor: "2026-11-18", createdAt: "x" }, { id: "u", title: "Later", completed: false, dueDate: "2026-12-01", createdAt: "x" }]);
    await storageSet("days", [{ id: "2026-11-18", focus: "Sprint planning" }]);
    const first = await prepareDailyNote([], now);
    expect(first.note).toMatchObject({ dailyFor: "2026-11-18", autoTitle: false });
    expect(first.note!.content).toContain("Plan sprint");
    expect(first.note!.content).not.toContain("Later");
    expect(first.note!.content).toContain("Sprint planning");
    const again = await prepareDailyNote([first.note!], now);
    expect(again).toEqual({ id: first.note!.id });
    // A template named "Daily note" shapes it; other templates don't count as today's note.
    const tpl: Note = { id: "tpl", title: "Daily note", content: "<h1>My day {{date}}</h1><h2>Today</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p></p></li></ul>", createdAt: "x", updatedAt: "x", template: true, dailyFor: "2026-11-18" };
    const custom = await prepareDailyNote([tpl], now);
    expect(custom.note!.content).toContain("<h1>My day");
    expect(custom.note!.content).toContain("Plan sprint");
  });
});
