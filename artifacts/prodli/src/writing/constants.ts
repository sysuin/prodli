// Writing check constants, the in-page checker's own copy (it is bundled alone,
// so it can't share a chunk with the rest of the extension). Same as settings.ts;
// a unit test keeps them in step.

import type { IssueType, RewriteAction, WritingSettings } from "./types";

export const WRITING_SETTINGS_KEY = "writingCheck";
export const DEFAULT_WRITING_SETTINGS: WritingSettings = { level: "polish", onDevice: true, everywhere: false, offSites: [], dictionary: [] };
export const MAX_DICTIONARY = 500;

/** Category for colour and wording: mistakes, clearer writing, tone. */
export const ISSUE_GROUP: Record<IssueType, "correct" | "clear" | "tone"> = {
  spelling: "correct",
  grammar: "correct",
  punctuation: "correct",
  word_choice: "clear",
  clarity: "clear",
  tone: "tone",
};
export const ISSUE_LABEL: Record<IssueType, string> = {
  spelling: "Spelling",
  grammar: "Grammar",
  punctuation: "Punctuation",
  word_choice: "Better word",
  clarity: "Clearer",
  tone: "Tone",
};

export const REWRITE_ACTIONS: readonly RewriteAction[] = ["shorter", "clearer", "formal", "friendly"];
export const REWRITE_LABEL: Record<RewriteAction, string> = { shorter: "Shorter", clearer: "Clearer", formal: "More formal", friendly: "Friendlier" };
