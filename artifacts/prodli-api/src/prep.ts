// "✨ Prep with AI" on Today's meeting prep (Pro): a short brief for one
// upcoming meeting, written from what ProdLi knows about earlier meetings with
// the same people (their summaries, open items, open questions) and related
// to-dos. The app sends only that; nothing is stored here except the count
// (it uses the monthly briefs allowance, brief_usage).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AI_MODEL, AiError } from "./ai";

export const MAX_PREP_CHARS = 30_000;
const line = (n: number) => z.string().max(n);

export const PrepInputSchema = z.object({
  event: z.object({ title: line(300), start: z.string().regex(/^\d{2}:\d{2}$/).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  history: z
    .array(
      z.object({
        title: line(300),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        overview: line(2000),
        decisions: z.array(line(400)).max(10),
        openItems: z.array(z.object({ task: line(300), owner: line(120).nullable() })).max(15),
        openQuestions: z.array(line(400)).max(10),
      }),
    )
    .min(1)
    .max(5),
  relatedTasks: z.array(line(300)).max(10).default([]),
});
export type PrepInput = z.infer<typeof PrepInputSchema>;

const PrepSchema = z.object({
  goal: z.string().describe("One sentence: what this meeting should achieve, based on the history"),
  recap: z.string().describe("2–3 sentences: where things stand since last time"),
  followUps: z.array(z.string()).describe("Open items and commitments to check on, naming owners where given; empty if none"),
  questions: z.array(z.string()).describe("2–4 questions worth asking, from open questions and gaps in the history"),
  agenda: z.array(z.string()).describe("A short suggested agenda, 3–5 items"),
});
export type Prep = z.infer<typeof PrepSchema> & { model: string; generatedAt: string };

const SYSTEM_PROMPT = `You help someone prepare for a meeting, using notes from their earlier meetings with the same people.

Rules:
- Use only the information provided. Never invent facts, numbers, people or commitments.
- Be brief and concrete; use the people's and tasks' own wording.
- If the history is thin, keep the brief short rather than padding it.`;

export async function prepWithClaude(input: PrepInput, apiKey: string): Promise<Prep> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 3000,
      output_config: { effort: "low", format: zodOutputFormat(PrepSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Upcoming meeting and history as JSON:\n<prep>\n${JSON.stringify(input)}\n</prep>\n\nWrite my prep brief.` }],
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "Claude declined to write this prep.");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_truncated", "The prep was cut off. Try again.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Claude returned an unexpected response. Try again.");
    return { ...response.parsed_output, model: AI_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "Prep is busy right now. Try again in a minute.");
    console.error(JSON.stringify({ msg: "prep_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Couldn't write the prep. Try again.");
  }
}
