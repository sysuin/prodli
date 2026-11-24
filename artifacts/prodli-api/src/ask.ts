// Ask ProdLi: questions about the user's own day and data ("what should I do
// next?", "what did we decide in Monday's meeting?"). The app sends the
// question, the last few turns, the same day context as the daily brief, and
// a few snippets from notes and meetings it picked on the device for this
// question. Nothing is stored here except the monthly count (D1 ask_usage).
//
// Answers can suggest actions (add a to-do, plan a task for today, save a
// note); the app only applies them when the user clicks.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AI_MODEL, AiError } from "./ai";
import { BriefContextSchema } from "./brief";

export const ASK_MONTHLY_LIMIT = { free: 100, pro: 500, plus: 1200 } as const;
export const MAX_ASK_CHARS = 80_000;

export const AskInputSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(10).optional(),
  context: BriefContextSchema.optional(),
  snippets: z.array(z.object({ kind: z.enum(["note", "meeting"]), title: z.string().max(300), date: z.string().max(30).optional(), text: z.string().max(3000) })).max(12).optional(),
});
export type AskInput = z.infer<typeof AskInputSchema>;

const AnswerSchema = z.object({
  answer: z.string().describe("The reply, in plain text with short paragraphs or '- ' bullet lines. Concise."),
  actions: z
    .array(
      z.object({
        type: z.enum(["add_task", "plan_today", "add_note"]),
        title: z.string().describe("Task title, existing task title to plan, or note title"),
        details: z.string().describe("Note text or task details; empty string if none"),
      }),
    )
    .describe("Up to 3 helpful one-click actions the user may want, only when clearly useful (e.g. they asked to remember something, or a follow-up task emerged). Empty if none."),
  sources: z.array(z.number().int()).describe("The numbers (n) of the note/meeting snippets the answer used; empty if none"),
});
export type AskAnswer = z.infer<typeof AnswerSchema> & { model: string };

const SYSTEM_PROMPT = `You are ProdLi, a friendly, practical personal assistant inside the user's productivity app. You help them plan and get things done using their own data: tasks, habits, calendar, meeting notes and notes.

Rules:
- Answer from the data provided. If it isn't there, say so briefly and suggest what they could do; never invent tasks, meetings, people, dates or numbers.
- Be concise and concrete: a direct answer first, then at most a few bullets. Use the user's own wording for tasks.
- Times are the user's local time. "Now" is given in the context.
- Suggest actions only when they help (for example "add a task to send the deck"). Never claim you've done something; the user applies actions with a click.
- You can't browse the web or read email; say so if asked.
- In "sources", list the n of each note or meeting snippet you relied on (not the context).`;

export async function askClaude(input: AskInput, apiKey: string): Promise<AskAnswer> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  // Snippets are numbered so the answer can say which ones it used (shown as sources in the app).
  const data = { context: input.context ?? null, snippets: (input.snippets ?? []).map((s, i) => ({ n: i + 1, ...s })) };
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `My data as JSON (for reference in this conversation):\n<data>\n${JSON.stringify(data)}\n</data>` },
    { role: "assistant", content: "Got it. What would you like to know?" },
    ...(input.history ?? []).map((h) => ({ role: h.role, content: h.text }) as Anthropic.MessageParam),
    { role: "user", content: input.question },
  ];
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(AnswerSchema) },
      system: SYSTEM_PROMPT,
      messages,
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "ProdLi can't help with that one.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Something went wrong. Try asking again.");
    const count = input.snippets?.length ?? 0;
    const sources = [...new Set(response.parsed_output.sources ?? [])].filter((n) => n >= 1 && n <= count).slice(0, 8);
    return { ...response.parsed_output, actions: response.parsed_output.actions.slice(0, 3), sources, model: AI_MODEL };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "ProdLi is busy right now. Try again in a minute.");
    console.error(JSON.stringify({ msg: "ask_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Something went wrong. Try asking again.");
  }
}
