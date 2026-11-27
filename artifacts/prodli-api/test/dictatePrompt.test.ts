// Dictation clean-up prompts: levels, the Excited style and context from the field.
import { describe, expect, it } from "vitest";
import { dictateRequest, DictateInputSchema, MAX_CONTEXT_CHARS } from "../src/dictate";

const req = (o: Record<string, unknown>) => dictateRequest(DictateInputSchema.parse({ text: "so um we should ship friday", ...o }));

describe("dictation prompts", () => {
  it("defaults to the light clean-up, and tightens only when asked", () => {
    expect(req({}).user).not.toMatch(/tighten/);
    expect(req({ level: "concise" }).user).toMatch(/Also tighten it/);
    expect(() => DictateInputSchema.parse({ text: "x", level: "heavy" })).toThrow();
  });

  it("knows the Excited style", () => {
    expect(req({ style: "excited" }).user).toMatch(/Style: excited/);
  });

  it("passes the text before the cursor as context, and says when it ends mid-sentence", () => {
    const mid = req({ before: "Hi Priya, thanks for" }).user;
    expect(mid).toContain("<before_cursor>\nHi Priya, thanks for\n</before_cursor>");
    expect(mid).toMatch(/ends mid-sentence/);
    const done = req({ before: "Hi Priya.\n" }).user;
    expect(done).toContain("<before_cursor>");
    expect(done).not.toMatch(/ends mid-sentence/);
    expect(req({ before: "   " }).user).not.toContain("<before_cursor>");
    expect(() => DictateInputSchema.parse({ text: "x", before: "a".repeat(MAX_CONTEXT_CHARS + 1) })).toThrow();
    // Command Mode ignores it.
    expect(dictateRequest(DictateInputSchema.parse({ mode: "command", text: "shorter", selection: "long text", before: "context" })).user).not.toContain("before_cursor");
  });
});
