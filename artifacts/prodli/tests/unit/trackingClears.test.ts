import { describe, expect, it } from "vitest";
import { clearedOn, newClears, stripTrackingDay } from "../../src/lib/trackingClears";
import { stripTrackingDay as serverStrip } from "../../../prodli-api/src/trackingClears";

const day = { "youtube.com": 900, "github.com": 600 };

describe("Time Tracker clears", () => {
  it("removes cleared sites from earlier days, and from the day of the clear only when asked", () => {
    const clears = { sites: { "youtube.com": 20261127 } };
    expect(stripTrackingDay("2026-11-20", day, clears, false)).toEqual({ "github.com": 600 });
    expect(stripTrackingDay("2026-11-27", day, clears, false)).toBe(day); // time after the clear counts
    expect(stripTrackingDay("2026-11-27", day, clears, true)).toEqual({ "github.com": 600 });
    expect(stripTrackingDay("2026-11-28", day, clears, true)).toBe(day);
    expect(stripTrackingDay("2026-11-20", day, { all: 20261121 }, false)).toEqual({});
    expect(stripTrackingDay("2026-11-20", day, null, true)).toBe(day);
  });
  it("knows which clears are new to this device", () => {
    expect(newClears({ all: 20261127, sites: { a: 20261120, b: 20261127 } }, { all: 20261120, sites: { a: 20261120 } })).toEqual({ all: 20261127, sites: { b: 20261127 } });
    expect(newClears({ sites: { a: 1 } }, { sites: { a: 1 } })).toEqual({});
    expect(clearedOn({ all: 5, sites: { a: 9 } }, "a")).toBe(9);
    expect(clearedOn({ all: 5 }, "b")).toBe(5);
  });
  it("the server applies the same rule", () => {
    const cases: [string, Record<string, number>, { all?: number; sites?: Record<string, number> }, boolean][] = [
      ["2026-11-20", day, { sites: { "youtube.com": 20261127 } }, false],
      ["2026-11-27", day, { sites: { "youtube.com": 20261127 } }, true],
      ["2026-11-27", day, { all: 20261127 }, false],
      ["2026-11-26", day, { all: 20261127 }, false],
    ];
    for (const [d, v, c, inc] of cases) expect(serverStrip(d, v, c, inc)).toEqual(stripTrackingDay(d, v, c, inc));
  });
});
