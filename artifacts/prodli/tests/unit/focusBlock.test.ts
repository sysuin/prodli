import { describe, expect, it } from "vitest";
import { activeSchedule, blockReason, blockingNow, domainOf, normalizeSite, parsePausePage, pausePageUrl, scheduleLabel, siteMatches, type FocusBlockSettings } from "../../src/lib/focusBlock";

const wed10 = new Date(2026, 10, 18, 10, 0); // Wednesday 10:00
const base: FocusBlockSettings = { enabled: true, sites: ["youtube.com", "x.com"], schedules: [{ id: "a", days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" }], duringPomodoro: true };

describe("focus blocking: sites", () => {
  it("cleans up what people type", () => {
    expect(normalizeSite("https://www.YouTube.com/watch?v=1")).toBe("youtube.com");
    expect(normalizeSite("reddit.com/r/all")).toBe("reddit.com");
    expect(normalizeSite("  m.facebook.com ")).toBe("m.facebook.com");
    expect(normalizeSite("not a site")).toBeNull();
    expect(normalizeSite("localhost")).toBeNull();
    expect(normalizeSite("")).toBeNull();
  });
  it("covers subdomains but not look-alikes", () => {
    expect(siteMatches("m.youtube.com", "youtube.com")).toBe(true);
    expect(siteMatches("youtube.com", "youtube.com")).toBe(true);
    expect(siteMatches("notyoutube.com", "youtube.com")).toBe(false);
    expect(domainOf("https://www.x.com/home")).toBe("x.com");
    expect(domainOf("chrome://settings")).toBeNull();
  });
});

describe("focus blocking: when it applies", () => {
  it("follows schedules, including ones past midnight", () => {
    expect(activeSchedule(base.schedules, wed10)?.id).toBe("a");
    expect(activeSchedule(base.schedules, new Date(2026, 10, 18, 12, 0))).toBeNull();
    expect(activeSchedule(base.schedules, new Date(2026, 10, 21, 10, 0))).toBeNull(); // Saturday
    const night = [{ id: "n", days: [3], start: "22:00", end: "02:00" }];
    expect(activeSchedule(night, new Date(2026, 10, 18, 23, 0))?.id).toBe("n"); // Wed 23:00
    expect(activeSchedule(night, new Date(2026, 10, 19, 1, 30))?.id).toBe("n"); // Thu 01:30, started Wed
    expect(activeSchedule(night, new Date(2026, 10, 19, 23, 0))).toBeNull(); // Thu night isn't scheduled
  });
  it("gives the reason, honouring passes and limits", () => {
    const off = { pomodoroFocus: false, now: new Date(2026, 10, 18, 13, 0) };
    expect(blockReason("youtube.com", base, { pomodoroFocus: false, now: wed10 })).toBe("schedule");
    expect(blockReason("youtube.com", base, { ...off, pomodoroFocus: true })).toBe("pomodoro");
    expect(blockReason("youtube.com", base, off)).toBeNull();
    expect(blockReason("github.com", base, { pomodoroFocus: true, now: wed10 })).toBeNull();
    expect(blockReason("youtube.com", { ...base, enabled: false }, { pomodoroFocus: true, now: wed10 })).toBeNull();
    expect(blockReason("youtube.com", { ...base, duringPomodoro: false }, { ...off, pomodoroFocus: true })).toBeNull();
    // "Continue anyway" pass: allowed until it runs out.
    expect(blockReason("m.youtube.com", base, { pomodoroFocus: true, now: wed10, passes: { "youtube.com": wed10.getTime() + 60_000 } })).toBeNull();
    expect(blockReason("youtube.com", base, { pomodoroFocus: true, now: wed10, passes: { "youtube.com": wed10.getTime() - 1 } })).toBe("pomodoro");
    // A used-up daily limit pauses the site even when blocking is off.
    expect(blockReason("news.site.com", { ...base, enabled: false }, { ...off, limitReached: ["site.com"] })).toBe("limit");
    expect(blockingNow(base, false, wed10)).toBe("schedule");
    expect(blockingNow({ ...base, sites: [] }, true, wed10)).toBeNull();
  });
});

describe("focus blocking: the pause page", () => {
  it("round-trips the blocked address and reason", () => {
    const u = pausePageUrl("chrome-extension://abc/index.html", "https://www.youtube.com/watch?v=1&t=2", "pomodoro");
    expect(u).toBe("chrome-extension://abc/index.html#blocked?u=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D1%26t%3D2&r=pomodoro");
    expect(parsePausePage(u.slice(u.indexOf("#")))).toEqual({ url: "https://www.youtube.com/watch?v=1&t=2", domain: "youtube.com", reason: "pomodoro" });
    expect(parsePausePage("#blocked?u=javascript%3Aalert(1)&r=schedule")).toBeNull();
    expect(parsePausePage("#blocked?u=https%3A%2F%2Fa.com&r=other")).toBeNull();
    expect(parsePausePage("#quick-add")).toBeNull();
    expect(scheduleLabel(base.schedules[0])).toBe("Weekdays 09:00–12:00");
  });
});
