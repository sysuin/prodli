// ProdLi Time Tracker — Background Service Worker (MV3)
// Tracks active browsing time per domain and stores it in chrome.storage.local.

import type { TrackerSettings, FocusRule } from "./types";
import { registerRecorder } from "./recorder/controller";
import { registerPomodoro } from "./lib/pomodoroBackground";
import { registerDriveBackup } from "./lib/driveBackground";

// Meeting recorder (toolbar icon / Alt+Shift+R on a Google Meet tab).
registerRecorder();
// Pomodoro: finishes phases and notifies even when no ProdLi tab is open.
registerPomodoro();
// Google Drive: daily backup while signed in (no-op otherwise).
registerDriveBackup();

const DEFAULT_SETTINGS: TrackerSettings = {
  idleThreshold: 60,
  notifyEnabled: true,
  notifyTime: "20:00",
  focusList: [],
  excludedDomains: [],
};

// ── Session state ─────────────────────────────────────────────────────────────
// Chrome stops this service worker after ~30 s of inactivity, wiping memory.
// The current session is mirrored to chrome.storage.session so tracking
// continues after a restart (otherwise a long stay on one site stopped
// counting until the next tab switch).
let currentDomain: string | null = null;
let sessionStartMs: number | null = null;
let restored = false;
const SESSION_KEY = "tt_session";

async function restoreSession(): Promise<void> {
  if (restored) return;
  restored = true;
  if (currentDomain) return;
  try {
    const r = await chrome.storage.session.get(SESSION_KEY);
    const saved = r[SESSION_KEY] as { domain: string; start: number } | undefined;
    if (saved?.domain && saved.start) {
      currentDomain = saved.domain;
      sessionStartMs = saved.start;
    }
  } catch {
    // storage.session unavailable — start fresh
  }
}

function persistSession(): void {
  const value = currentDomain && sessionStartMs ? { domain: currentDomain, start: sessionStartMs } : null;
  const p = value ? chrome.storage.session.set({ [SESSION_KEY]: value }) : chrome.storage.session.remove(SESSION_KEY);
  p.catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function extractDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function isTrackable(url: string | undefined): boolean {
  return !!url && (url.startsWith("http://") || url.startsWith("https://"));
}

function isExcludedDomain(domain: string, settings: TrackerSettings): boolean {
  const list = settings.excludedDomains ?? [];
  return list.some((d) => d.toLowerCase() === domain.toLowerCase());
}

async function getSettings(): Promise<TrackerSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tt_settings"], (result) => {
      const stored = result["tt_settings"] as Partial<TrackerSettings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...(stored ?? {}) });
    });
  });
}

async function getActiveTabUrl(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url;
  } catch {
    return undefined;
  }
}

// ── Session management ────────────────────────────────────────────────────────

function startSession(domain: string): void {
  currentDomain = domain;
  sessionStartMs = Date.now();
  persistSession();
}

async function flushAndEnd(endMs: number = Date.now()): Promise<string | null> {
  await restoreSession();
  if (!currentDomain || !sessionStartMs) return null;
  const flushedDomain = currentDomain;
  const elapsed = Math.round((endMs - sessionStartMs) / 1000);
  if (elapsed > 0 && elapsed < 3600) {
    const date = new Date(sessionStartMs);
    const dayKey = `tt_${getDayKey(date)}`;
    const result = await chrome.storage.local.get([dayKey]);
    const data: Record<string, number> = (result[dayKey] as Record<string, number>) ?? {};
    data[flushedDomain] = (data[flushedDomain] ?? 0) + elapsed;
    await chrome.storage.local.set({ [dayKey]: data });
  }
  currentDomain = null;
  sessionStartMs = null;
  persistSession();
  return flushedDomain;
}

async function refreshSession(isIdle: boolean): Promise<void> {
  await restoreSession();
  const url = await getActiveTabUrl();
  const domain = isTrackable(url) ? extractDomain(url) : null;
  if (!domain || isIdle) {
    await flushAndEnd();
    return;
  }
  const settings = await getSettings();
  if (isExcludedDomain(domain, settings)) {
    await flushAndEnd();
    return;
  }
  if (domain !== currentDomain) {
    await flushAndEnd();
    startSession(domain);
    await checkFocusLimit(domain);
  }
  // Same domain → session continues
}

// ── Focus limit checking ──────────────────────────────────────────────────────

async function checkFocusLimit(domain: string): Promise<void> {
  const today = getDayKey();
  const notifiedKey = `tt_focus_notified_${today}`;

  const stored = await chrome.storage.local.get([notifiedKey]);
  const notifiedDomains: string[] = (stored[notifiedKey] as string[] | undefined) ?? [];
  const domainLower = domain.toLowerCase();

  if (notifiedDomains.includes(domainLower)) return;

  const settings = await getSettings();
  const focusList: FocusRule[] = settings.focusList ?? [];
  const rule = focusList.find((r) => r.domain.toLowerCase() === domainLower);
  if (!rule) return;

  const dayKey = `tt_${today}`;
  const result = await chrome.storage.local.get([dayKey]);
  const data: Record<string, number> = (result[dayKey] as Record<string, number>) ?? {};
  const secsSpent = data[domain] ?? 0;

  if (secsSpent >= rule.limitMinutes * 60) {
    if (!notifiedDomains.includes(domainLower)) {
      notifiedDomains.push(domainLower);
      await chrome.storage.local.set({ [notifiedKey]: notifiedDomains });
    } else {
      return;
    }

    chrome.notifications.create(`tt_focus_${domain}_${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: `⏰ Time's up on ${domain}`,
      message: `You've reached your ${rule.limitMinutes}-minute daily limit.`,
    });

    if (rule.redirectEnabled) {
      try {
        // Redirect requires the optional scripting + <all_urls> permission granted by the user
        const hasPermission = await chrome.permissions.contains({
          permissions: ["scripting"],
          origins: ["<all_urls>"],
        });
        if (hasPermission) {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab?.id && tab.url && extractDomain(tab.url) === domain) {
            const newTabUrl = chrome.runtime.getURL("index.html");
            // Inject a content-script-style redirect into the page
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (url: string) => { window.location.replace(url); },
              args: [newTabUrl],
            });
          }
        }
      } catch {
        // Tab may have been closed, navigated away, or permission revoked
      }
    }
  }
}

// ── Chrome event listeners ────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async () => {
  await restoreSession();
  const url = await getActiveTabUrl();
  const domain = isTrackable(url) ? extractDomain(url) : null;
  if (domain !== currentDomain) {
    await flushAndEnd();
    if (domain) {
      const settings = await getSettings();
      if (!isExcludedDomain(domain, settings)) {
        startSession(domain);
        await checkFocusLimit(domain);
      }
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  await restoreSession();
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id !== tabId) return;
  } catch {
    return;
  }
  const domain = isTrackable(changeInfo.url) ? extractDomain(changeInfo.url) : null;
  if (domain !== currentDomain) {
    await flushAndEnd();
    if (domain) {
      const settings = await getSettings();
      if (!isExcludedDomain(domain, settings)) {
        startSession(domain);
        await checkFocusLimit(domain);
      }
    }
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushAndEnd();
  } else {
    const settings = await getSettings();
    const state = await chrome.idle.queryState(settings.idleThreshold);
    await refreshSession(state !== "active");
  }
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== "active") {
    await flushAndEnd();
  } else {
    await refreshSession(false);
  }
});

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tt_heartbeat") {
    await restoreSession();
    if (!currentDomain || !sessionStartMs) {
      // No session (e.g. the worker restarted): pick up the active tab again.
      const settings = await getSettings();
      const state = await chrome.idle.queryState(settings.idleThreshold);
      await refreshSession(state !== "active");
      return;
    }
    if (currentDomain && sessionStartMs) {
      const settings = await getSettings();
      const state = await chrome.idle.queryState(settings.idleThreshold);
      if (state === "active") {
        // Flush elapsed, check limits, restart session
        const flushedDomain = await flushAndEnd();
        const url = await getActiveTabUrl();
        const domain = isTrackable(url) ? extractDomain(url) : null;
        if (domain && !isExcludedDomain(domain, settings)) {
          startSession(domain);
          await checkFocusLimit(domain);
        }
        // Also check the domain we just flushed (in case it crossed the limit mid-session)
        if (flushedDomain && flushedDomain !== domain) {
          await checkFocusLimit(flushedDomain);
        }
      } else {
        await flushAndEnd();
      }
    }
  } else if (alarm.name === "tt_daily_summary") {
    await sendDailySummary();
    await scheduleDailyAlarm();
    await pruneOldFocusNotifiedKeys();
  }
});

// ── Daily summary notification ────────────────────────────────────────────────

async function sendDailySummary(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifyEnabled) return;
  const dayKey = `tt_${getDayKey()}`;
  const result = await chrome.storage.local.get([dayKey]);
  const data: Record<string, number> = (result[dayKey] as Record<string, number>) ?? {};
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const topStr = entries
    .slice(0, 3)
    .map(([d, s]) => {
      const dh = Math.floor(s / 3600);
      const dm = Math.floor((s % 3600) / 60);
      return `${d} (${dh > 0 ? `${dh}h ` : ""}${dm}m)`;
    })
    .join(", ");
  chrome.notifications.create("tt_summary_" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "ProdLi Daily Summary",
    message: `${h > 0 ? `${h}h ` : ""}${m}m browsed today. Top: ${topStr}`,
  });
}

async function scheduleDailyAlarm(): Promise<void> {
  const settings = await getSettings();
  await chrome.alarms.clear("tt_daily_summary");
  if (!settings.notifyEnabled) return;
  const [hh, mm] = settings.notifyTime.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  chrome.alarms.create("tt_daily_summary", { when: target.getTime() });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function pruneOldFocusNotifiedKeys(): Promise<void> {
  const today = getDayKey();
  const allItems = await chrome.storage.local.get(null);
  const oldKeys = Object.keys(allItems).filter(
    (k) => k.startsWith("tt_focus_notified_") && !k.endsWith(today),
  );
  if (oldKeys.length > 0) {
    await chrome.storage.local.remove(oldKeys);
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleThreshold);
  chrome.alarms.create("tt_heartbeat", { periodInMinutes: 1 });
  await scheduleDailyAlarm();
  await pruneOldFocusNotifiedKeys();
  // Start tracking the currently active tab immediately
  const state = await chrome.idle.queryState(settings.idleThreshold);
  await refreshSession(state !== "active");
}

chrome.runtime.onInstalled.addListener(() => { init(); });
chrome.runtime.onStartup.addListener(() => { init(); });

// Update idle interval and reschedule alarm when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes["tt_settings"]) return;
  const s = changes["tt_settings"].newValue as TrackerSettings | undefined;
  if (!s) return;
  chrome.idle.setDetectionInterval(s.idleThreshold);
  if (!s.notifyEnabled) {
    chrome.alarms.clear("tt_daily_summary");
  } else {
    scheduleDailyAlarm();
  }
});
