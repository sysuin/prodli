// Saved tabs: save the current window's tabs (optionally closing them, like
// OneTab) and reopen them later from the new tab. Stored as the synced
// "tabSessions" collection, so they're backed up and on your other computers.
// Uses the `tabs` permission ProdLi already has; no favicons are loaded from
// other sites (the page shows site names instead).

import { storageGet, storageSet } from "./storage";
import type { TabSession } from "../types";

export const MAX_TABS = 100;

export const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.tabs?.query;

const keepable = (url: string | undefined) => !!url && /^https?:\/\//.test(url);

export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "Wed 18 Nov, 3:12 PM" */
export function defaultSessionName(now = new Date()): string {
  return now.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** The tabs worth saving from a list of Chrome tabs (web pages only, no duplicates, at most 100). */
export function pickTabs(tabs: { url?: string; title?: string; pinned?: boolean }[]): { url: string; title: string }[] {
  const seen = new Set<string>();
  const out: { url: string; title: string }[] = [];
  for (const t of tabs) {
    if (!keepable(t.url) || seen.has(t.url!)) continue;
    seen.add(t.url!);
    out.push({ url: t.url!, title: (t.title || siteName(t.url!)).slice(0, 200) });
    if (out.length >= MAX_TABS) break;
  }
  return out;
}

/**
 * Saves this window's web tabs as a session. With `close`, closes the saved
 * tabs afterwards (pinned tabs and the ProdLi tab itself stay).
 */
export async function captureWindow(name: string, close: boolean, now = new Date()): Promise<{ session: TabSession; closed: number } | null> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const picked = pickTabs(tabs);
  if (!picked.length) return null;
  const stamp = now.toISOString();
  const session: TabSession = { id: `ts-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 80) || defaultSessionName(now), tabs: picked, createdAt: stamp, updatedAt: stamp };
  let closed = 0;
  if (close) {
    const self = await chrome.tabs.getCurrent().catch(() => undefined);
    const urls = new Set(picked.map((p) => p.url));
    const ids = tabs.filter((t) => t.id !== undefined && t.id !== self?.id && !t.pinned && t.url && urls.has(t.url)).map((t) => t.id!);
    if (ids.length) {
      await chrome.tabs.remove(ids);
      closed = ids.length;
    }
  }
  return { session, closed };
}

/** Opens all of a session's tabs in a new window. */
export async function openSession(s: TabSession): Promise<void> {
  const urls = s.tabs.map((t) => t.url).filter(keepable);
  if (!urls.length) return;
  if (isExtension() && chrome.windows?.create) await chrome.windows.create({ url: urls, focused: true });
  else for (const u of urls) window.open(u, "_blank", "noopener,noreferrer");
}

export async function openTab(url: string): Promise<void> {
  if (!keepable(url)) return;
  if (isExtension()) await chrome.tabs.create({ url, active: true });
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Saves and closes this window's tabs from anywhere (⌘K). Returns a message to show. */
export async function saveAndCloseWindow(): Promise<string> {
  if (!isExtension()) return "Saving tabs works in the ProdLi extension.";
  const r = await captureWindow(defaultSessionName(), true);
  if (!r) return "No web pages open in this window to save.";
  const sessions = await storageGet<TabSession[]>("tabSessions", []);
  await storageSet("tabSessions", [r.session, ...sessions]);
  return `Saved ${r.session.tabs.length} tab${r.session.tabs.length > 1 ? "s" : ""} (Today → Saved tabs)`;
}
