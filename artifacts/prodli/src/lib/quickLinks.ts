// Quick links and web search on Today (ProdLi's new tab page). Search goes to
// the user's default engine through Chrome's Search API (store policy: a
// new-tab extension must not change or pick the search engine).

export const MAX_LINKS = 16;

/** "github.com/me" → "https://github.com/me"; null if it isn't a web address. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A short default name: "github.com/me" → "GitHub" style ("Github"). */
export function defaultTitle(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const main = host.split(".").slice(-2, -1)[0] ?? host;
    return main.charAt(0).toUpperCase() + main.slice(1);
  } catch {
    return url;
  }
}

// Endings people type as addresses; anything else ("node.js", "v2.1") is searched, like Chrome's address bar.
const COMMON_TLDS = new Set("com org net io dev app co ai edu gov me info biz xyz tech so in uk us ca au de fr es it nl jp cn br ph sg nz ie ch se no dk fi pl ru za mx ar tv gg ly to fm sh page site blog news cloud".split(" "));

/** Typed text that's clearly an address opens it; anything else is a search. */
export function searchTarget(text: string): { kind: "url"; url: string } | { kind: "search"; text: string } | null {
  const t = text.trim();
  if (!t) return null;
  let looksLikeUrl = false;
  if (!/\s/.test(t)) {
    if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) looksLikeUrl = true;
    else {
      const host = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:\/\S*)?$/i.exec(t)?.[1];
      if (host && COMMON_TLDS.has(host.split(".").pop()!.toLowerCase())) looksLikeUrl = true;
    }
  }
  const url = looksLikeUrl ? normalizeUrl(t) : null;
  return url ? { kind: "url", url } : { kind: "search", text: t };
}

const TILE_COLORS = ["#FFD700", "#FF4FA3", "#00BCD4", "#A78BFA", "#66BB6A", "#FF9800", "#14B8A6", "#F87171"];
export function tileColor(title: string): string {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

export const canSearch = () => typeof chrome !== "undefined" && !!chrome.search?.query;

export async function runSearch(text: string): Promise<void> {
  const target = searchTarget(text);
  if (!target) return;
  if (target.kind === "url") {
    location.href = target.url;
    return;
  }
  await chrome.search.query({ text: target.text, disposition: "CURRENT_TAB" });
}

/** Hidden "Most visited" suggestions (this device). */
export const HIDDEN_SUGGESTIONS_KEY = "quickLinkSuggestionsHidden";
/** "Most visited" suggestions on or off (this device). */
export const SUGGESTIONS_ON_KEY = "quickLinkSuggestions";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/**
 * "Most visited": the sites you spent the most time on (Time Tracker days),
 * minus ones already in your links, excluded sites, ones you hid, and
 * addresses that aren't real sites (localhost, IP addresses).
 */
export function suggestedSites(
  days: Record<string, Record<string, number>>,
  opts: { links: { url: string }[]; excluded?: { has(domain: string): boolean }; hidden?: string[]; max?: number; minSeconds?: number },
): { domain: string; seconds: number }[] {
  const pinned = new Set(opts.links.map((l) => hostOf(l.url)));
  const hidden = new Set((opts.hidden ?? []).map((d) => d.toLowerCase()));
  const totals = new Map<string, number>();
  for (const day of Object.values(days)) {
    for (const [domain, secs] of Object.entries(day ?? {})) {
      if (typeof secs !== "number" || secs <= 0) continue;
      const d = domain.toLowerCase();
      totals.set(d, (totals.get(d) ?? 0) + secs);
    }
  }
  return [...totals]
    .filter(([d, s]) => s >= (opts.minSeconds ?? 300) && !pinned.has(d) && !hidden.has(d) && !opts.excluded?.has(d) && !/^(\d{1,3}\.){3}\d{1,3}$/.test(d) && d !== "localhost" && !d.endsWith(".localhost") && d.includes("."))
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.max ?? 6)
    .map(([domain, seconds]) => ({ domain, seconds }));
}
