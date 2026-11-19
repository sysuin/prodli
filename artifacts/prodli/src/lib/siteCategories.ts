// Site categories and the daily focus score (Time Tracker, Today's brief and the
// weekly review). Sites are put in a category by a built-in list of well-known
// sites, which the user can change per site; everything happens on this device.
//
// Focus score: the share of time on productive sites out of productive plus
// distracting time (neutral sites such as email don't count either way), shown
// once there are at least 10 minutes of either.

export type CategoryId = "work" | "learning" | "ai" | "communication" | "social" | "video" | "news" | "shopping" | "other";
export type CategoryKind = "productive" | "neutral" | "distracting";

export const CATEGORIES: { id: CategoryId; label: string; emoji: string; kind: CategoryKind }[] = [
  { id: "work", label: "Work & tools", emoji: "💼", kind: "productive" },
  { id: "learning", label: "Learning", emoji: "📚", kind: "productive" },
  { id: "ai", label: "AI tools", emoji: "🤖", kind: "productive" },
  { id: "communication", label: "Email & chat", emoji: "💬", kind: "neutral" },
  { id: "other", label: "Other", emoji: "🌐", kind: "neutral" },
  { id: "news", label: "News", emoji: "📰", kind: "distracting" },
  { id: "social", label: "Social media", emoji: "📱", kind: "distracting" },
  { id: "video", label: "Video & games", emoji: "🎬", kind: "distracting" },
  { id: "shopping", label: "Shopping", emoji: "🛒", kind: "distracting" },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, (typeof CATEGORIES)[number]>;
export const KIND_LABEL: Record<CategoryKind, string> = { productive: "Productive", neutral: "Neutral", distracting: "Distracting" };

/** The user's choices: domain → category (local, backed up with settings). */
export const SITE_CATEGORIES_KEY = "siteCategories";
export const MIN_SCORED_SECONDS = 600;

const list = (category: CategoryId, domains: string) => domains.split(/\s+/).filter(Boolean).map((d) => [d, category] as const);

/** Well-known sites. More specific entries (docs.google.com) win over their parent (google.com). */
export const BUILTIN: Record<string, CategoryId> = Object.fromEntries([
  ...list("work", "docs.google.com sheets.google.com slides.google.com drive.google.com calendar.google.com github.com gitlab.com bitbucket.org notion.so notion.site figma.com miro.com atlassian.net atlassian.com jira.com trello.com asana.com linear.app clickup.com monday.com airtable.com office.com sharepoint.com onedrive.live.com dropbox.com canva.com vercel.com netlify.com cloudflare.com dash.cloudflare.com console.aws.amazon.com cloud.google.com portal.azure.com stackoverflow.com stackexchange.com developer.mozilla.org npmjs.com localhost codepen.io codesandbox.io replit.com overleaf.com salesforce.com hubspot.com zendesk.com intercom.com webflow.com framer.com prodli.com app.prodli.com"),
  ...list("learning", "wikipedia.org coursera.org udemy.com edx.org khanacademy.org duolingo.com brilliant.org scholar.google.com arxiv.org medium.com dev.to freecodecamp.org leetcode.com w3schools.com britannica.com quizlet.com skillshare.com pluralsight.com"),
  ...list("ai", "chatgpt.com chat.openai.com openai.com claude.ai gemini.google.com aistudio.google.com notebooklm.google.com perplexity.ai copilot.microsoft.com poe.com deepseek.com chat.deepseek.com grok.com mistral.ai chat.mistral.ai huggingface.co character.ai you.com phind.com"),
  ...list("communication", "mail.google.com gmail.com outlook.com outlook.live.com outlook.office.com mail.yahoo.com proton.me slack.com app.slack.com teams.microsoft.com teams.live.com discord.com web.whatsapp.com whatsapp.com messenger.com telegram.org web.telegram.org zoom.us meet.google.com chat.google.com"),
  ...list("social", "facebook.com instagram.com x.com twitter.com tiktok.com reddit.com linkedin.com threads.net bsky.app pinterest.com snapchat.com tumblr.com quora.com 9gag.com mastodon.social"),
  ...list("video", "youtube.com netflix.com twitch.tv primevideo.com hulu.com disneyplus.com max.com hbomax.com vimeo.com dailymotion.com crunchyroll.com spotify.com open.spotify.com music.youtube.com steampowered.com store.steampowered.com roblox.com chess.com hotstar.com jiocinema.com"),
  ...list("news", "news.google.com nytimes.com bbc.com bbc.co.uk cnn.com theguardian.com washingtonpost.com reuters.com bloomberg.com wsj.com ft.com apnews.com foxnews.com nbcnews.com news.ycombinator.com theverge.com techcrunch.com timesofindia.indiatimes.com indiatimes.com ndtv.com hindustantimes.com aljazeera.com"),
  ...list("shopping", "amazon.com amazon.in amazon.co.uk ebay.com etsy.com walmart.com target.com aliexpress.com temu.com shein.com flipkart.com myntra.com bestbuy.com ikea.com"),
]);

/** "www.News.Google.com" → "news.google.com". */
export function cleanDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** The domain and its parents, most specific first: a.b.c.com → a.b.c.com, b.c.com, c.com. */
function chain(domain: string): string[] {
  const parts = cleanDomain(domain).split(".");
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1 || (i === 0 && parts.length === 1); i++) out.push(parts.slice(i).join("."));
  return out;
}

const isCategory = (v: unknown): v is CategoryId => typeof v === "string" && v in CATEGORY;

/** A site's category: the user's choice, then the built-in list, else Other. */
export function categoryOf(domain: string, overrides: Record<string, string> = {}): CategoryId {
  const links = chain(domain);
  for (const d of links) if (isCategory(overrides[d])) return overrides[d] as CategoryId;
  for (const d of links) if (BUILTIN[d]) return BUILTIN[d];
  return "other";
}

export const kindOf = (domain: string, overrides?: Record<string, string>): CategoryKind => CATEGORY[categoryOf(domain, overrides)].kind;

export interface Breakdown {
  total: number;
  byKind: Record<CategoryKind, number>;
  /** Seconds per category, biggest first (empty ones left out). */
  byCategory: { id: CategoryId; seconds: number }[];
}

/** Pure: seconds per kind and per category for one day (or several added up). */
export function breakdown(day: Record<string, number> | undefined, overrides: Record<string, string> = {}, excluded: Set<string> = new Set()): Breakdown {
  const byKind: Record<CategoryKind, number> = { productive: 0, neutral: 0, distracting: 0 };
  const cats: Partial<Record<CategoryId, number>> = {};
  let total = 0;
  for (const [domain, secs] of Object.entries(day ?? {})) {
    if (!secs || excluded.has(domain.toLowerCase())) continue;
    const id = categoryOf(domain, overrides);
    cats[id] = (cats[id] ?? 0) + secs;
    byKind[CATEGORY[id].kind] += secs;
    total += secs;
  }
  const byCategory = (Object.entries(cats) as [CategoryId, number][]).map(([id, seconds]) => ({ id, seconds })).sort((a, b) => b.seconds - a.seconds);
  return { total, byKind, byCategory };
}

/** 0–100, or null with too little productive or distracting time to judge. */
export function focusScore(b: Pick<Breakdown, "byKind">): number | null {
  const judged = b.byKind.productive + b.byKind.distracting;
  return judged >= MIN_SCORED_SECONDS ? Math.round((100 * b.byKind.productive) / judged) : null;
}

export function scoreLabel(score: number): string {
  return score >= 75 ? "Focused" : score >= 50 ? "Mixed" : "Distracted";
}

/** Adds up several days of tracking. */
export function sumDays(days: (Record<string, number> | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d ?? {})) out[k] = (out[k] ?? 0) + (v || 0);
  return out;
}
