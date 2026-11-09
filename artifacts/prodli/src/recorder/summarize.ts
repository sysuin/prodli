// Turns a meeting transcript into a summary, decisions and action items with
// Claude — with the user's own API key if they saved one, otherwise through
// their ProdLi account (ProdLi's key, a free monthly allowance; see
// artifacts/prodli-api/src/ai.ts, which uses the same prompt and output shape).
//
// Model choice: Claude Haiku 5.5 — the lowest-cost Claude model ($0.10 / $0.50
// per million input / output tokens for prompts up to 100K tokens), run at low
// effort. A one-hour meeting transcript is roughly 10–15K tokens, so a summary
// costs well under one US cent.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { SUMMARY_MODEL, transcriptToText } from "./format";
import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "../lib/prodliAccount";
import type { Meeting, MeetingSummary } from "./types";


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

const SYSTEM_PROMPT = `You turn meeting transcripts into concise, accurate meeting notes.

The transcript comes from live captions, so expect missing punctuation, misheard words and speaker labels such as "You" (the person who recorded the meeting). Fix obvious caption errors silently, but never invent facts, names, numbers or commitments that are not in the transcript. If the transcript is short or unclear, keep the notes short rather than padding them.

Only list an action item when someone committed to doing something or a task was clearly assigned. Write every field in the main language of the meeting.`;

export class SummarizeError extends Error {}

export async function summarizeMeeting(meeting: Meeting, apiKey: string): Promise<MeetingSummary> {
  if (!apiKey) throw new SummarizeError("Add your Claude API key in Meetings → Setup to generate summaries.");
  if (meeting.transcript.length === 0) throw new SummarizeError("There is no transcript to summarize.");

  // The key belongs to the user and is only ever sent to api.anthropic.com.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const today = new Date(meeting.startedAt).toISOString().slice(0, 10);

  try {
    const response = await client.messages.parse({
      model: SUMMARY_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(SummarySchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Meeting date: ${today}\nMeeting name: ${meeting.title}\n\n<transcript>\n${transcriptToText(meeting.transcript)}\n</transcript>\n\nWrite the meeting notes.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new SummarizeError("Claude declined to summarize this meeting.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new SummarizeError("The summary was cut off. Try again.");
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new SummarizeError("Claude returned an unexpected response. Try again.");

    return { ...parsed, model: SUMMARY_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof SummarizeError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new SummarizeError("Your Claude API key was rejected. Check it in Meetings → Setup.");
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new SummarizeError("Your Claude API key doesn't have access to this model.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new SummarizeError("Claude rate limit reached. Wait a minute and try again.");
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new SummarizeError(`Claude couldn't process the request: ${err.message}`);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new SummarizeError("Couldn't reach Claude. Check your internet connection and try again.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new SummarizeError(`Claude API error (${err.status ?? "unknown"}). Try again.`);
    }
    throw new SummarizeError(err instanceof Error ? err.message : "Summarizing failed.");
  }
}

/** Summary through the user's ProdLi account (no API key needed; monthly allowance). */
export async function summarizeViaProdli(meeting: Meeting): Promise<MeetingSummary> {
  if (meeting.transcript.length === 0) throw new SummarizeError("There is no transcript to summarize.");
  try {
    const r = await accountRequest<{ summary: MeetingSummary }>("/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({ title: meeting.title, date: new Date(meeting.startedAt).toISOString().slice(0, 10), transcript: transcriptToText(meeting.transcript) }),
    });
    return r.summary;
  } catch (err) {
    throw new SummarizeError(err instanceof AccountError ? err.message : "Summarizing failed.");
  }
}

/** Can this device summarize without a key? (signed in to a ProdLi account) */
export async function canUseProdliAi(): Promise<boolean> {
  return accountsEnabled() && !!(await getProdliAccount());
}

/** Own key if there is one (direct to Anthropic, unlimited), otherwise the ProdLi account. */
export async function summarizeAny(meeting: Meeting, apiKey: string): Promise<MeetingSummary> {
  if (apiKey) return summarizeMeeting(meeting, apiKey);
  if (await canUseProdliAi()) return summarizeViaProdli(meeting);
  throw new SummarizeError(
    accountsEnabled()
      ? "Sign in to your ProdLi account for free summaries, or add your own Claude API key in Meetings → Setup."
      : "Add your Claude API key in Meetings → Setup to generate summaries.",
  );
}
