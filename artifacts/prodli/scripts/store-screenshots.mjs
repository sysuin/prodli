#!/usr/bin/env node
// Generates Chrome Web Store screenshots (1280×800, the store's preferred size)
// from the real built extension, filled with demo content.
//
//   pnpm run build:extension:test && node scripts/store-screenshots.mjs
//
// Output: artifacts/prodli/store-assets/screenshot-<n>-<name>.png (the store accepts up to 5)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, FIXTURES, sleep } from "../tests/e2e/cdp.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../store-assets");
mkdirSync(OUT, { recursive: true });

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const note = (id, title, content, minutesAgo, extra = {}) => ({ id, title, content, createdAt: iso(minutesAgo * 60_000 + 86_400_000), updatedAt: iso(minutesAgo * 60_000), autoTitle: false, ...extra });

const DEMO = {
  hasSeenOnboarding: true,
  theme: "light",
  notes: [
    note(
      "n1",
      "Product launch plan",
      `<h1>Product launch plan</h1><p>Launching <strong>ProdLi 1.3</strong> next week. Everything we need in one place.</p><h2>Launch checklist</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Final design review</p></li><li data-type="taskItem" data-checked="true"><p>Update the privacy policy</p></li><li data-type="taskItem" data-checked="false"><p>Record a 60-second <mark>demo video</mark></p></li><li data-type="taskItem" data-checked="false"><p>Submit to the Chrome Web Store</p></li></ul><h2>Owners</h2><table><tbody><tr><th><p>Area</p></th><th><p>Owner</p></th><th><p>Status</p></th></tr><tr><td><p>Editor</p></td><td><p>Priya</p></td><td><p>✅ Done</p></td></tr><tr><td><p>Drive backup</p></td><td><p>Alex</p></td><td><p>In review</p></td></tr><tr><td><p>Store listing</p></td><td><p>Sam</p></td><td><p>This week</p></td></tr></tbody></table><blockquote><p>Type “/” anywhere for checklists, tables, headings and more.</p></blockquote>`,
      2,
      { pinned: true },
    ),
    note("n2", "Meeting notes — Design sync", "<h1>Design sync</h1><p>Agreed on the new onboarding flow.</p>", 90),
    note("n3", "Reading list", "<ul><li><p>Deep Work</p></li><li><p>The Pragmatic Programmer</p></li></ul>", 60 * 26),
    note("n4", "Ideas", "<p>Weekly review template…</p>", 60 * 50),
  ],
  activeNoteId: "n1",
  todos: [
    { id: "t1", title: "Finish onboarding emails (Priya)", completed: false, priority: "high", dueDate: day(-1), subtasks: [], createdAt: iso(3_600_000) },
    { id: "t2", title: "Prepare release notes", completed: false, priority: "medium", dueDate: day(-3), subtasks: [{ id: "s1", title: "Editor changes", completed: true }, { id: "s2", title: "Drive backup", completed: false }], createdAt: iso(7_200_000) },
    { id: "t3", title: "Review pull request #2", completed: true, priority: "high", subtasks: [], createdAt: iso(9_000_000) },
    { id: "t4", title: "Book team offsite", completed: false, priority: "low", dueDate: day(-10), subtasks: [], createdAt: iso(10_000_000) },
    { id: "t5", title: "Update store screenshots", completed: false, subtasks: [], createdAt: iso(11_000_000) },
  ],
  habits: [
    { id: "h1", name: "Read 20 pages", emoji: "📚", color: "#60a5fa", completedDays: Array.from({ length: 12 }, (_, i) => day(i)), createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h2", name: "Exercise", emoji: "🏃", color: "#4ade80", completedDays: [0, 1, 2, 4, 5, 7, 8, 9, 11].map(day), createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h3", name: "Meditate", emoji: "🧘", color: "#a78bfa", completedDays: [0, 1, 2, 3, 4, 5].map(day), createdAt: iso(40 * 86_400_000), archived: false },
  ],
};
for (let i = 0; i < 7; i++) {
  const f = 1 - i * 0.08;
  DEMO[`tt_${day(i)}`] = {
    "github.com": Math.round(7200 * f),
    "docs.google.com": Math.round(4300 * f),
    "meet.google.com": Math.round(3100 * f),
    "stackoverflow.com": Math.round(1500 * f),
    "youtube.com": Math.round(900 * f),
    "news.ycombinator.com": Math.round(600 * f),
  };
}

const MEETING = {
  id: "mtg_demo",
  platform: "google-meet",
  title: "Weekly product sync",
  meetingCode: "abc-defg-hij",
  url: "https://meet.google.com/abc-defg-hij",
  startedAt: iso(2 * 3_600_000),
  endedAt: iso(2 * 3_600_000 - 32 * 60_000),
  durationSec: 32 * 60,
  status: "ready",
  error: null,
  notice: null,
  hasAudio: false,
  micIncluded: true,
  audioMimeType: null,
  updatedAt: iso(3_600_000),
  transcript: [
    { id: "1", speaker: "You", text: "Let's lock the scope for the 1.3 launch.", startMs: 4000, endMs: 8000 },
    { id: "2", speaker: "Priya Shah", text: "Editor is done. I'll finish the onboarding emails by Thursday.", startMs: 12000, endMs: 18000 },
    { id: "3", speaker: "Alex Kim", text: "Drive backup is in review — should merge tomorrow.", startMs: 21000, endMs: 26000 },
  ],
  summary: {
    title: "Weekly product sync",
    overview: "The team confirmed the 1.3 launch scope. The editor is complete, Drive backup merges tomorrow, and the store submission goes out next week.",
    keyPoints: ["Editor v2 is complete and tested", "Drive backup is in code review", "Store screenshots need refreshing before submission"],
    decisions: ["Launch 1.3 next Tuesday", "Keep sign-in optional"],
    actionItems: [
      { task: "Finish onboarding emails", owner: "Priya Shah", dueDate: day(-2), priority: "high" },
      { task: "Merge Drive backup", owner: "Alex Kim", dueDate: day(-1), priority: "high" },
      { task: "Refresh store screenshots", owner: null, dueDate: null, priority: "medium" },
    ],
    openQuestions: ["Do we need a launch blog post?"],
    model: "claude-haiku-5-5",
    generatedAt: iso(3_600_000),
  },
};

const browser = new Browser();
try {
  await browser.loadExtension();
  const p = await browser.openPage();
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.eval(`chrome.storage.local.set(${JSON.stringify(DEMO)})`);
  await p.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open("prodli-meetings", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meetings", { keyPath: "id" });
      db.createObjectStore("audio");
      db.createObjectStore("audioChunks", { keyPath: ["meetingId", "seq"] }).createIndex("byMeeting", "meetingId");
    };
    req.onsuccess = () => { const tx = req.result.transaction("meetings", "readwrite"); tx.objectStore("meetings").put(${JSON.stringify(MEETING)}); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); };
  })`);

  const shot = async (n, name) => {
    const { data } = await p.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `screenshot-${n}-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log("✓", path.relative(process.cwd(), file));
  };
  const open = async (section) => {
    await p.eval(`chrome.storage.local.set({ lastSection: ${JSON.stringify(section)} })`);
    await p.send("Page.reload", {});
    await sleep(2200);
  };

  // 1. Editor
  await open("editor");
  await p.eval(`document.activeElement?.blur?.()`);
  await shot(1, "editor");

  // 2. Meetings
  await open("meetings");
  await p.eval(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("Setup")); if (document.body.innerText.includes("CLAUDE API KEY") || document.body.innerText.includes("Claude API key")) b?.click(); })()`);
  await sleep(400);
  await shot(2, "meetings");

  // 3. To-Dos
  await open("todos");
  await shot(3, "todos");

  // 4. Time Tracker (All time view if available)
  await open("tracker");
  await sleep(800);
  await shot(4, "time-tracker");

  // 5. Files — Markdown preview
  await open("files");
  const { root } = await p.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await p.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await p.send("DOM.setFileInputFiles", { nodeId, files: [path.join(FIXTURES, "demo-roadmap.md")] });
  await sleep(800);
  await shot(5, "files");

  // Extra (not uploaded by default): Habits and Pomodoro.
  await open("habits");
  await shot(6, "habits");
  await open("pomodoro");
  await p.eval(`[...document.querySelectorAll("button")].find(b => /start/i.test(b.textContent))?.click()`);
  await sleep(2500);
  await shot(7, "pomodoro");
} finally {
  browser.close();
}
