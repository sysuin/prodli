import { describe, expect, it } from "vitest";
import { breakdown, categoryOf, cleanDomain, focusScore, scoreLabel, sumDays } from "../../src/lib/siteCategories";
import { weekStats, reviewContext, basicReview } from "../../src/lib/review";
import { contextFrom, DEFAULT_TODAY_SETTINGS, basicBrief } from "../../src/lib/today";

describe("site categories", () => {
  it("knows well-known sites, preferring the most specific entry", () => {
    expect(categoryOf("github.com")).toBe("work");
    expect(categoryOf("www.youtube.com")).toBe("video");
    expect(categoryOf("docs.google.com")).toBe("work");
    expect(categoryOf("mail.google.com")).toBe("communication");
    expect(categoryOf("gemini.google.com")).toBe("ai");
    expect(categoryOf("google.com")).toBe("other");
    expect(categoryOf("old.reddit.com")).toBe("social");
    expect(categoryOf("en.wikipedia.org")).toBe("learning");
    expect(categoryOf("claude.ai")).toBe("ai");
    expect(categoryOf("localhost")).toBe("work");
    expect(categoryOf("my-blog.example")).toBe("other");
  });

  it("lets the user's choice win, including for subdomains", () => {
    expect(categoryOf("youtube.com", { "youtube.com": "learning" })).toBe("learning");
    expect(categoryOf("m.youtube.com", { "youtube.com": "learning" })).toBe("learning");
    expect(categoryOf("intranet.acme.com", { "acme.com": "work" })).toBe("work");
    expect(categoryOf("github.com", { "github.com": "nonsense" })).toBe("work"); // bad values ignored
  });

  it("cleans domains", () => {
    expect(cleanDomain(" WWW.News.Google.com. ")).toBe("news.google.com");
  });
});

describe("focus score", () => {
  const day = { "github.com": 3600, "youtube.com": 1200, "mail.google.com": 1800, "claude.ai": 600, "excluded.com": 9999 };

  it("splits time by kind and category", () => {
    const b = breakdown(day, {}, new Set(["excluded.com"]));
    expect(b.total).toBe(7200);
    expect(b.byKind).toEqual({ productive: 4200, neutral: 1800, distracting: 1200 });
    expect(b.byCategory.map((c) => c.id)).toEqual(["work", "communication", "video", "ai"]);
  });

  it("is productive time out of productive + distracting", () => {
    expect(focusScore(breakdown(day, {}, new Set(["excluded.com"])))).toBe(78); // 4200 / 5400
    expect(focusScore(breakdown({ "github.com": 300, "mail.google.com": 5000 }))).toBeNull(); // under 10 minutes judged
    expect(focusScore(breakdown({ "youtube.com": 900 }))).toBe(0);
  });

  it("labels scores and adds up days", () => {
    expect([scoreLabel(80), scoreLabel(60), scoreLabel(20)]).toEqual(["Focused", "Mixed", "Distracted"]);
    expect(sumDays([{ a: 1 }, undefined, { a: 2, b: 3 }])).toEqual({ a: 3, b: 3 });
  });
});

describe("focus score in the brief and review", () => {
  it("adds yesterday's score to the brief, with a tip when it was low", () => {
    const now = new Date(2026, 10, 19, 8, 30);
    const ctx = contextFrom({ now, settings: DEFAULT_TODAY_SETTINGS, todos: [], habits: [], meetings: [], days: [], events: [], trackingYesterday: { "github.com": 600, "youtube.com": 1800 } });
    expect(ctx.yesterday?.focusScore).toBe(25);
    expect(basicBrief(ctx).tip).toMatch(/focus score was 25.*Block distracting sites/);
    const mine = contextFrom({ now, settings: DEFAULT_TODAY_SETTINGS, todos: [], habits: [], meetings: [], days: [], events: [], trackingYesterday: { "github.com": 600, "youtube.com": 1800 }, siteCategories: { "youtube.com": "learning" } });
    expect(mine.yesterday?.focusScore).toBe(100);
  });

  it("gives the week's score and categories, AI tools included", () => {
    const s = weekStats({ start: "2026-11-16", today: "2026-11-19", todos: [], habits: [], days: [], sessions: [], meetings: [], notes: [], tracking: { "2026-11-16": { "github.com": 7200, "chatgpt.com": 3600 }, "2026-11-17": { "reddit.com": 3600 } } });
    expect(s.browsing.focusScore).toBe(75);
    expect(s.browsing.categories).toEqual([
      { id: "work", label: "Work & tools", minutes: 120 },
      { id: "ai", label: "AI tools", minutes: 60 },
      { id: "social", label: "Social media", minutes: 60 },
    ]);
    expect(reviewContext(s).browsing).toMatchObject({ focusScore: 75, categories: [{ category: "Work & tools", minutes: 120 }, { category: "AI tools", minutes: 60 }, { category: "Social media", minutes: 60 }] });
    expect(basicReview(s).patterns.join(" ")).toContain("Focus score 75 (focused); 1 h with AI tools.");
  });
});

describe("focus trends", () => {
  it("scores each day, averages them, compares with the period before and finds the biggest distraction", async () => {
    const { focusTrend } = await import("../../src/lib/siteCategories");
    const days: Record<string, Record<string, number>> = {
      "2026-11-20": { "github.com": 3600, "youtube.com": 1200 }, // 75
      "2026-11-19": { "github.com": 1800, "reddit.com": 1800 }, // 50
      "2026-11-17": { "github.com": 3000, "youtube.com": 600 }, // 83 (earlier period)
    };
    const t = focusTrend(days, "2026-11-20", 2);
    expect(t.points).toEqual([{ date: "2026-11-19", score: 50 }, { date: "2026-11-20", score: 75 }]);
    expect(t.average).toBe(63);
    expect(t.previousAverage).toBe(83); // the 2 days before: 17th–18th
    expect(focusTrend({ "2026-11-20": days["2026-11-20"] }, "2026-11-20", 2).previousAverage).toBeNull();
    expect(t.topDistraction).toEqual({ id: "social", minutes: 30 });
    expect(focusTrend(days, "2026-11-20", 3).previousAverage).toBe(83);
    expect(focusTrend({}, "2026-11-20", 30).average).toBeNull();
  });
});
