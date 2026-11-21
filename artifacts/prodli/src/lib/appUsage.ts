// Time in apps on this computer (desktop app only, opt-in): which app was in
// front, per day, under apps_YYYY-MM-DD ({ "Slack": 1840, … } in seconds).
// Counted by the desktop app (artifacts/prodli-desktop/src/main/appTracker.ts);
// kept on this computer, not synced. Shown in Time Tracker › Apps.

export const APP_TRACKING_KEY = "desktopAppTracking";
export const APPS_DAY = /^apps_\d{4}-\d{2}-\d{2}$/;
export const appsDayKey = (d = new Date()) => `apps_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Biggest first, with each app's share of the total. */
export function topApps(day: Record<string, number> | undefined, limit = 12): { app: string; seconds: number; share: number }[] {
  const entries = Object.entries(day ?? {}).filter(([, s]) => typeof s === "number" && s > 0);
  const total = entries.reduce((a, [, s]) => a + s, 0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([app, seconds]) => ({ app, seconds, share: total ? seconds / total : 0 }));
}

/** Several days added up (for "this week"). */
export function sumDays(days: (Record<string, number> | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(d ?? {})) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  return out;
}
