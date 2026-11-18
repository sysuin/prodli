// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addReadLater, extractPageText, pageNoteHtml, savePageNote, summarizePageText } from "../../src/lib/readLater";
import { storageGet, storageSet } from "../../src/lib/storage";
import type { Note, ReadLaterItem } from "../../src/types";

describe("read later", () => {
  it("saves web pages once (while unread) and ignores other addresses", async () => {
    await storageSet("readLater", []);
    const a = await addReadLater("https://blog.example.com/post", "A good post");
    const again = await addReadLater("https://blog.example.com/post", "Same post");
    expect(again?.id).toBe(a?.id);
    expect(await addReadLater("chrome://settings", "x")).toBeNull();
    expect(await addReadLater("javascript:alert(1)", "x")).toBeNull();
    const items = await storageGet<ReadLaterItem[]>("readLater", []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: "https://blog.example.com/post", title: "A good post" });
    expect((await addReadLater("https://x.com/a", "  "))?.title).toBe("x.com");
  });
});

describe("summarize page", () => {
  beforeEach(() => vi.stubEnv("VITE_PRODLI_API", "https://api.test"));
  afterEach(() => vi.unstubAllEnvs());
  const page = { title: "Pricing <guide>", url: "https://www.example.com/pricing", text: "Intro paragraph that is long enough to be an excerpt for the note.\n\nSecond paragraph, also quite long, with useful details about plans." };

  it("reads the main content of a page, without menus and scripts", () => {
    document.body.innerHTML = `<nav>Home About</nav><main><h1>Title</h1><p>Body text here.</p><script>evil()</script><footer>© 2026</footer></main>`;
    const r = extractPageText(1000);
    expect(r.text).toContain("Body text here.");
    expect(r.text).not.toMatch(/Home About|evil|© 2026/);
    expect(extractPageText(5).text.length).toBeLessThanOrEqual(5);
  });

  it("writes a note with the summary, or an excerpt and the reason", () => {
    const withSummary = pageNoteHtml(page, { tldr: "Plans & prices.", points: ["Free tier", "Pro is $8"] });
    expect(withSummary).toContain("<h1>Pricing &lt;guide&gt;</h1>");
    expect(withSummary).toContain('Source: <a href="https://www.example.com/pricing">example.com</a>');
    expect(withSummary).toContain("<p>Plans &amp; prices.</p>");
    expect(withSummary).toContain("<li><p>Pro is $8</p></li>");
    const excerpt = pageNoteHtml(page, null, "Sign in to add an AI summary.");
    expect(excerpt).toContain("<h2>Excerpt</h2>");
    expect(excerpt).toContain("Sign in to add an AI summary.");
  });

  it("asks to sign in when signed out, and uses the account when signed in", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    expect((await summarizePageText(page)).reason).toMatch(/Sign in/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await storageSet("prodliAccount", { id: "u", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
    let sent: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/api/ai/summarize-page");
      sent = JSON.parse(String(init?.body));
      return Response.json({ summary: { tldr: "Short.", points: ["A"] } });
    }) as typeof fetch;
    await storageSet("notes", []);
    const r = await savePageNote(page);
    expect(r.summarized).toBe(true);
    expect(sent).toMatchObject({ title: page.title, url: page.url });
    const notes = await storageGet<Note[]>("notes", []);
    expect(notes[0].content).toContain("<p>Short.</p>");
    globalThis.fetch = vi.fn(async () => Response.json({ error: "write_quota_exceeded" }, { status: 429 })) as typeof fetch;
    expect((await summarizePageText(page)).reason).toMatch(/used this month's writing help/);
  });
});
