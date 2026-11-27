// Clearing Time Tracker history so it stays cleared on every device.
//
// Tracker days sync by "larger number wins" (each device adds its part), so a
// day with a site removed used to get its old numbers back from the server. A
// cleared site, or "clear everything", is now a synced record instead —
// tracking item "clears": { all?: 20261127, sites?: { "youtube.com": 20261127 } }
// (the local day it was cleared, as a number so "larger wins" keeps the latest).
// Days before that day lose the site everywhere; the day of the clear is
// cleared once, when the clear arrives (time after it still counts).
// The server applies the same rule (prodli-api/src/syncStore.ts → stripTrackingDay).

export const CLEARS_ID = "clears";
/** This device's copy of the clears record. */
export const CLEARS_KEY = "tt_clears";
/** What this device has already applied (so the day of a clear is cleared once). */
export const CLEARS_APPLIED_KEY = "tt_clearsApplied";

export interface TrackingClears {
  all?: number;
  sites?: Record<string, number>;
}

/** 2026-11-27 → 20261127. */
export const dayNumber = (day: string) => Number(day.replace(/-/g, ""));

/** The day a site was last cleared (all sites or this one), or 0. */
export function clearedOn(clears: TrackingClears | null | undefined, domain: string): number {
  return Math.max(clears?.all ?? 0, clears?.sites?.[domain] ?? 0);
}

/**
 * The day without the sites cleared after it. `includeClearDay`: also clear
 * the day of the clear itself (only when the clear is first applied).
 * Returns the same object when nothing changes.
 */
export function stripTrackingDay(day: string, data: Record<string, number>, clears: TrackingClears | null | undefined, includeClearDay: boolean): Record<string, number> {
  if (!clears || (!clears.all && !clears.sites)) return data;
  const n = dayNumber(day);
  let out: Record<string, number> | null = null;
  for (const domain of Object.keys(data)) {
    const c = clearedOn(clears, domain);
    if (c && (n < c || (includeClearDay && n === c))) {
      out ??= { ...data };
      delete out[domain];
    }
  }
  return out ?? data;
}

/** The clears in `next` that `applied` doesn't have yet (to clear their day once). */
export function newClears(next: TrackingClears, applied: TrackingClears | null | undefined): TrackingClears {
  const out: TrackingClears = {};
  if (next.all && next.all > (applied?.all ?? 0)) out.all = next.all;
  for (const [d, n] of Object.entries(next.sites ?? {})) if (n > (applied?.sites?.[d] ?? 0)) (out.sites ??= {})[d] = n;
  return out;
}

export function isClearsValue(v: unknown): v is TrackingClears {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as TrackingClears;
  return (c.all === undefined || typeof c.all === "number") && (c.sites === undefined || (typeof c.sites === "object" && Object.values(c.sites).every((n) => typeof n === "number")));
}
