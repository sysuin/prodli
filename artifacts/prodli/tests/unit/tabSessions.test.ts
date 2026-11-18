import { describe, expect, it } from "vitest";
import { MAX_TABS, pickTabs, siteName } from "../../src/lib/tabSessions";

describe("saved tabs", () => {
  it("keeps web pages only, without duplicates", () => {
    const picked = pickTabs([
      { url: "https://docs.example.com/a", title: "Doc A" },
      { url: "chrome-extension://abc/index.html", title: "ProdLi" },
      { url: "chrome://settings", title: "Settings" },
      { url: "https://docs.example.com/a", title: "Doc A again" },
      { url: "http://news.site/b", title: "" },
      { url: undefined, title: "Loading" },
    ]);
    expect(picked).toEqual([
      { url: "https://docs.example.com/a", title: "Doc A" },
      { url: "http://news.site/b", title: "news.site" },
    ]);
  });
  it("caps a session at 100 tabs and shows site names", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ url: `https://s.com/${i}`, title: `T${i}` }));
    expect(pickTabs(many)).toHaveLength(MAX_TABS);
    expect(siteName("https://www.github.com/x")).toBe("github.com");
  });
});
