// A12: Settings → Language for dictation, 🎙 Speak tasks and the daily brief.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageSet } from "../../src/lib/storage";
import { parseTask } from "../../src/lib/taskParse";
import { writeBrief } from "../../src/lib/today";
import { aiLanguage, briefLanguage, getVoiceLanguage, isVoiceLanguage, speechLocale, VOICE_LANGUAGE_KEY, VOICE_LANGUAGES, voiceLanguageInfo, whisperLanguage } from "../../src/lib/voiceLanguage";
import { linesFromDump } from "../../src/lib/voiceTasks";

describe("language → locale and Whisper code", () => {
  it("lists Automatic first, then the twelve languages, each with its native name", () => {
    expect(VOICE_LANGUAGES.map((l) => l.code)).toEqual(["auto", "en", "hi", "hinglish", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "ur"]);
    expect(voiceLanguageInfo("hi").label).toBe("Hindi (हिन्दी)");
    expect(voiceLanguageInfo("hinglish").label).toBe("Hinglish (Hindi in Latin letters)");
    expect(voiceLanguageInfo("ta").label).toBe("Tamil (தமிழ்)");
  });

  it.each([
    ["hi", "hi-IN"],
    ["bn", "bn-IN"],
    ["mr", "mr-IN"],
    ["te", "te-IN"],
    ["ta", "ta-IN"],
    ["gu", "gu-IN"],
    ["kn", "kn-IN"],
    ["ml", "ml-IN"],
    ["pa", "pa-IN"],
    ["ur", "ur-IN"],
    ["hinglish", "en-IN"],
  ] as const)("speaking %s uses the %s locale", (code, locale) => {
    expect(speechLocale(code, "en-US")).toBe(locale);
  });

  it("Automatic follows the browser; English keeps the browser's English variant", () => {
    expect(speechLocale("auto", "de-DE")).toBe("de-DE");
    expect(speechLocale("auto", "")).toBe("en-US");
    expect(speechLocale("en", "en-GB")).toBe("en-GB");
    expect(speechLocale("en", "hi-IN")).toBe("en-US");
  });

  it("sends Whisper an ISO 639-1 code (Hinglish as Hindi), and nothing on Automatic", () => {
    expect(whisperLanguage("auto")).toBeUndefined();
    expect(whisperLanguage("hi")).toBe("hi");
    expect(whisperLanguage("hinglish")).toBe("hi");
    expect(whisperLanguage("ur")).toBe("ur");
    for (const l of VOICE_LANGUAGES) if (l.whisper) expect(l.whisper).toMatch(/^[a-z]{2}$/);
  });

  it("the AI steps get the language unless Automatic; the brief only when it isn't English", () => {
    expect(aiLanguage("auto")).toBeUndefined();
    expect(aiLanguage("en")).toBe("en");
    expect(aiLanguage("hinglish")).toBe("hinglish");
    expect(briefLanguage("auto")).toBeUndefined();
    expect(briefLanguage("en")).toBeUndefined();
    expect(briefLanguage("mr")).toBe("mr");
  });

  it("reads the saved setting, and treats anything unknown as Automatic", async () => {
    expect(await getVoiceLanguage()).toBe("auto");
    await storageSet(VOICE_LANGUAGE_KEY, "ta");
    expect(await getVoiceLanguage()).toBe("ta");
    await storageSet(VOICE_LANGUAGE_KEY, "klingon");
    expect(await getVoiceLanguage()).toBe("auto");
    expect(isVoiceLanguage("hinglish")).toBe(true);
    expect(isVoiceLanguage("hi-IN")).toBe(false);
  });
});

describe("the chosen language reaches the server", () => {
  beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
  afterEach(() => vi.unstubAllEnvs());
  const signIn = () => storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });

  it("Speak tasks sends it with the brain dump (not on Automatic)", async () => {
    await signIn();
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), Response.json({ lines: ["माँ को फ़ोन करना tomorrow at 5pm"] }))) as typeof fetch;
    await linesFromDump("call mom");
    expect(bodies[0]).not.toHaveProperty("language");
    await storageSet(VOICE_LANGUAGE_KEY, "hi");
    expect(await linesFromDump("कल शाम 5 बजे माँ को फ़ोन करना")).toEqual({ ai: true, lines: ["माँ को फ़ोन करना tomorrow at 5pm"] });
    expect(bodies[1]).toMatchObject({ language: "hi" });
  });

  it("the daily brief sends it unless it's Automatic or English", async () => {
    await signIn();
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), Response.json({ brief: { headline: "आज", summary: "", priorities: [], schedule: [], watchouts: [], habits: [], tip: "", model: "m", generatedAt: "x" }, usage: { used: 1, limit: 62 } }))) as typeof fetch;
    const ctx = { date: "2026-11-10", weekday: "Tuesday", now: "08:30", tasks: [{ title: "Write notes" }] };
    await storageSet(VOICE_LANGUAGE_KEY, "en");
    await writeBrief(ctx);
    expect(bodies[0]).not.toHaveProperty("language");
    await storageSet(VOICE_LANGUAGE_KEY, "hi");
    expect(await writeBrief(ctx)).toMatchObject({ brief: { headline: "आज", source: "ai" } });
    expect(bodies[1]).toMatchObject({ language: "hi", date: "2026-11-10" });
  });
});

describe("dates the AI writes after a Hindi title still parse", () => {
  const NOW = new Date(2026, 10, 10, 9, 0); // Tuesday 10 Nov 2026
  it("reads the English date words after a Devanagari or Hinglish title", () => {
    expect(parseTask("माँ को फ़ोन करना tomorrow at 5pm", NOW)).toMatchObject({ title: "माँ को फ़ोन करना", dueDate: "2026-11-11", dueTime: "17:00" });
    expect(parseTask("Mummy ko call karna tomorrow at 5pm", NOW)).toMatchObject({ title: "Mummy ko call karna", dueDate: "2026-11-11", dueTime: "17:00" });
    expect(parseTask("রিপোর্ট পাঠানো friday !high", NOW)).toMatchObject({ title: "রিপোর্ট পাঠানো", dueDate: "2026-11-13", priority: "high" });
  });
});
