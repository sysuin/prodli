// "Pick the meeting type from its name" (Pro): rules like "title has interview,
// screening → Interview". When a meeting has no type of its own, the first rule
// whose words appear in its name sets the type for its summary
// (recorder/summarize.ts). Stored on this device (TEMPLATE_RULES_STORAGE_KEY).

import type { CustomTemplateRef, MeetingTemplate } from "../recorder/types";

export interface TemplateRule {
  id: string;
  /** Comma-separated words or phrases, any of which in the meeting's name is a match. */
  match: string;
  template: MeetingTemplate | CustomTemplateRef;
}

export const TEMPLATE_RULES_STORAGE_KEY = "meetingTemplateRules";
export const MAX_RULES = 20;

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The words of a rule ("Interview, phone screen" → ["interview", "phone screen"]). */
export function ruleWords(match: string): string[] {
  return [...new Set(match.split(",").map((w) => norm(w).trim()).filter(Boolean))];
}

/** The type the first matching rule gives a meeting named `title`, or undefined. Whole words only. */
export function ruleTemplate(title: string, rules: TemplateRule[]): TemplateRule["template"] | undefined {
  const t = norm(title);
  return rules.find((r) => ruleWords(r.match).some((w) => t.includes(` ${w} `)))?.template;
}
