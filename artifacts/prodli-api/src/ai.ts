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

export interface SummarizeInput {
  title: string;
  date: string;
  transcript: string;
  template?: MeetingTemplate;
  glossary?: string[];
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
          content: `Meeting date: ${input.date}\nMeeting name: ${input.title}\n${input.template && MEETING_TEMPLATES[input.template] ? `\n${MEETING_TEMPLATES[input.template]}\n` : ""}${input.glossary?.length ? `\nNames and terms to spell exactly as written here (captions often mishear them): ${input.glossary.join(", ")}\n` : ""}\n<transcript>\n${input.transcript}\n</transcript>\n\nWrite the meeting notes.`,
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
export type UsageTable = "ai_usage" | "brief_usage" | "ask_usage" | "write_usage";

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
