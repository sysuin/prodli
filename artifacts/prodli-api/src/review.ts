// AI weekly review: turns the user's week (tasks done and slipped, focus,
// habits, meetings, browsing, daily focus and reflections, their own notes)
// into a short look back and three priorities for next week.
//
// Like the daily brief, the app builds the context on the device; nothing is
// stored here except the monthly count, which is shared with briefs
// (brief_usage). The review is saved by the app with the week (synced).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AI_MODEL, AiError } from "./ai";

export const MAX_REVIEW_CONTEXT_CHARS = 50_000;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priority = z.enum(["high", "medium", "low"]).optional();
const minutes = z.number().min(0).max(10080);

/** What the app sends (validated; long lists are capped). */
export const ReviewContextSchema = z.object({
  weekStart: day,
  weekEnd: day,
  daysSoFar: z.number().int().min(0).max(7),
  done: z.array(z.object({ title: z.string().max(300), day, priority })).max(80),
  slipped: z.array(z.object({ title: z.string().max(300), due: day.optional(), planned: day.optional(), priority })).max(50),
  added: z.number().int().min(0).max(100000),
  perDay: z.array(z.object({ day, done: z.number().int().min(0).max(1000), focusMin: minutes })).max(7),
  habits: z.array(z.object({ name: z.string().max(120), done: z.number().int().min(0).max(7), of: z.number().int().min(0).max(7) })).max(40),
  focus: z.object({ sessions: z.number().int().min(0).max(1000), minutes }),
  browsing: z.object({
    minutes,
    topSites: z.array(z.object({ site: z.string().max(120), minutes })).max(5),
    focusScore: z.number().int().min(0).max(100).optional(),
    categories: z.array(z.object({ category: z.string().max(40), minutes })).max(12).optional(),
  }),
  meetings: z.object({ count: z.number().int().min(0).max(500), minutes, titles: z.array(z.string().max(200)).max(20), openActions: z.array(z.string().max(300)).max(20) }),
  notes: z.object({ created: z.number().int().min(0).max(100000), edited: z.number().int().min(0).max(100000) }),
  focuses: z.array(z.object({ day, text: z.string().max(300) })).max(7),
  reflections: z.array(z.object({ day, text: z.string().max(1000) })).max(7),
  userNote: z.string().max(1600).optional(),
});
export type ReviewContext = z.infer<typeof ReviewContextSchema>;

const ReviewSchema = z.object({
  headline: z.string().describe("One honest, specific sentence (max 14 words) that sums up the week"),
  summary: z.string().describe("2–3 sentences: how the week went overall, using the numbers"),
  wins: z.array(z.string()).describe("1–4 concrete wins from the data (finished tasks, streaks, focus); empty if none"),
  slipped: z.array(z.object({ title: z.string().describe("The slipped task, in the user's wording"), suggestion: z.string().describe("One short, practical suggestion: plan it, break it down, delegate or drop it") })).describe("Up to 4 of the most important slipped tasks; empty if none"),
  patterns: z.array(z.string()).describe("1–3 observations about how the week went (best day, focus vs. browsing, meetings load, habits), only if the data supports them"),
  nextWeek: z.array(z.object({ title: z.string().describe("A task or outcome for next week, using the user's wording where possible"), reason: z.string().describe("Why, one short sentence") })).describe("The 3 most important things for next week, most important first"),
  habitTip: z.string().describe("One short tip about the habit that was hardest to keep; empty string if there are no habits"),
  question: z.string().describe("One short reflective question for the user about next week"),
});
export type Review = z.infer<typeof ReviewSchema> & { model: string; generatedAt: string };

const SYSTEM_PROMPT = `You are ProdLi, a calm, practical personal assistant. At the end of each week you write the user's weekly review from the data their productivity app gives you.

Rules:
- Use only the data provided. Never invent tasks, meetings, numbers or people.
- If the week isn't over yet (daysSoFar < 7), say "so far" where it matters.
- Be honest but kind: celebrate real wins, name what slipped without judgement.
- Next week's priorities should come from slipped high-priority tasks, open meeting action items, the user's daily focus statements and their own notes. Use their wording.
- browsing.focusScore is the share of productive time out of productive + distracting browsing (0–100); browsing.categories splits browsing time (e.g. "AI tools", "Social media"). Mention them in patterns only when notable.
- Take the user's own notes on the week seriously; they explain what the numbers can't.
- Be brief and concrete. No motivational fluff.
- If there's very little data, keep it short and suggest one simple habit for tracking next week.`;

export async function generateReview(ctx: ReviewContext, apiKey: string): Promise<Review> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(ReviewSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is my week as JSON:\n<week>\n${JSON.stringify(ctx)}\n</week>\n\nWrite my weekly review.` }],
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "Claude declined to write this review.");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_truncated", "The review was cut off. Try again.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Claude returned an unexpected response. Try again.");
    return { ...response.parsed_output, model: AI_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "Reviews are busy right now. Try again in a minute.");
    console.error(JSON.stringify({ msg: "review_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Couldn't write the review. Try again.");
  }
}
