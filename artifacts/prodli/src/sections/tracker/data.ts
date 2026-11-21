// Time Tracker data helpers: reading/clearing per-day totals and building
// the numbers the charts show. Pure functions here are unit-tested.

import { getDayKey, getDaysBetween } from "../../lib/utils";
import type { TrackerSettings, TimeTrackingDay } from "../../types";
import { onAnyStorageChange, storageGetAll, storageRemove, storageSet } from "../../lib/storage";

/** Theme-aware purple with WCAG AA contrast (deeper in light mode, lighter in dark). */
export const ACCENT = "var(--tracker-accent)";
/** Text colour on an ACCENT background. */
export const ON_ACCENT = "var(--tracker-on-accent)";
export const DEFAULT_SETTINGS: TrackerSettings = {
  idleThreshold: 60,
  notifyEnabled: true,
  notifyTime: "20:00",
  focusList: [],
  excludedDomains: [],
};
export const COLORS = ["#8B5CF6", "#FFD700", "#FF6B6B", "#00BCD4", "#66BB6A", "#FF8C94", "#4ECDC4", "#F59E0B"];

export function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function isExtension(): boolean {
  return typeof chrome !== "undefined" && !!(chrome as { storage?: unknown }).storage;
}

export async function getAllTrackingData(): Promise<Record<string, TimeTrackingDay>> {
  if (isExtension()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        const out: Record<string, TimeTrackingDay> = {};
        for (const [k, v] of Object.entries(all)) {
          if (/^tt_\d{4}-\d{2}-\d{2}$/.test(k)) {
            out[k.slice(3)] = v as TimeTrackingDay;
          }
        }
        resolve(out);
      });
    });
  }
  // Web app and desktop app: history synced from the extension, through the storage helpers.
  const out: Record<string, TimeTrackingDay> = {};
  for (const [k, v] of Object.entries(await storageGetAll())) {
    if (/^tt_\d{4}-\d{2}-\d{2}$/.test(k)) out[k.slice(3)] = v as TimeTrackingDay;
  }
  return out;
}

/** Per-day totals (tt_YYYY-MM-DD) and daily limit-notification markers. */
export const HISTORY_KEY = /^tt_(\d{4}-\d{2}-\d{2}|focus_notified_\d{4}-\d{2}-\d{2})$/;

// Range loader: fetches all storage data, slices to [fromDate, toDate], caches by key.
// The cache is dropped whenever tracking data changes, so views never go stale.
const _rangeCache = new Map<string, Record<string, TimeTrackingDay>>();
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((k) => /^tt_\d{4}-\d{2}-\d{2}$/.test(k))) _rangeCache.clear();
  });
} else if (typeof window !== "undefined") {
  onAnyStorageChange((keys) => keys.some((k) => /^tt_\d{4}-\d{2}-\d{2}$/.test(k)) && _rangeCache.clear());
}
/** Forget cached ranges (e.g. when a view is opened, to show fresh data). */
export function invalidateRangeCache(): void {
  _rangeCache.clear();
}

export async function loadRangeData(fromDate: string, toDate: string): Promise<Record<string, TimeTrackingDay>> {
  const cacheKey = `${fromDate}|${toDate}`;
  if (_rangeCache.has(cacheKey)) return _rangeCache.get(cacheKey)!;
  const all = await getAllTrackingData();
  const result: Record<string, TimeTrackingDay> = {};
  for (const [date, data] of Object.entries(all)) {
    if (date >= fromDate && date <= toDate) result[date] = data;
  }
  _rangeCache.set(cacheKey, result);
  return result;
}

export async function clearAllTrackingData(): Promise<void> {
  _rangeCache.clear();
  if (isExtension()) {
    const all: Record<string, unknown> = await new Promise((resolve) =>
      chrome.storage.local.get(null, resolve)
    );
    // Only history (per-day totals + limit-notification markers) — never tt_settings.
    const keys = Object.keys(all).filter((k) => HISTORY_KEY.test(k));
    if (keys.length) await new Promise<void>((resolve) => chrome.storage.local.remove(keys, resolve));
    return;
  }
  const keys = Object.keys(await storageGetAll()).filter((k) => HISTORY_KEY.test(k));
  await Promise.all(keys.map((k) => storageRemove(k)));
}

export async function clearDomainHistory(domain: string): Promise<void> {
  _rangeCache.clear();
  if (isExtension()) {
    const all: Record<string, unknown> = await new Promise((resolve) =>
      chrome.storage.local.get(null, resolve)
    );
    const dayKeys = Object.keys(all).filter((k) => /^tt_\d{4}-\d{2}-\d{2}$/.test(k));
    for (const key of dayKeys) {
      const day = all[key] as Record<string, number> | undefined;
      if (day && domain in day) {
        const updated = { ...day };
        delete updated[domain];
        await new Promise<void>((resolve) => chrome.storage.local.set({ [key]: updated }, resolve));
      }
    }
    return;
  }
  for (const [k, v] of Object.entries(await storageGetAll())) {
    const day = v as Record<string, number> | undefined;
    if (/^tt_\d{4}-\d{2}-\d{2}$/.test(k) && day && typeof day === "object" && domain in day) {
      const updated = { ...day };
      delete updated[domain];
      await storageSet(k, updated);
    }
  }
}

export type Tab = "today" | "history" | "alltime" | "settings";

export interface DaySummary {
  date: string;
  label: string;
  total: number;
  data: TimeTrackingDay;
}

// ── All Time Tab ──────────────────────────────────────────────────────────────

export type Preset = "30d" | "90d" | "ytd" | "all" | "custom";

export const ACCENT_B = "#F59E0B";

export function fmtDelta(a: number, b: number): { text: string; positive: boolean; zero: boolean } {
  const diff = a - b;
  if (diff === 0) return { text: "no change", positive: true, zero: true };
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sign = diff > 0 ? "+" : "-";
  const text = h > 0 ? `${sign}${h}h ${m}m` : `${sign}${m}m`;
  return { text, positive: diff > 0, zero: false };
}

export function computePreviousPeriod(fromDate: string, toDate: string): { fromB: string; toB: string } {
  const span = getDaysBetween(fromDate, toDate);
  const toB = new Date(fromDate + "T00:00:00");
  toB.setDate(toB.getDate() - 1);
  const fromB = new Date(toB);
  fromB.setDate(fromB.getDate() - span);
  return { fromB: getDayKey(fromB), toB: getDayKey(toB) };
}

export function buildDomainTotals(
  data: Record<string, TimeTrackingDay>,
  query: string,
  excludedSet: Set<string>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  const q = query.toLowerCase();
  for (const day of Object.values(data)) {
    for (const [domain, secs] of Object.entries(day)) {
      if (excludedSet.has(domain.toLowerCase())) continue;
      if (q && !domain.toLowerCase().includes(q)) continue;
      totals[domain] = (totals[domain] ?? 0) + secs;
    }
  }
  return totals;
}

export function buildDayTotals(
  data: Record<string, TimeTrackingDay>,
  query: string,
  excludedSet: Set<string>,
): Record<string, number> {
  const q = query.toLowerCase();
  const result: Record<string, number> = {};
  for (const [date, day] of Object.entries(data)) {
    let total = 0;
    for (const [domain, secs] of Object.entries(day)) {
      if (excludedSet.has(domain.toLowerCase())) continue;
      if (!q || domain.toLowerCase().includes(q)) total += secs;
    }
    if (total > 0) result[date] = total;
  }
  return result;
}

export function buildTrendPoints(
  fromDate: string,
  toDate: string,
  dayTotals: Record<string, number>,
): Array<{ label: string; total: number }> {
  const span = Math.max(0, getDaysBetween(fromDate, toDate));
  if (span > 60) {
    const weeks: Record<string, number> = {};
    for (let i = 0; i <= span; i++) {
      const d = new Date(fromDate + "T00:00:00");
      d.setDate(d.getDate() + i);
      const date = getDayKey(d);
      const ws = new Date(d);
      ws.setDate(d.getDate() - d.getDay());
      const wk = getDayKey(ws);
      weeks[wk] = (weeks[wk] ?? 0) + (dayTotals[date] ?? 0);
    }
    return Object.entries(weeks).sort().map(([d, total]) => ({
      label: new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
      total,
    }));
  }
  const days = [];
  for (let i = 0; i <= span; i++) {
    const d = new Date(fromDate + "T00:00:00");
    d.setDate(d.getDate() + i);
    const date = getDayKey(d);
    days.push({
      label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
      total: dayTotals[date] ?? 0,
    });
  }
  return days;
}

/** Today vs the average of earlier days that have data (6 days on the Today tab). Null without history. */
export function compareToUsual(todayTotal: number, earlierTotals: number[]): { average: number; percent: number } | null {
  const days = earlierTotals.filter((t) => t > 0);
  if (!days.length) return null;
  const average = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
  return { average, percent: average ? Math.round(((todayTotal - average) / average) * 100) : 0 };
}
