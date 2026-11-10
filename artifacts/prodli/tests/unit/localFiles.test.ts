import { describe, expect, it } from "vitest";
import { fileNameOf, isOpenableLocalFile } from "../../src/lib/localFiles";

describe("opening local files in ProdLi", () => {
  it.each([
    ["file:///Users/me/notes/plan.md", true],
    ["file:///Users/me/data/sales%202026.CSV", true],
    ["file:///Users/me/app/config.json", true],
    ["file:///Users/me/logs/server.log", true],
    ["file:///Users/me/src/main.ts", true],
    ["file:///Users/me/site/index.html", false], // Chrome renders web pages better
    ["file:///Users/me/report.pdf", false],
    ["file:///Users/me/photo.png", false],
    ["file:///Users/me/Downloads/", false], // folder listing
    ["file:///Users/me/README", false], // no extension
    ["https://example.com/plan.md", false], // only local files
    [undefined, false],
  ])("%s → %s", (url, expected) => {
    expect(isOpenableLocalFile(url)).toBe(expected);
  });

  it("names the file from its path", () => {
    expect(fileNameOf("file:///Users/me/data/sales%202026.csv")).toBe("sales 2026.csv");
  });
});
