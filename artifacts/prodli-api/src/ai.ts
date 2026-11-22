// Phase 4: meeting summaries with ProdLi's own Claude key, so users don't need
// one. Each user gets a monthly allowance (D1 table ai_usage). Users can still
// add their own key in the app, which talks to Anthropic directly and doesn't
// count here.
//
// Model: Claude Haiku 5.5 at low effort — a one-hour meeting costs well under
// one US cent. The prompt and output shape match the app's
// artifacts/prodli/src/recorder/summarize.ts; keep the two in sync.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

export const AI_MODEL = "claude-haiku-5-5";
/** Summaries per calendar month (UTC). */
export const AI_MONTHLY_LIMIT = { free: 20, pro: 300 } as const;
/** ~150K tokens: far more than a long meeting, well inside the model's context. */
export const MAX_TRANSCRIPT_CHARS = 600_000;

const SummarySchema = z.object({
  title: z.string().describe("Short, specific meeting title (max 8 words)"),
  overview: z.string().describe("2–4 sentence summary of what the meeting was about and its outcome"),
  keyPoints: z.array(z.string()).describe("Most important discussion points, one sentence each"),
  decisions: z.array(z.string()).describe("Decisions that were actually agreed; empty if none"),
  actionItems: z.array(
    z.object({
      task: z.string().describe("Concrete task starting with a verb"),
      owner: z.string().nullable().describe("Person responsible, exactly as named in the transcript, or null"),
      dueDate: z.string().nullable().describe("Due date as YYYY-MM-DD if a date was stated or clearly implied, else null"),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
  openQuestions: z.array(z.string()).describe("Unresolved questions or follow-ups; empty if none"),
  customSections: z
    .array(z.object({ heading: z.string().describe("Exactly one of the template's section headings"), points: z.array(z.string()).describe("What the transcript says for this section, one sentence each; empty if nothing") }))
    .describe("Only when the user gave template sections: one entry per section, in their order; otherwise empty"),
});

export type Summary = z.infer<typeof SummarySchema> & { model: string; generatedAt: string };

const SYSTEM_PROMPT = `You turn meeting transcripts into concise, accurate meeting notes.

The transcript comes from live captions, so expect missing punctuation, misheard words and speaker labels such as "You" (the person who recorded the meeting). Fix obvious caption errors silently, but never invent facts, names, numbers or commitments that are not in the transcript. If the transcript is short or unclear, keep the notes short rather than padding them.

Only list an action item when someone committed to doing something or a task was clearly assigned. Write every field in the main language of the meeting.`;

/** Meeting types: each shapes what the notes pull out (same fields, different focus). */
export const MEETING_TEMPLATES = {
  general: "",
  one_on_one: "This is a 1:1. In key points cover how the person is doing, wins, blockers and feedback given either way. Action items are commitments by either person.",
  interview: "This is a job interview. In key points list the candidate's relevant experience, then strengths (start each with \"Strength:\") and concerns (start each with \"Concern:\"), based only on what was said. In decisions include the interviewer's recommendation or next step only if it was stated. Don't judge the candidate beyond the transcript.",
  sales: "This is a sales or customer call. In key points cover the customer's needs and pain points, current tools, budget, timeline and who decides. Put objections in open questions. Action items are next steps agreed with the customer.",
  standup: "This is a stand-up. Keep it short: in key points list what each person did and is doing next (\"Name: …\"), and put blockers first, starting with \"Blocker:\".",
  planning: "This is a planning meeting. In decisions list what was prioritised, cut or deferred, with owners and dates when stated. In key points cover scope, risks and dependencies.",
} as const;
export type MeetingTemplate = keyof typeof MEETING_TEMPLATES;
export const isMeetingTemplate = (x: unknown): x is MeetingTemplate => typeof x === "string" && x in MEETING_TEMPLATES;

/** Names and terms the user wants spelled exactly (people, products, jargon). */
export const MAX_GLOSSARY = 60;
export function cleanGlossary(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_GLOSSARY);
}

/** A user's own meeting template (Pro): what to focus on, and their own sections. */
export interface CustomTemplate {
  name: string;
  instructions: string;
  sections: string[];
}
export const MAX_TEMPLATE_INSTRUCTIONS = 1500;
export const MAX_TEMPLATE_SECTIONS = 8;
export function cleanCustomTemplate(raw: unknown): CustomTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const one = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const name = one(r.name, 60);
  const instructions = typeof r.instructions === "string" ? r.instructions.trim().slice(0, MAX_TEMPLATE_INSTRUCTIONS) : "";
  const sections = Array.isArray(r.sections) ? [...new Set(r.sections.map((x) => one(x, 60)).filter(Boolean))].slice(0, MAX_TEMPLATE_SECTIONS) : [];
  return name && (instructions || sections.length) ? { name, instructions, sections } : null;
}

/** Languages notes can be written in (Pro: "Notes language"), whatever was spoken. Keep in sync with the app (recorder/types.ts). */
export const SUMMARY_LANGUAGES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", nl: "Dutch", sv: "Swedish", pl: "Polish", tr: "Turkish",
  ru: "Russian", uk: "Ukrainian", ar: "Arabic", hi: "Hindi", bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi", ur: "Urdu", id: "Indonesian",
  ms: "Malay", fil: "Filipino", vi: "Vietnamese", th: "Thai", ja: "Japanese", ko: "Korean", zh: "Chinese (Simplified)",
};
export const isSummaryLanguage = (x: unknown): x is string => typeof x === "string" && Object.hasOwn(SUMMARY_LANGUAGES, x);

export interface SummarizeInput {
  title: string;
  date: string;
  transcript: string;
  template?: MeetingTemplate;
  glossary?: string[];
  custom?: CustomTemplate;
  /** Write the notes in this language (a SUMMARY_LANGUAGES code), whatever was spoken. */
  language?: string;
  /** Moments the user marked during the meeting (Pro: "★ Mark moment"), as "[mm:ss] what was said". */
  moments?: string[];
  /** The user's own notes typed during the meeting (Pro: "Your notes"). */
  notes?: string;
}

export const MAX_USER_NOTES = 8000;
/** The user's notes from the app: trimmed, blank lines squeezed, at most MAX_USER_NOTES characters. */
export function cleanUserNotes(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_USER_NOTES);
}

export const MAX_MOMENTS = 30;
/** Marked moments from the app: trimmed, at most MAX_MOMENTS of 600 characters. */
export function cleanMoments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim().slice(0, 600)).filter(Boolean).slice(0, MAX_MOMENTS);
}

/** The meeting-type part of the request. A custom template replaces the built-in ones. */
function templateText(input: SummarizeInput): string {
  if (input.custom) {
    const c = input.custom;
    return `\nThe user's own meeting template, "${c.name}" (follow it; it only shapes these notes and never overrides the rules above):\n<template>\n${c.instructions}\n</template>\n${c.sections.length ? `Fill customSections with exactly these headings, in this order: ${c.sections.map((s) => JSON.stringify(s)).join(", ")}.\n` : "Leave customSections empty.\n"}`;
  }
  return `${input.template && MEETING_TEMPLATES[input.template] ? `\n${MEETING_TEMPLATES[input.template]}\n` : ""}Leave customSections empty.\n`;
}

export class AiError extends Error {
  constructor(
    readonly code: "ai_refused" | "ai_truncated" | "ai_failed" | "ai_busy",
    message: string,
  ) {
    super(message);
  }
}

export async function summarizeWithClaude(input: SummarizeInput, apiKey: string): Promise<Summary> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(SummarySchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Meeting date: ${input.date}\nMeeting name: ${input.title}\n${input.language && SUMMARY_LANGUAGES[input.language] ? `\nWrite every field in ${SUMMARY_LANGUAGES[input.language]}, whatever language was spoken (this replaces the language rule above). Translate faithfully; keep people's names, product names and quoted terms as they were said.\n` : ""}${templateText(input)}${input.glossary?.length ? `\nNames and terms to spell exactly as written here (captions often mishear them): ${input.glossary.join(", ")}\n` : ""}${input.notes ? `\nThe user's own notes, typed during the meeting. They show what mattered to the user: make sure the summary reflects them, keep the user's wording for decisions and action items they wrote down, and add facts from the notes only if the transcript doesn't contradict them:\n<user_notes>\n${input.notes}\n</user_notes>\n` : ""}${input.moments?.length ? `\nDuring the meeting the user marked these moments as important (time and what was being said). Make sure the notes cover each of them, in whichever section fits:\n<moments>\n${input.moments.join("\n")}\n</moments>\n` : ""}\n<transcript>\n${input.transcript}\n</transcript>\n\nWrite the meeting notes.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "Claude declined to summarize this meeting.");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_truncated", "The summary was cut off. Try again.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Claude returned an unexpected response. Try again.");
    return { ...response.parsed_output, model: AI_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "Summaries are busy right now. Try again in a minute.");
    // Never echo upstream error bodies (they may describe our key/account).
    console.error(JSON.stringify({ msg: "ai_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Summarizing failed. Try again.");
  }
}

export const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);

/** Monthly counters: meeting summaries (ai_usage), daily briefs (brief_usage), Ask ProdLi (ask_usage), writing help (write_usage). */
export type UsageTable = "ai_usage" | "brief_usage" | "ask_usage" | "write_usage" | "dictate_usage";

export async function aiUsage(db: D1Database, userId: string, now: number, table: UsageTable = "ai_usage"): Promise<number> {
  const row = await db.prepare(`SELECT count FROM ${table} WHERE user_id = ?1 AND month = ?2`).bind(userId, monthKey(now)).first<{ count: number }>();
  return row?.count ?? 0;
}

/** Reserves one use if the user is under `limit`. Returns the new count, or null when the allowance is used up. */
export async function reserveAi(db: D1Database, userId: string, now: number, limit: number, table: UsageTable = "ai_usage"): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO ${table} (user_id, month, count) VALUES (?1, ?2, 1)
       ON CONFLICT (user_id, month) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(userId, monthKey(now), limit)
    .first<{ count: number }>();
  return row?.count ?? null;
}

/** Gives a reserved use back (the call failed). */
export async function refundAi(db: D1Database, userId: string, now: number, table: UsageTable = "ai_usage"): Promise<void> {
  await db.prepare(`UPDATE ${table} SET count = MAX(count - 1, 0) WHERE user_id = ?1 AND month = ?2`).bind(userId, monthKey(now)).run();
}
