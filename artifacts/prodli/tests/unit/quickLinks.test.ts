import { describe, expect, it } from "vitest";
import { defaultTitle, normalizeUrl, searchTarget, tileColor } from "../../src/lib/quickLinks";

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
