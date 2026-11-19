// AI daily brief: turns the user's day (tasks, calendar, habits, meeting action
// items, yesterday's focus and reflection) into a short plan: headline,
// top priorities, a suggested schedule, watch-outs and a tip.
//
// The app builds the context on the device and sends only what's needed;
// nothing here is stored except the monthly count (D1 brief_usage). The brief
// itself is saved by the app with the day (synced like other data).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { AI_MODEL, AiError } from "./ai";

/** Brief generations per month (UTC): two a day on the free plan. */
export const BRIEF_MONTHLY_LIMIT = { free: 62, pro: 200 } as const;
export const MAX_BRIEF_CONTEXT_CHARS = 40_000;

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

/** What the app sends (validated; long lists are capped). */
export const BriefContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string().max(12),
  now: hhmm,
  workHours: z.object({ start: hhmm, end: hhmm }).optional(),
  focus: z.string().max(300).optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().max(300),
        priority: z.enum(["high", "medium", "low"]).optional(),
        due: z.string().max(10).optional(),
        overdue: z.boolean().optional(),
        planned: z.boolean().optional(),
        estimateMin: z.number().int().min(0).max(1440).optional(),
        openSubtasks: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(80),
  doneYesterday: z.array(z.string().max(300)).max(30).optional(),
  habits: z.array(z.object({ name: z.string().max(120), doneToday: z.boolean(), streak: z.number().int().min(0).max(10000) })).max(40).optional(),
  events: z.array(z.object({ title: z.string().max(300), start: hhmm.optional(), end: hhmm.optional(), allDay: z.boolean().optional() })).max(40).optional(),
  meetingActions: z.array(z.object({ task: z.string().max(300), owner: z.string().max(120).nullable().optional(), due: z.string().max(10).nullable().optional(), meeting: z.string().max(200) })).max(30).optional(),
  meetingPrep: z
    .array(
      z.object({
        event: z.string().max(300),
        start: hhmm.optional(),
        lastMet: z.string().max(30).optional(),
        lastSummary: z.string().max(600).optional(),
        openItems: z.array(z.string().max(300)).max(8),
        relatedTasks: z.array(z.string().max(300)).max(6).optional(),
      }),
    )
    .max(10)
    .optional(),
  yesterday: z
    .object({
      browsingMinutes: z.number().min(0).max(1440).optional(),
      topSites: z.array(z.object({ site: z.string().max(120), minutes: z.number().min(0).max(1440) })).max(5).optional(),
      focusSessions: z.number().int().min(0).max(100).optional(),
      focusScore: z.number().int().min(0).max(100).optional(),
      reflection: z.string().max(1000).optional(),
    })
    .optional(),
});
export type BriefContext = z.infer<typeof BriefContextSchema>;

const BriefSchema = z.object({
  headline: z.string().describe("One upbeat, specific sentence (max 14 words) that frames today"),
  summary: z.string().describe("2–3 sentences: what today looks like and the main thing to get done"),
  priorities: z
    .array(z.object({ title: z.string().describe("A task or outcome, using the user's own wording where possible"), reason: z.string().describe("Why it matters today, one short sentence") }))
    .describe("The 1–3 most important things for today, most important first"),
  schedule: z
    .array(
      z.object({
        start: z.string().describe("HH:MM, 24-hour"),
        end: z.string().describe("HH:MM, 24-hour"),
        title: z.string(),
        kind: z.enum(["meeting", "focus", "task", "break", "habit"]),
      }),
    )
    .describe("A realistic plan from now until the end of the working day: calendar events exactly as given, focus blocks for priorities, short breaks. Empty if there's nothing to schedule."),
  watchouts: z.array(z.string()).describe("Overdue items, conflicts, too much planned for the time available; empty if none"),
  habits: z.array(z.string()).describe("Short nudges for habits not done yet today; empty if none"),
  prep: z
    .array(z.object({ event: z.string().describe("The meeting title (and start time) as given in meetingPrep"), note: z.string().describe("One short sentence: what to follow up on or bring, from last time's summary and open items") }))
    .describe("One entry per meeting in meetingPrep, in time order; empty if meetingPrep is empty"),
  tip: z.string().describe("One practical tip based on yesterday (focus, browsing, reflection), or general if there's no data"),
});
export type Brief = z.infer<typeof BriefSchema> & { model: string; generatedAt: string };

const SYSTEM_PROMPT = `You are ProdLi, a calm, practical personal assistant. Each morning (or when asked) you write the user's daily brief from the data their productivity app gives you.

Rules:
- Use only the data provided. Never invent meetings, tasks, people or deadlines.
- Calendar events are fixed: keep their exact times. Plan focus blocks for the top priorities in the free time, inside working hours, starting from the current time. Add short breaks for long stretches. Don't schedule more than the time available — say so in watchouts instead.
- meetingPrep lists today's meetings with history from earlier meetings: when they last met, last time's summary, action items still open and related to-dos. For each, write one prep note naming the specific open items or questions to follow up on. Don't add prep for meetings not in meetingPrep.
- Prefer tasks the user planned for today, then overdue and due-today tasks, then high priority.
- Be brief and concrete. Use the user's own task wording. No motivational fluff.
- If there's very little data, keep the brief short and suggest one simple way to start the day.`;

export async function generateBrief(ctx: BriefContext, apiKey: string): Promise<Brief> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(BriefSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is my day as JSON:\n<day>\n${JSON.stringify(ctx)}\n</day>\n\nWrite my daily brief.` }],
    });
    if (response.stop_reason === "refusal") throw new AiError("ai_refused", "Claude declined to write this brief.");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_truncated", "The brief was cut off. Try again.");
    if (!response.parsed_output) throw new AiError("ai_failed", "Claude returned an unexpected response. Try again.");
    return { ...response.parsed_output, model: AI_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new AiError("ai_busy", "Briefs are busy right now. Try again in a minute.");
    console.error(JSON.stringify({ msg: "brief_error", status: err instanceof Anthropic.APIError ? err.status : null, type: err instanceof Error ? err.name : "unknown" }));
    throw new AiError("ai_failed", "Couldn't write the brief. Try again.");
  }
}
