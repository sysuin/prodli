import { describe, expect, it } from "vitest";
import { decisionLog, decisionsToMarkdown } from "../../src/lib/decisions";
import type { Meeting } from "../../src/recorder/types";

const m = (id: string, startedAt: string, title: string, decisions: string[] | null) => ({ id, startedAt, title, summary: decisions ? { title, decisions } : null }) as unknown as Meeting;
const meetings = [m("a", "2026-11-10T10:00:00Z", "Pricing", ["Price at $5", "Yearly plan $48"]), m("b", "2026-11-18T10:00:00Z", "Launch sync", ["Ship Friday"]), m("c", "2026-11-19T10:00:00Z", "Chat", []), m("d", "2026-11-20T10:00:00Z", "Raw", null)];

describe("decisionLog", () => {
  it("lists meetings with decisions, newest first", () => {
    expect(decisionLog(meetings).map((g) => g.meetingId)).toEqual(["b", "a"]);
  });
  it("filters decisions by the search, or keeps all of a meeting whose title matches", () => {
    expect(decisionLog(meetings, "yearly")).toEqual([{ meetingId: "a", title: "Pricing", startedAt: "2026-11-10T10:00:00Z", decisions: ["Yearly plan $48"] }]);
    expect(decisionLog(meetings, "pricing")[0].decisions).toHaveLength(2);
    expect(decisionLog(meetings, "nothing")).toEqual([]);
  });
  it("copies as Markdown", () => {
    const md = decisionsToMarkdown(decisionLog(meetings));
    expect(md.startsWith("# Decisions\n\n## Launch sync (")).toBe(true);
    expect(md).toContain("- Price at $5");
  });
});
