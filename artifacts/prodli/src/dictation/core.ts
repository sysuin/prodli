// Voice dictation (Wispr Flow-style): the pure parts — settings, which style a
// website gets, the local clean-up used when AI polish is off or unavailable,
// snippets (say a cue, get saved text), and stats. No Chrome or network APIs.

export type DictationStyle = "formal" | "casual" | "very_casual" | "excited" | "neutral";
/** How much the clean-up changes: none (only "um"s, on this device), light (AI: fillers, corrections, punctuation), concise (AI: also tightens rambling). */
export type CleanupLevel = "none" | "light" | "concise";
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
  /** AI polish (filler words, self-corrections, punctuation, lists) through the ProdLi account. Kept for older settings; `cleanup` decides. */
  polish: boolean;
  /** How much the clean-up changes the words (see cleanupLevel()). */
  cleanup?: CleanupLevel;
  /** Add words to the dictionary when you correct them right after dictating. */
  learnWords?: boolean;
  /** Keep the text of past dictations on this device (off: only the counts for stats). */
  keepHistory?: boolean;
  /** Style per kind of website. */
  styles: Record<SiteCategory, DictationStyle>;
  /** Hold the shortcut: finish when it's released (push-to-talk). Tap: toggle. */
  holdToTalk: boolean;
}

export const DICTATION_SETTINGS_KEY = "dictationSettings";
export const SNIPPETS_KEY = "dictationSnippets";
export const DICTATION_HISTORY_KEY = "dictationHistory";
/** Days you dictated (YYYY-MM-DD, newest first), for the streak. */
export const DICTATION_DAYS_KEY = "dictationDays";
export const MAX_SNIPPETS = 100;
export const MAX_HISTORY = 50;
/** Longest dictation (minutes). */
export const MAX_DICTATION_MINUTES = 6;

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  polish: true,
  // No `cleanup` here: older settings with AI polish off must still read as "none" (cleanupLevel()).
  learnWords: true,
  keepHistory: true,
  styles: { email: "formal", work: "casual", personal: "very_casual", other: "neutral" },
  holdToTalk: true,
};

export const STYLE_LABELS: Record<DictationStyle, string> = {
  formal: "Formal",
  casual: "Casual",
  very_casual: "Very casual",
  excited: "Excited!",
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

// Desktop app: dictation into any app picks the style from the app in front.
const APP_EMAIL = /\b(mail|outlook|spark|airmail|thunderbird|superhuman|mimestream|hey|proton mail|canary)\b/i;
const APP_WORK = /\b(slack|teams|discord|zoom|webex|linear|notion|jira|confluence|asana|clickup|trello|basecamp|figma|miro|github|gitlab|monday)\b/i;
const APP_PERSONAL = /\b(whatsapp|messages|messenger|telegram|signal|imessage|instagram|facetime|line|viber|wechat)\b/i;
const APP_CODE = /\b(code|cursor|xcode|intellij|pycharm|webstorm|android studio|terminal|iterm2?|warp|powershell|command prompt|windows terminal|sublime text|vim|zed)\b/i;

/** Which kind of app (by its name, e.g. "Slack", "Microsoft Outlook") the text goes into. */
export function appCategory(appName: string): SiteCategory {
  const n = appName.trim();
  if (!n) return "other";
  if (APP_EMAIL.test(n)) return "email";
  if (APP_WORK.test(n)) return "work";
  if (APP_PERSONAL.test(n)) return "personal";
  return "other";
}

/** The field kind for an app: email apps write emails, chat apps messages, editors and terminals code. */
export function appFieldKind(appName: string): FieldKind {
  if (APP_CODE.test(appName)) return "code";
  const c = appCategory(appName);
  return c === "email" ? "email" : c === "work" || c === "personal" ? "chat" : "other";
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

/** The clean-up level, from the setting or (older settings) the AI polish switch. */
export function cleanupLevel(s: Pick<DictationSettings, "polish" | "cleanup">): CleanupLevel {
  return s.cleanup ?? (s.polish === false ? "none" : "light");
}

export const CLEANUP_LABELS: Record<CleanupLevel, { label: string; detail: string }> = {
  none: { label: "None", detail: "Your words as heard; only “um”s and repeats go (on this device)." },
  light: { label: "Light", detail: "Removes fillers and false starts, applies corrections (“Tuesday, no, Wednesday”), adds punctuation and lists." },
  concise: { label: "Concise", detail: "Light, plus tighter wording: cuts rambling and repetition, keeps every fact." },
};

/** Today's date (local) as YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Adds today to the list of days you dictated (newest first, at most a year and a bit). */
export function addDay(days: string[], now = new Date()): string[] {
  const today = dayKey(now);
  return days[0] === today ? days : [today, ...days.filter((d) => d !== today)].slice(0, 400);
}

/** Days in a row you dictated, ending today (or yesterday, so a streak isn't lost before you've dictated today). */
export function streakDays(days: string[], now = new Date()): number {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
