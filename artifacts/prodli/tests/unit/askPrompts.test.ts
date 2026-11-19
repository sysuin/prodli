import { describe, expect, it } from "vitest";
import { pickSnippets, sourcesFrom } from "../../src/lib/ask";
import { addPrompt, getPrompts, nextRun, scheduleLabel } from "../../src/lib/askPrompts";
import type { Note } from "../../src/types";

describe("Ask ProdLi sources", () => {
  const notes: Note[] = [
    { id: "n1", title: "Launch plan", content: "<p>Ship the beta on Friday</p>", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" },
    { id: "n2", title: "Groceries", content: "<p>Milk</p>", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" },
  ];
  it("keeps which note each snippet came from, and maps the answer's numbers back", () => {
    const snippets = pickSnippets("when do we ship the launch?", notes, []);
    expect(snippets[0]).toMatchObject({ kind: "note", id: "n1", title: "Launch plan" });
    expect(sourcesFrom([1, 1, 7, 0], snippets)).toEqual([{ kind: "note", id: "n1", title: "Launch plan", date: "2026-11-10" }]);
  });
});

describe("saved and scheduled prompts", () => {
  it("saves a question once", async () => {
    const a = await addPrompt(" What's overdue? ");
    const b = await addPrompt("what's overdue?");
    expect(b?.id).toBe(a?.id);
    expect((await getPrompts()).filter((p) => p.text === "What's overdue?")).toHaveLength(1);
    expect(await addPrompt("   ")).toBeNull();
  });
  it("finds the next run on a chosen day and time", () => {
    const wed9 = new Date(2026, 10, 18, 9, 0); // Wednesday
    expect(new Date(nextRun({ time: "08:30", days: [1, 2, 3, 4, 5] }, wed9)!)).toEqual(new Date(2026, 10, 19, 8, 30)); // Thu
    expect(new Date(nextRun({ time: "17:00", days: [3] }, wed9)!)).toEqual(new Date(2026, 10, 18, 17, 0)); // later today
    expect(new Date(nextRun({ time: "08:00", days: [3] }, wed9)!)).toEqual(new Date(2026, 10, 25, 8, 0)); // next week
    expect(nextRun({ time: "08:00", days: [] }, wed9)).toBeNull();
    expect(scheduleLabel({ time: "08:30", days: [5, 1, 2, 3, 4] })).toBe("Weekdays at 08:30");
  });
});
