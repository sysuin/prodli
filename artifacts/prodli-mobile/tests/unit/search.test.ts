import { describe, expect, it } from "vitest";
import { search, snippetAround } from "../../src/lib/search";
import type { Meeting } from "../../src/lib/meetings";

describe("search", () => {
  it("finds notes, to-dos, meetings and Read later that contain every word, newest first", () => {
    const meeting = { id: "m", title: "Weekly sync", startedAt: "2026-11-20T09:00:00.000Z", transcript: [{ id: "1", speaker: "A", text: "the beta ships friday", startMs: 0, endMs: 1 }], summary: null } as unknown as Meeting;
    const hits = search("beta friday", {
      notes: [{ id: "n", title: "Launch", content: "<p>Beta goes out <b>Friday</b></p>", createdAt: "", updatedAt: "2026-11-19T00:00:00.000Z" }, { id: "t", title: "Tpl", content: "<p>beta friday</p>", createdAt: "", updatedAt: "2026-11-21T00:00:00.000Z", template: true }],
      todos: [{ id: "x", title: "Email beta testers by friday", completed: false, createdAt: "2026-11-18T00:00:00.000Z" }, { id: "y", title: "Beta only", completed: false, createdAt: "2026-11-21T00:00:00.000Z" }],
      meetings: [meeting],
      readLater: [{ id: "r", url: "https://example.com/beta", title: "Beta friday checklist", createdAt: "2026-11-17T00:00:00.000Z" }],
    });
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(["meeting:m", "note:n", "todo:x", "readLater:r"]);
    expect(hits[1].snippet).toBe("Beta goes out Friday");
    expect(search("  ", { notes: [], todos: [], meetings: [], readLater: [] })).toEqual([]);
  });

  it("shows a few words around the match", () => {
    expect(snippetAround(`${"a ".repeat(100)}needle ${"b ".repeat(100)}`, "needle", 30)).toMatch(/^….*needle.*…$/);
  });
});
