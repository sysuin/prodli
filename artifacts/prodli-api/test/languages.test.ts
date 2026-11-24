// A12: one Language setting for dictation, 🎙 Speak tasks and the daily brief.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SUMMARY_LANGUAGES } from "../src/ai";
import { briefUserMessage } from "../src/brief";
import { dictateRequest, DictateInputSchema } from "../src/dictate";
import { briefLanguageText, dictationLanguageText, isVoiceLanguage, isWhisperLanguage, languageName, tasksLanguageText, VOICE_LANGUAGES, WHISPER_LANGUAGES } from "../src/languages";
import { transcribeWithWorkersAi } from "../src/transcribe";
import { ExtractTasksInputSchema, extractTasksUserMessage } from "../src/write";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

describe("language allow-lists", () => {
  it("knows the twelve languages and nothing else", () => {
    expect([...VOICE_LANGUAGES]).toEqual(["en", "hi", "hinglish", "bn", "mr", "te", "ta", "gu", "kn", "ml", "pa", "ur"]);
    for (const code of VOICE_LANGUAGES) expect(isVoiceLanguage(code)).toBe(true);
    for (const bad of ["auto", "", "HI", "hi-IN", "fr", "xx", "constructor", "__proto__", 1, null, undefined]) expect(isVoiceLanguage(bad)).toBe(false);
  });

  it("sends Whisper ISO 639-1 codes only (Hinglish goes as Hindi)", () => {
    expect(WHISPER_LANGUAGES).not.toContain("hinglish");
    for (const code of WHISPER_LANGUAGES) expect(code).toMatch(/^[a-z]{2}$/);
    for (const code of VOICE_LANGUAGES.filter((c) => c !== "hinglish")) expect(isWhisperLanguage(code)).toBe(true);
    for (const bad of ["hinglish", "auto", "hin", "hi-IN", "fr", "toString"]) expect(isWhisperLanguage(bad)).toBe(false);
  });

  it("names every language from the meeting notes' list", () => {
    expect(languageName("hi")).toBe("Hindi");
    expect(languageName("pa")).toBe("Punjabi");
    expect(languageName("hinglish")).toBe("Hinglish");
    for (const code of VOICE_LANGUAGES.filter((c) => c !== "hinglish")) expect(SUMMARY_LANGUAGES[code]).toBeTruthy();
  });

  it("rejects unknown languages in the request schemas", () => {
    expect(DictateInputSchema.safeParse({ text: "x", language: "hi" }).success).toBe(true);
    expect(DictateInputSchema.safeParse({ text: "x", language: "fr" }).success).toBe(false);
    expect(DictateInputSchema.safeParse({ text: "x" }).data?.language).toBeUndefined();
    expect(ExtractTasksInputSchema.safeParse({ text: "x", language: "hinglish" }).success).toBe(true);
    expect(ExtractTasksInputSchema.safeParse({ text: "x", language: "auto" }).success).toBe(false);
  });
});

describe("prompt additions", () => {
  it("tells the dictation clean-up the language and its script", () => {
    expect(dictationLanguageText(undefined)).toBe("");
    expect(dictationLanguageText("hi")).toMatch(/Hindi.*Devanagari/);
    expect(dictationLanguageText("mr")).toMatch(/Marathi.*Devanagari/);
    expect(dictationLanguageText("ta")).toMatch(/Tamil script/);
    expect(dictationLanguageText("pa")).toMatch(/Gurmukhi/);
    expect(dictationLanguageText("ur")).toMatch(/Perso-Arabic/);
    expect(dictationLanguageText("hinglish")).toMatch(/Latin letters/);
    expect(dictationLanguageText("hinglish")).toMatch(/Devanagari, transliterate/);

    const polish = dictateRequest(DictateInputSchema.parse({ text: "कल मिलते हैं", language: "hi" }));
    expect(polish.user).toContain("Language: Hindi. Write it in Devanagari script");
    expect(polish.user).toContain("<dictation>\nकल मिलते हैं\n</dictation>");
    expect(polish.system).toMatch(/Devanagari for Hindi, Latin letters for Hinglish/);
    // Automatic: nothing added, the same message as before.
    expect(dictateRequest(DictateInputSchema.parse({ text: "hello" })).user).not.toContain("Language:");
    // Command Mode: the spoken instruction decides (it may ask for a translation).
    expect(dictateRequest(DictateInputSchema.parse({ mode: "command", text: "translate to English", selection: "नमस्ते", language: "hi" })).user).not.toContain("Language:");
  });

  it("keeps Speak tasks titles in the spoken language with English date words", () => {
    expect(tasksLanguageText(undefined)).toBe("");
    expect(tasksLanguageText("en")).toBe("");
    expect(tasksLanguageText("hi")).toMatch(/titles in Hindi, in Devanagari script/);
    expect(tasksLanguageText("hi")).toContain("tomorrow at 5pm");
    expect(tasksLanguageText("hinglish")).toContain('"kal shaam 5 baje mummy ko call karna" → "Mummy ko call karna tomorrow at 5pm"');
    const msg = extractTasksUserMessage(ExtractTasksInputSchema.parse({ text: "kal shaam 5 baje mummy ko call karna", lists: ["Work"], language: "hinglish" }));
    expect(msg).toMatch(/^Existing lists: #Work\n\nThe person speaks Hinglish/);
    expect(msg).toContain("<brain_dump>\nkal shaam 5 baje mummy ko call karna\n</brain_dump>");
    expect(extractTasksUserMessage(ExtractTasksInputSchema.parse({ text: "buy milk" }))).toBe("<brain_dump>\nbuy milk\n</brain_dump>");
  });

  it("writes the brief in the chosen language with the meeting notes' wording", () => {
    expect(briefLanguageText(undefined)).toBe("");
    expect(briefLanguageText("en")).toBe("");
    expect(briefLanguageText("hi")).toMatch(/^Write every text field in Hindi \(Devanagari script\), whatever language/);
    expect(briefLanguageText("hi")).toMatch(/Translate faithfully; keep people's names, product names/);
    expect(briefLanguageText("bn")).toMatch(/Bengali \(Bengali script\)/);
    expect(briefLanguageText("hinglish")).toMatch(/Hinglish.*Latin letters/);
    const day = { date: "2026-11-10", weekday: "Tuesday", now: "08:30", tasks: [{ title: "Write release notes" }] };
    const hi = briefUserMessage({ ...day, language: "hi" });
    expect(hi).toContain("Write every text field in Hindi");
    expect(hi).not.toContain('"language"'); // an instruction, not part of the day's data
    expect(briefUserMessage(day)).toBe(`Here is my day as JSON:\n<day>\n${JSON.stringify(day)}\n</day>\n\nWrite my daily brief.`);
    expect(briefUserMessage({ ...day, language: "en" })).toBe(briefUserMessage(day));
  });
});

describe("Whisper on Workers AI", () => {
  const fakeAi = () => {
    const inputs: Record<string, unknown>[] = [];
    const ai = { run: async (_model: string, input: Record<string, unknown>) => (inputs.push(input), { text: " नमस्ते ", segments: [], transcription_info: { language: "hi" } }) } as unknown as Ai;
    return { ai, inputs };
  };
  const wav = new Uint8Array(44 + 3200);

  it("forwards the language to Whisper as `language`", async () => {
    const { ai, inputs } = fakeAi();
    expect(await transcribeWithWorkersAi(wav, ai, [], "hi")).toEqual({ text: "नमस्ते", segments: [], language: "hi" });
    expect(inputs[0]).toMatchObject({ task: "transcribe", language: "hi" });
  });

  it("leaves it out on Automatic, so Whisper detects the language", async () => {
    const { ai, inputs } = fakeAi();
    await transcribeWithWorkersAi(wav, ai, ["ProdLi"]);
    expect(inputs[0]).not.toHaveProperty("language");
    expect(inputs[0]).toMatchObject({ initial_prompt: "ProdLi" });
  });
});

describe("routes", () => {
  let base: Env;
  let dispose: () => Promise<void>;
  beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
  afterAll(async () => dispose());
  beforeEach(async () => {
    await base.DB.batch(["ai_usage", "brief_usage", "write_usage", "dictate_usage", "transcribe_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
  });
  const withKey = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test", AI: {} as Ai }) as Env;
  async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env) {
    const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "good:sub-l:l@example.com:L" }, { Origin: EXT_ORIGIN }), env);
    return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}`, Origin: EXT_ORIGIN };
  }
  const wav = (seconds: number) => {
    const data = seconds * 32000;
    const b = new Uint8Array(44 + data);
    const v = new DataView(b.buffer);
    const put = (at: number, t: string) => [...t].forEach((ch, i) => (b[at + i] = ch.charCodeAt(0)));
    put(0, "RIFF"); v.setUint32(4, 36 + data, true); put(8, "WAVE"); put(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    put(36, "data"); v.setUint32(40, data, true);
    return b;
  };
  const audio = (headers: Record<string, string>) => ({ method: "POST", headers: { ...headers, "Content-Type": "audio/wav" }, body: wav(2) });

  it("transcribe forwards ?language= and rejects codes outside the allow-list (before counting seconds)", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/transcribe?language=hi", audio(auth), env)).status).toBe(200);
    expect(calls).toContainEqual({ kind: "transcribe-language", clientId: "hi" });
    expect((await app.request("/api/ai/transcribe", audio(auth), env)).status).toBe(200);
    expect(calls.filter((c) => c.kind === "transcribe-language")).toHaveLength(1);
    for (const bad of ["hinglish", "xx", "hi-IN"]) expect((await app.request(`/api/ai/transcribe?language=${bad}`, audio(auth), env)).status).toBe(400);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ transcribeSeconds: { used: 4 } });
  });

  it("dictate and Speak tasks pass the language on, and refuse unknown ones (free plan)", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/dictate", json({ text: "um kal milte hain", language: "hinglish" }, auth), env)).status).toBe(200);
    expect(calls).toContainEqual({ kind: "dictate-language", clientId: "hinglish" });
    expect((await app.request("/api/ai/dictate", json({ text: "hello", language: "klingon" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/extract-tasks", json({ text: "दूध लाना and माँ को फ़ोन", language: "hi" }, auth), env)).status).toBe(200);
    expect(calls).toContainEqual({ kind: "extract-language", clientId: "hi" });
    expect((await app.request("/api/ai/extract-tasks", json({ text: "x", language: "auto" }, auth), env)).status).toBe(400);
  });

  it("the brief takes a language on the free plan, and refuses unknown ones", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const day = { date: "2026-11-10", weekday: "Tuesday", now: "08:30", tasks: [{ title: "Write release notes" }] };
    expect((await app.request("/api/ai/brief", json({ ...day, language: "ta" }, auth), env)).status).toBe(200);
    expect(calls).toContainEqual({ kind: "brief-language", clientId: "ta" });
    expect((await app.request("/api/ai/brief", json({ ...day, language: "tamil" }, auth), env)).status).toBe(400);
  });
});
