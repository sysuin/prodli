import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeMeeting, SummarizeError } from "../../src/recorder/summarize";
import { audioFileName, meetingMatches } from "../../src/sections/MeetingsSection";
import { storageSet } from "../../src/lib/storage";
import type { Meeting } from "../../src/recorder/types";

const meeting: Meeting = {
  id: "m1", platform: "google-meet", title: "Standup", meetingCode: null, url: "", startedAt: "2026-11-01T09:00:00.000Z", endedAt: null, durationSec: 60,
  status: "ready", transcript: [{ id: "e1", speaker: "Ann", text: "Ship it on Friday", startMs: 0, endMs: 1 }], summary: null, error: null, notice: null,
  hasAudio: false, micIncluded: false, audioMimeType: null, updatedAt: "2026-11-01T09:01:00.000Z",
};

describe("AI summaries through the ProdLi account", () => {
  let requests: { url: string; body: Record<string, unknown> }[];
  beforeEach(() => {
    vi.stubEnv("VITE_PRODLI_API", "https://api.test");
    requests = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      if (String(url).endsWith("/api/ai/summarize")) {
        if ((init?.body as string).includes("QUOTA")) return Response.json({ error: "ai_quota_exceeded" }, { status: 429 });
        return Response.json({ summary: { title: "Standup notes", overview: "o", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], model: "claude-haiku-5-5", generatedAt: "x" } });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the ProdLi account when signed in, sending the transcript as text", async () => {
    await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
    const s = await summarizeMeeting(meeting);
    expect(s.title).toBe("Standup notes");
    expect(requests[0]).toMatchObject({ url: "https://api.test/api/ai/summarize", body: { title: "Standup", date: "2026-11-01", transcript: "[00:00] Ann: Ship it on Friday" } });
  });

  it("explains the monthly limit in plain words", async () => {
    await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
    await expect(summarizeMeeting({ ...meeting, title: "QUOTA" })).rejects.toThrow(/used this month's AI summaries.*ProdLi Pro/);
  });

  it("asks to sign in when signed out", async () => {
    await expect(summarizeMeeting(meeting)).rejects.toBeInstanceOf(SummarizeError);
    await expect(summarizeMeeting(meeting)).rejects.toThrow(/Sign in to your ProdLi account/);
    expect(requests).toEqual([]);
  });
});

describe("meeting search", () => {
  it("matches titles, summaries and transcript text, case-insensitively", () => {
    expect(meetingMatches(meeting, "friday")).toBe(true);
    expect(meetingMatches(meeting, "ANN")).toBe(true);
    expect(meetingMatches(meeting, "budget")).toBe(false);
    expect(meetingMatches({ ...meeting, summary: { title: "t", overview: "Budget review", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], model: "", generatedAt: "" } }, "budget")).toBe(true);
    expect(meetingMatches(meeting, "  ")).toBe(true);
  });
});

describe("meeting audio download", () => {
  it("names the file after the meeting, with an extension that matches the recording", () => {
    expect(audioFileName({ title: "Google Meet · abc", audioMimeType: "audio/webm;codecs=opus", summary: { title: "Weekly sync" } })).toBe("Weekly sync-audio.webm");
    expect(audioFileName({ title: "Call", audioMimeType: "audio/ogg" })).toBe("Call-audio.ogg");
    expect(audioFileName({ title: "Call", audioMimeType: "audio/mp4" })).toBe("Call-audio.m4a");
    expect(audioFileName({ title: "Call", audioMimeType: null })).toBe("Call-audio.webm");
    // Characters that file systems reject are replaced; very long names are shortened.
    expect(audioFileName({ title: 'Q3: plan / budget? "draft"', audioMimeType: null })).toBe("Q3 plan budget draft-audio.webm");
    expect(audioFileName({ title: "x".repeat(300), audioMimeType: null })).toBe(`${"x".repeat(100)}-audio.webm`);
    expect(audioFileName({ title: "///", audioMimeType: null })).toBe("meeting-audio.webm");
  });
});
