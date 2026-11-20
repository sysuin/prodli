// "🎯 Coach me" on a meeting (Pro): short, honest feedback on how the user ran
// or took part in a meeting — what went well, what to try next time, whether
// clear next steps were agreed, and questions worth having asked. The app sends
// the transcript (and the talk share if it was recorded); nothing is stored
// here except the count (it uses the monthly meeting-summary allowance).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AI_MODEL, AiError, MAX_TRANSCRIPT_CHARS } from "./ai";

export const COACH_FOCUS = ["general", "sales", "interview", "one-on-one", "presentation"] as const;

export const CoachInputSchema = z.object({
  title: z.string().max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transcript: z.string().min(1).max(MAX_TRANSCRIPT_CHARS),
  /** How the user appears in the transcript ("You"), or null if it doesn't say. */
  you: z.string().max(60).nullable().default(null),
  /** The user's share of the talking (0–100), if it was recorded. */
  talkShare: z.number().int().min(0).max(100).nullable().default(null),
  focus: z.enum(COACH_FOCUS).default("general"),
});
export type CoachInput = z.infer<typeof CoachInputSchema>;

const CoachSchema = z.object({
  verdict: z.string().describe("One sentence: how the meeting went for the user, plainly"),
  strengths: z.array(z.string()).describe("2–3 specific things that worked, pointing to what was said"),
  improvements: z.array(z.string()).describe("2–3 specific, doable things to try next time, each tied to a moment in this meeting"),
  nextStepsAgreed: z.boolean().describe("Did the meeting end with clear next steps that have owners?"),
  nextStepsNote: z.string().describe("One sentence on the next steps: what was agreed, or what was left vague"),
  missedQuestions: z.array(z.string()).describe("Up to 3 questions the user could have asked; empty if none stand out"),
});
export type Coaching = z.infer<typeof CoachSchema> & { model: string; generatedAt: string };

const FOCUS_TEXT: Record<CoachInput["focus"], string> = {
  general: "",
  sales: "This was a sales conversation: look at discovery (needs, budget, decision process, timeline), listening, handling objections and a clear next step.",
  interview: "This was an interview the user ran: look at question quality, follow-ups, letting the candidate talk, and bias-free, consistent questions.",
  "one-on-one": "This was a one-on-one the user ran: look at listening, open questions, support, feedback and agreed actions.",
  presentation: "The user was presenting: look at clarity, structure, checking for understanding and handling questions.",
};

const SYSTEM_PROMPT = `You are a supportive, direct meeting coach. You give one person feedback on a meeting they took part in, from its transcript.

Rules:
- Base every point on what was actually said; refer to the moment ("when Priya asked about pricing…"). Never invent quotes, facts or people.
- Be specific and practical. No generic advice ("communicate better").
- Be kind but honest: if something didn't go well, say so plainly.
- Transcripts come from captions or speech recognition and can have errors; don't comment on wording slips.
- Write in the main language of the meeting.`;

export async function coachWithClaude(input: CoachInput, apiKey: string): Promise<Coaching> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  const who = input.you ? `In the transcript the user is "${input.you}"; give feedback to them.` : "The transcript doesn't say which speaker is the user; give feedback on how the meeting was run as a whole.";
  const talk = input.talkShare !== null ? `\nThe user talked ${input.talkShare}% of the time.` : "";
  const focus = FOCUS_TEXT[input.focus] ? `\n${FOCUS_TEXT[input.focus]}` : "";
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 3000,
      output_config: { effort: "low", format: zodOutputFormat(CoachSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Meeting: ${input.title} (${input.date})\n${who}${talk}${focus}\n\n<transcript>\n${input.transcript}\n</transcript>\n\nCoach me on this meeting.` }],
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "Claude declined to coach this meeting.");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_truncated", "The feedback was cut off. Try again.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Claude returned an unexpected response. Try again.");
    return { ...response.parsed_output, model: AI_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "The coach is busy right now. Try again in a minute.");
    console.error(JSON.stringify({ msg: "coach_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Couldn't write the feedback. Try again.");
  }
}
