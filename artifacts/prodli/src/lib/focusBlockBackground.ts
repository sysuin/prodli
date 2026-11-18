// Background (extension): sends tabs on blocked sites to the pause page.
// Checks a tab when it navigates or becomes active, and the active tabs again
// when blocking turns on (a focus session starts, a schedule begins, settings
// change). Background tabs aren't touched until you switch to them, so a video
// or form you left open isn't lost the moment a session starts.

import { blockingNow, blockReason, DEFAULT_FOCUS_BLOCK, domainOf, FOCUS_BLOCK_KEY, FOCUS_PASSES_KEY, FOCUS_STATS_KEY, pausePageUrl, type FocusBlockSettings } from "./focusBlock";
import { TIMER_KEY, type TimerState } from "./pomodoroCore";
import type { FocusRule, TrackerSettings } from "../types";

const TICK_ALARM = "focusblock_tick";
const LAST_STATE_KEY = "focusBlockLastState";

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function settings(): Promise<FocusBlockSettings> {
  const r = await chrome.storage.local.get(FOCUS_BLOCK_KEY);
  return { ...DEFAULT_FOCUS_BLOCK, ...((r[FOCUS_BLOCK_KEY] as Partial<FocusBlockSettings> | undefined) ?? {}) };
}

async function pomodoroFocus(): Promise<boolean> {
  const r = await chrome.storage.local.get(TIMER_KEY);
  const t = r[TIMER_KEY] as TimerState | undefined;
  return !!t?.running && t.phase === "work" && (t.endsAt === null || t.endsAt > Date.now());
}

/** Time Tracker sites whose daily limit is used up and set to "send me back to ProdLi". */
async function limitsReached(): Promise<string[]> {
  const day = `tt_${dayKey()}`;
  const r = await chrome.storage.local.get(["tt_settings", day]);
  const rules: FocusRule[] = (r.tt_settings as TrackerSettings | undefined)?.focusList ?? [];
  const spent = (r[day] as Record<string, number> | undefined) ?? {};
  return rules.filter((x) => x.redirectEnabled && (spent[x.domain] ?? 0) >= x.limitMinutes * 60).map((x) => x.domain.toLowerCase());
}

async function passes(): Promise<Record<string, number>> {
  try {
    const r = await chrome.storage.session.get(FOCUS_PASSES_KEY);
    return (r[FOCUS_PASSES_KEY] as Record<string, number> | undefined) ?? {};
  } catch {
    return {};
  }
}

async function countBlock(domain: string): Promise<void> {
  const r = await chrome.storage.local.get(FOCUS_STATS_KEY);
  const all = (r[FOCUS_STATS_KEY] as Record<string, Record<string, number>> | undefined) ?? {};
  const today = dayKey();
  const day = { ...(all[today] ?? {}) };
  day[domain] = (day[domain] ?? 0) + 1;
  // Keep two weeks.
  const kept = Object.fromEntries(Object.entries({ ...all, [today]: day }).filter(([d]) => d >= dayKey(new Date(Date.now() - 14 * 86_400_000))));
  await chrome.storage.local.set({ [FOCUS_STATS_KEY]: kept });
}

/** Sends the tab to the pause page if its site is blocked right now. */
export async function checkTab(tabId: number, url: string | undefined): Promise<boolean> {
  const domain = domainOf(url);
  if (!domain || !url) return false;
  const [s, focus, limits, p] = await Promise.all([settings(), pomodoroFocus(), limitsReached(), passes()]);
  const reason = blockReason(domain, s, { pomodoroFocus: focus, limitReached: limits, passes: p });
  if (!reason) return false;
  try {
    await chrome.tabs.update(tabId, { url: pausePageUrl(chrome.runtime.getURL("index.html"), url, reason) });
    await countBlock(domain);
    return true;
  } catch {
    return false; // the tab closed meanwhile
  }
}

async function checkActiveTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true });
  await Promise.all(tabs.map((t) => (t.id !== undefined ? checkTab(t.id, t.url) : Promise.resolve(false))));
}

/** When blocking switches on (session start, schedule start), look at the tabs people are on. */
async function onPossibleChange(): Promise<void> {
  const [s, focus] = await Promise.all([settings(), pomodoroFocus()]);
  const state = blockingNow(s, focus) ?? "off";
  const r = await chrome.storage.session.get(LAST_STATE_KEY).catch(() => ({}) as Record<string, unknown>);
  const last = (r as Record<string, unknown>)[LAST_STATE_KEY];
  if (state !== last) await chrome.storage.session.set({ [LAST_STATE_KEY]: state }).catch(() => {});
  if (state !== "off") await checkActiveTabs();
}

export function registerFocusBlock(): void {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url) void checkTab(tabId, info.url);
    else if (info.status === "loading" && tab.url) void checkTab(tabId, tab.url);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void chrome.tabs.get(tabId).then((t) => checkTab(tabId, t.url), () => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[FOCUS_BLOCK_KEY] || changes[TIMER_KEY])) void onPossibleChange();
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === TICK_ALARM) void onPossibleChange();
  });
  void chrome.alarms.get(TICK_ALARM).then((a) => (a ? undefined : chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 })));
}
