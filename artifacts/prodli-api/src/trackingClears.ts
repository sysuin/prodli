// Time Tracker clears (the same rule as the app's src/lib/trackingClears.ts):
// tracking item "clears" = { all?: 20261127, sites?: { "youtube.com": 20261127 } },
// the local day each was cleared. Days before it lose those sites; the day
// itself is cleared once, when the clear arrives.

export const TRACKING_CLEARS_ID = "clears";

export interface TrackingClears {
  all?: number;
  sites?: Record<string, number>;
}

export function isTrackingDayValue(v: unknown): v is Record<string, number> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function stripTrackingDay(day: string, data: Record<string, number>, clears: TrackingClears | null | undefined, includeClearDay: boolean): Record<string, number> {
  if (!clears || (!clears.all && !clears.sites) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return data;
  const n = Number(day.replace(/-/g, ""));
  let out: Record<string, number> | null = null;
  for (const domain of Object.keys(data)) {
    const c = Math.max(clears.all ?? 0, clears.sites?.[domain] ?? 0);
    if (c && (n < c || (includeClearDay && n === c))) {
      out ??= { ...data };
      delete out[domain];
    }
  }
  return out ?? data;
}
