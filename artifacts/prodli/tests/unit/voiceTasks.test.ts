import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linesFromDump, splitLocally } from "../../src/lib/voiceTasks";
import { storageSet } from "../../src/lib/storage";

describe("speak tasks: splitting without AI", () => {
  it("splits sentences, lines, bullets and 'also/then', and trims filler", () => {
    expect(splitLocally("I need to call mom tomorrow at 5pm. Buy milk; also book the dentist\n- Pay rent friday !high")).toEqual(["Call mom tomorrow at 5pm", "Buy milk", "Book the dentist", "Pay rent friday !high"]);
    expect(splitLocally("Salt and pepper")).toEqual(["Salt and pepper"]); // "and" alone doesn't split
    expect(splitLocally("  ")).toEqual([]);
  });
});

describe("speak tasks: through the account", () => {
  beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
  afterEach(() => vi.unstubAllEnvs());
  it("uses sentences when signed out, and the AI with list names when signed in", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const out = await linesFromDump("Call mom. Buy milk");
    expect(out).toMatchObject({ ai: false, lines: ["Call mom", "Buy milk"] });
    expect(out.note).toMatch(/Sign in/);
    await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
    await storageSet("lists", [{ id: "w", kind: "list", name: "Work", createdAt: "x" }, { id: "f", kind: "filter", name: "Urgent", query: {}, createdAt: "x" }]);
    let sent: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ lines: ["Call mom tomorrow at 5pm", "Finish report friday #Work !high"] });
    }) as typeof fetch;
    expect(await linesFromDump("ugh call mom tomorrow around five and the work report friday urgent")).toEqual({ ai: true, lines: ["Call mom tomorrow at 5pm", "Finish report friday #Work !high"] });
    expect(sent).toMatchObject({ lists: ["Work"] }); // filters aren't lists
    globalThis.fetch = vi.fn(async () => Response.json({ error: "write_quota_exceeded" }, { status: 429 })) as typeof fetch;
    const fallback = await linesFromDump("Call mom. Buy milk");
    expect(fallback).toMatchObject({ ai: false, lines: ["Call mom", "Buy milk"] });
    expect(fallback.note).toMatch(/used this month's writing help/);
  });
});
