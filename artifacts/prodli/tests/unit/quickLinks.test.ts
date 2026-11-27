import { describe, expect, it } from "vitest";
import { defaultTitle, normalizeUrl, searchTarget, tileColor, suggestedSites } from "../../src/lib/quickLinks";

describe("quick links and search", () => {
  it("cleans up link addresses", () => {
    expect(normalizeUrl("github.com/me")).toBe("https://github.com/me");
    expect(normalizeUrl("https://mail.google.com")).toBe("https://mail.google.com/");
    expect(normalizeUrl("localhost:3000")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("two words")).toBeNull();
    expect(defaultTitle("https://www.github.com/me")).toBe("Github");
    expect(defaultTitle("https://mail.google.com/")).toBe("Google");
  });
  it("opens addresses and searches everything else", () => {
    expect(searchTarget("github.com")).toEqual({ kind: "url", url: "https://github.com/" });
    expect(searchTarget("https://x.com/home")).toEqual({ kind: "url", url: "https://x.com/home" });
    expect(searchTarget("best pizza near me")).toEqual({ kind: "search", text: "best pizza near me" });
    expect(searchTarget("node.js")).toEqual({ kind: "search", text: "node.js" }); // .js isn't a domain ending
    expect(searchTarget("v2.1")).toEqual({ kind: "search", text: "v2.1" });
    expect(searchTarget("www.example")).toEqual({ kind: "url", url: "https://www.example/" });
    expect(searchTarget("docs.python.org/3/")).toEqual({ kind: "url", url: "https://docs.python.org/3/" });
    expect(searchTarget("react")).toEqual({ kind: "search", text: "react" });
    expect(searchTarget("  ")).toBeNull();
    expect(tileColor("Github")).toBe(tileColor("Github"));
  });
});

describe("Most visited suggestions", () => {
  const days = {
    "2026-11-26": { "github.com": 3000, "youtube.com": 2000, "mail.google.com": 900, "127.0.0.1": 5000, "localhost": 4000, "bank.example": 1200, "tiny.com": 60 },
    "2026-11-27": { "github.com": 1000, "docs.google.com": 700, "news.example": 400 },
  };
  it("ranks sites by time and leaves out pinned, excluded, hidden and non-sites", () => {
    const out = suggestedSites(days, { links: [{ url: "https://www.youtube.com/" }], excluded: new Set(["bank.example"]), hidden: ["NEWS.example"] });
    expect(out.map((s) => s.domain)).toEqual(["github.com", "mail.google.com", "docs.google.com"]);
    expect(out[0].seconds).toBe(4000);
  });
  it("keeps to the limit and the minimum time", () => {
    expect(suggestedSites(days, { links: [], max: 2 }).map((s) => s.domain)).toEqual(["github.com", "youtube.com"]);
    expect(suggestedSites(days, { links: [], minSeconds: 1000 }).map((s) => s.domain)).toEqual(["github.com", "youtube.com", "bank.example"]);
    expect(suggestedSites({}, { links: [] })).toEqual([]);
  });
});
