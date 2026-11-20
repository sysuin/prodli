// Turns a meeting transcript into a summary, decisions and action items with
// Claude, through the user's ProdLi account (ProdLi's own key and a free
// monthly allowance; see artifacts/prodli-api/src/ai.ts). Users never need
// their own API key.

import { transcriptToText } from "./format";
import { momentsForSummary } from "../lib/moments";
import { accountRequest, accountsEnabled, getProdliAccount, AccountError } from "../lib/prodliAccount";
import { storageGet } from "../lib/storage";
import { CUSTOM_TEMPLATES_STORAGE_KEY, isCustomRef, MEETING_TEMPLATE_STORAGE_KEY, SUMMARY_LANGUAGE_STORAGE_KEY, VOCABULARY_STORAGE_KEY, type CustomMeetingTemplate, type CustomTemplateRef, type MeetingTemplate } from "./types";
import type { Meeting, MeetingSummary } from "./types";

export class SummarizeError extends Error {}

/** Can this device get AI summaries? (signed in to a ProdLi account) */
export async function canUseProdliAi(): Promise<boolean> {
  return accountsEnabled() && !!(await getProdliAccount());
}

export const SIGN_IN_FOR_SUMMARIES = "Sign in to your ProdLi account (👤, free) to get AI summaries of your meetings.";

/** Summary through the user's ProdLi account. */
export async function summarizeMeeting(meeting: Meeting): Promise<MeetingSummary> {
  if (meeting.transcript.length === 0) throw new SummarizeError("There is no transcript to summarize.");
  if (!(await canUseProdliAi())) throw new SummarizeError(accountsEnabled() ? SIGN_IN_FOR_SUMMARIES : "AI summaries aren't available in this copy of ProdLi.");
  const [defaultTemplate, glossary, customs, language] = await Promise.all([
    storageGet<MeetingTemplate | CustomTemplateRef>(MEETING_TEMPLATE_STORAGE_KEY, "general"),
    storageGet<string[]>(VOCABULARY_STORAGE_KEY, []),
    storageGet<CustomMeetingTemplate[]>(CUSTOM_TEMPLATES_STORAGE_KEY, []),
    storageGet<string>(SUMMARY_LANGUAGE_STORAGE_KEY, ""),
  ]);
  const chosen = meeting.template ?? defaultTemplate;
  // Your own template (Pro), if it still exists; otherwise the general notes.
  const custom = isCustomRef(chosen) ? customs.find((c) => `custom:${c.id}` === chosen) : undefined;
  const template = isCustomRef(chosen) ? "general" : chosen;
  // Marked moments (Pro; the server leaves them out without Pro).
  const moments = momentsForSummary(meeting.transcript, meeting.marks);
  try {
    const r = await accountRequest<{ summary: MeetingSummary }>("/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({
        title: meeting.title,
        date: new Date(meeting.startedAt).toISOString().slice(0, 10),
        transcript: transcriptToText(meeting.transcript),
        ...(template !== "general" ? { template } : {}),
        ...(glossary.length ? { glossary } : {}),
        ...(custom ? { custom: { name: custom.name, instructions: custom.instructions, sections: custom.sections } } : {}),
        ...(language ? { language } : {}),
        ...(moments.length ? { moments } : {}),
      }),
    });
    return r.summary;
  } catch (err) {
    throw new SummarizeError(err instanceof AccountError ? err.message : "Summarizing failed.");
  }
}
