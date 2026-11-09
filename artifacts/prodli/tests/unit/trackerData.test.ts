import { describe, expect, it } from "vitest";
import {
  buildDayTotals,
  buildDomainTotals,
  buildTrendPoints,
  clearAllTrackingData,
  clearDomainHistory,
  computePreviousPeriod,
  fmtDelta,
  fmtSecs,
  getAllTrackingData,
} from "../../src/sections/tracker/data";
import { storageGet, storageSet } from "../../src/lib/storage";

const data = {
  "2026-11-06": { "github.com": 3600, "youtube.com": 600 },
  "2026-11-07": { "github.com": 1800, "docs.google.com": 900 },
};

describe("Time Tracker numbers", () => {
  it("formats durations", () => {
    expect(fmtSecs(3725)).toBe("1:02:05");
    expect(fmtDelta(7200, 3600)).toEqual({ text: "+1h 0m", positive: true, zero: false });
    expect(fmtDelta(60, 600).text).toBe("-9m");
    expect(fmtDelta(5, 5).zero).toBe(true);
  });

  it("totals per site and per day, honouring excluded sites and search", () => {
    expect(buildDomainTotals(data, "", new Set())).toEqual({ "github.com": 5400, "youtube.com": 600, "docs.google.com": 900 });
    expect(buildDomainTotals(data, "git", new Set())).toEqual({ "github.com": 5400 });
    expect(buildDayTotals(data, "", new Set(["youtube.com"]))).toEqual({ "2026-11-06": 3600, "2026-11-07": 2700 });
  });

  it("compares against the previous period of the same length", () => {
    expect(computePreviousPeriod("2026-11-08", "2026-11-14")).toEqual({ fromB: "2026-11-01", toB: "2026-11-07" });
  });

  it("charts daily for short ranges and weekly for long ones", () => {
    expect(buildTrendPoints("2026-11-01", "2026-11-07", { "2026-11-03": 60 })).toHaveLength(7);
    const weekly = buildTrendPoints("2026-01-01", "2026-06-30", { "2026-03-04": 100 });
    expect(weekly.length).toBeLessThan(30);
    expect(weekly.reduce((s, p) => s + p.total, 0)).toBe(100);
  });
});

describe("Time Tracker storage", () => {
  it("clearing all history keeps the tracker settings (Focus List, excluded sites)", async () => {
    await storageSet("tt_2026-11-07", { "github.com": 100 });
    await storageSet("tt_focus_notified_2026-11-07", ["github.com"]);
    await storageSet("tt_settings", { idleThreshold: 60, notifyEnabled: true, notifyTime: "20:00", focusList: [{ id: "r", domain: "youtube.com", limitMinutes: 30, redirectEnabled: false }], excludedDomains: ["bank.com"] });
    await clearAllTrackingData();
    expect(await getAllTrackingData()).toEqual({});
    expect(await storageGet("tt_focus_notified_2026-11-07", null)).toBeNull();
    expect(await storageGet<{ excludedDomains: string[] }>("tt_settings", { excludedDomains: [] })).toMatchObject({ excludedDomains: ["bank.com"] });
  });

  it("clears one site's history across all days", async () => {
    await storageSet("tt_2026-11-06", { "github.com": 100, "youtube.com": 50 });
    await storageSet("tt_2026-11-07", { "youtube.com": 20 });
    await clearDomainHistory("youtube.com");
    expect(await getAllTrackingData()).toEqual({ "2026-11-06": { "github.com": 100 }, "2026-11-07": {} });
  });
});
