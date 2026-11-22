// Voice dictation (Wispr Flow-style): the pure parts — settings, which style a
// website gets, the local clean-up used when AI polish is off or unavailable,
// snippets (say a cue, get saved text), and stats. No Chrome or network APIs.

export type DictationStyle = "formal" | "casual" | "very_casual" | "neutral";
export type SiteCategory = "email" | "work" | "personal" | "other";
export type FieldKind = "email" | "chat" | "document" | "search" | "code" | "other";

export interface Snippet {
  id: string;
  /** What you say ("my calendar link"). */
  cue: string;
  /** What gets typed. */
  text: string;
}

export interface DictationSettings {
  /** AI polish (filler words, self-corrections, punctuation, lists) through the ProdLi account. */
  polish: boolean;
  /** Style per kind of website. */
  styles: Record<SiteCategory, DictationStyle>;
  /** Hold the shortcut: finish when it's released (push-to-talk). Tap: toggle. */
  holdToTalk: boolean;
}

export const DICTATION_SETTINGS_KEY = "dictationSettings";
export const SNIPPETS_KEY = "dictationSnippets";
export const DICTATION_HISTORY_KEY = "dictationHistory";
export const MAX_SNIPPETS = 100;
export const MAX_HISTORY = 50;
/** Longest dictation (minutes). */
export const MAX_DICTATION_MINUTES = 6;

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  polish: true,
  styles: { email: "formal", work: "casual", personal: "very_casual", other: "neutral" },
  holdToTalk: true,
};

export const STYLE_LABELS: Record<DictationStyle, string> = {
  formal: "Formal",
  casual: "Casual",
  very_casual: "Very casual",
  neutral: "As spoken (just clean)",
};
export const CATEGORY_LABELS: Record<SiteCategory, { label: string; examples: string }> = {
  email: { label: "Email", examples: "Gmail, Outlook, Proton, Yahoo" },
  work: { label: "Work chat & tools", examples: "Slack, Teams, Discord, Linear, Notion, Jira, GitHub" },
  personal: { label: "Personal messages", examples: "WhatsApp, Messenger, Telegram, Instagram, X" },
  other: { label: "Everything else", examples: "Docs, forms, search, ProdLi" },
};

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const EMAIL = ["mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.proton.me", "mail.yahoo.com", "app.fastmail.com", "mail.zoho.com", "superhuman.com", "app.hey.com"];
const WORK = ["slack.com", "teams.microsoft.com", "teams.live.com", "discord.com", "linear.app", "notion.so", "atlassian.net", "github.com", "gitlab.com", "asana.com", "trello.com", "clickup.com", "basecamp.com", "figma.com", "miro.com", "chat.google.com", "zoom.us", "webex.com", "monday.com"];
const PERSONAL = ["web.whatsapp.com", "messenger.com", "facebook.com", "web.telegram.org", "instagram.com", "x.com", "twitter.com", "linkedin.com", "reddit.com", "messages.google.com", "threads.net", "bsky.app"];

/** Which kind of website a hostname is, for its dictation style. */
export function siteCategory(hostname: string): SiteCategory {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (EMAIL.some((d) => onHost(h, d))) return "email";
  if (WORK.some((d) => onHost(h, d))) return "work";
  if (PERSONAL.some((d) => onHost(h, d))) return "personal";
  return "other";
}

/** What kind of field the text goes into, from the site and the field itself. */
export function fieldKind(hostname: string, field: { tag: string; type?: string; role?: string | null; multiline: boolean; codeLike?: boolean }): FieldKind {
  if (field.codeLike) return "code";
  if (field.type === "search" || field.role === "searchbox" || field.role === "combobox") return "search";
  const cat = siteCategory(hostname);
  if (cat === "email") return field.multiline ? "email" : "other";
  if (cat === "work" || cat === "personal") return field.multiline || field.tag !== "input" ? "chat" : "other";
  return field.multiline ? "document" : "other";
}

const FILLERS = /\b(?:um+|uh+|erm+|er|ah+|hmm+|mm+)\b[,.]?\s*/gi;
/** Local clean-up (no AI): drop "um"/"uh", double spaces, stuttered words; capitalize the first letter. */
export function cleanLocally(text: string): string {
  let t = text.replace(FILLERS, "");
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, "$1"); // "the the" → "the"
  t = t.replace(/\s+([,.!?;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The snippet whose cue is the whole dictation ("my calendar link"), if any. */
export function wholeSnippet(text: string, snippets: Snippet[]): Snippet | null {
  const t = norm(text);
  return (t && snippets.find((s) => s.text && norm(s.cue) === t)) || null;
}

/**
 * Snippets: if the whole dictation is a cue ("my calendar link"), its text;
 * otherwise each spoken cue inside the dictation is replaced by its text.
 */
export function expandSnippets(text: string, snippets: Snippet[]): { text: string; used: string[] } {
  const valid = snippets.filter((s) => norm(s.cue) && s.text);
  if (!valid.length || !text) return { text, used: [] };
  const whole = valid.find((s) => norm(s.cue) === norm(text));
  if (whole) return { text: whole.text, used: [whole.id] };
  let out = text;
  const used: string[] = [];
  // Longest cues first, so "my work email" wins over "my email".
  for (const s of [...valid].sort((a, b) => b.cue.length - a.cue.length)) {
    const words = norm(s.cue).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${words.join("[^\\p{L}\\p{N}]+")}(?=$|[^\\p{L}\\p{N}])`, "giu");
    if (re.test(out)) {
      out = out.replace(re, (_m, pre: string) => `${pre}${s.text}`);
      used.push(s.id);
    }
  }
  return { text: out, used };
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export interface DictationEntry {
  at: string;
  text: string;
  words: number;
  /** How long you spoke (ms). */
  ms: number;
  site: string;
  mode: "dictate" | "command";
  polished: boolean;
}

/** Words this week and all time, speaking speed, and time saved against typing at 40 wpm. */
export function dictationStats(entries: DictationEntry[], now = new Date()) {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const week = entries.filter((e) => new Date(e.at).getTime() >= weekAgo);
  const words = (list: DictationEntry[]) => list.reduce((n, e) => n + e.words, 0);
  const spokeMs = entries.filter((e) => e.mode === "dictate").reduce((n, e) => n + e.ms, 0);
  const spokenWords = words(entries.filter((e) => e.mode === "dictate"));
  const wpm = spokeMs > 5000 ? Math.round(spokenWords / (spokeMs / 60000)) : null;
  const savedMin = Math.max(0, Math.round(spokenWords / 40 - spokeMs / 60000));
  return { weekWords: words(week), totalWords: words(entries), count: entries.length, wpm, savedMin };
}
