// Time Tracker history (tracked by the extension on computers, synced here).
/** Pure: total seconds per site over the given days, largest first. */
export function totals(tracking: Record<string, Record<string, number>>, days: string[]): [string, number][] {
  const sum = new Map<string, number>();
  for (const d of days) for (const [site, s] of Object.entries(tracking[d] ?? {})) if (typeof s === "number") sum.set(site, (sum.get(site) ?? 0) + s);
  return [...sum].sort((a, b) => b[1] - a[1]);
}
