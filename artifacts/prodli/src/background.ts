// ProdLi Time Tracker — Background Service Worker (MV3)
// Tracks active browsing time per domain and stores it in chrome.storage.local.

import type { TrackerSettings } from "./types";

const DEFAULT_SETTINGS: TrackerSettings = {
  idleThreshold: 60,
  notifyEnabled: true,
  notifyTime: "20:00",
};

// ── In-memory session state (reset when SW restarts — that's OK) ──────────────
let currentDomain: string | null = null;
let sessionStartMs: number | null = null;

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

async function getSettings(): Promise<TrackerSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tt_settings"], (result) => {
      resolve((result["tt_settings"] as TrackerSettings) ?? DEFAULT_SETTINGS);
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
}

async function flushAndEnd(endMs: number = Date.now()): Promise<void> {
  if (!currentDomain || !sessionStartMs) return;
  const elapsed = Math.round((endMs - sessionStartMs) / 1000);
  if (elapsed > 0 && elapsed < 3600) {
    const date = new Date(sessionStartMs);
    const dayKey = `tt_${getDayKey(date)}`;
    const result = await chrome.storage.local.get([dayKey]);
    const data: Record<string, number> = (result[dayKey] as Record<string, number>) ?? {};
    data[currentDomain] = (data[currentDomain] ?? 0) + elapsed;
    await chrome.storage.local.set({ [dayKey]: data });
  }
  currentDomain = null;
  sessionStartMs = null;
}

async function refreshSession(isIdle: boolean): Promise<void> {
  const url = await getActiveTabUrl();
  const domain = isTrackable(url) ? extractDomain(url) : null;
  if (!domain || isIdle) {
    await flushAndEnd();
    return;
  }
  if (domain !== currentDomain) {
    await flushAndEnd();
    startSession(domain);
  }
  // Same domain → session continues
}

// ── Chrome event listeners ────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async () => {
  const url = await getActiveTabUrl();
  const domain = isTrackable(url) ? extractDomain(url) : null;
  if (domain !== currentDomain) {
    await flushAndEnd();
    if (domain) startSession(domain);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id !== tabId) return;
  } catch {
    return;
  }
  const domain = isTrackable(changeInfo.url) ? extractDomain(changeInfo.url) : null;
  if (domain !== currentDomain) {
    await flushAndEnd();
    if (domain) startSession(domain);
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
    if (currentDomain && sessionStartMs) {
      const settings = await getSettings();
      const state = await chrome.idle.queryState(settings.idleThreshold);
      if (state === "active") {
        // Flush elapsed, restart session
        await flushAndEnd();
        const url = await getActiveTabUrl();
        const domain = isTrackable(url) ? extractDomain(url) : null;
        if (domain) startSession(domain);
      } else {
        await flushAndEnd();
      }
    }
  } else if (alarm.name === "tt_daily_summary") {
    await sendDailySummary();
    await scheduleDailyAlarm();
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

async function init(): Promise<void> {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleThreshold);
  chrome.alarms.create("tt_heartbeat", { periodInMinutes: 1 });
  await scheduleDailyAlarm();
}

chrome.runtime.onInstalled.addListener(() => { init(); });
chrome.runtime.onStartup.addListener(() => { init(); });

// Update idle interval when settings change
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
