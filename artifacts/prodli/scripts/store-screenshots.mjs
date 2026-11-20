#!/usr/bin/env node
// Generates Chrome Web Store screenshots (1280×800, the store's preferred size)
// from the real extension, filled with demo content. It builds its own copy
// (dist-extension-shots, signed in to a tiny local stand-in for ProdLi's
// server) so Today's brief, Ask ProdLi and the weekly review show AI content
// without a real account. Your dist-extension is never touched.
//
//   node scripts/store-screenshots.mjs        (from artifacts/prodli)
//
// Output: artifacts/prodli/store-assets/screenshot-<n>-<name>.png. The store
// takes up to 5; 1–5 are the ones to upload, the rest are extras.

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8797;
const SERVER = `http://localhost:${PORT}`;
const OUT_DIR = "dist-extension-shots";
const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, "build-extension.mjs")], {
  cwd: path.resolve(here, ".."),
  stdio: "inherit",
  env: { ...process.env, PRODLI_OUT_DIR: OUT_DIR, PRODLI_GOOGLE_CLIENT_ID: "", PRODLI_EXTENSION_KEY: "", VITE_PRODLI_API: SERVER, VITE_E2E: "1" },
});
process.env.PRODLI_OUT_DIR = OUT_DIR; // cdp.mjs loads this build
const { Browser, FIXTURES, sleep } = await import("../tests/e2e/cdp.mjs");

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
      `<h1>Product launch plan</h1><p>Launching <strong>ProdLi 1.4</strong> next week. Everything we need in one place.</p><h2>Launch checklist</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Final design review</p></li><li data-type="taskItem" data-checked="true"><p>Update the privacy policy</p></li><li data-type="taskItem" data-checked="false"><p>Record a 60-second <mark>demo video</mark></p></li><li data-type="taskItem" data-checked="false"><p>Submit to the Chrome Web Store</p></li></ul><h2>Owners</h2><table><tbody><tr><th><p>Area</p></th><th><p>Owner</p></th><th><p>Status</p></th></tr><tr><td><p>Editor</p></td><td><p>Priya</p></td><td><p>✅ Done</p></td></tr><tr><td><p>Drive backup</p></td><td><p>Alex</p></td><td><p>In review</p></td></tr><tr><td><p>Store listing</p></td><td><p>Sam</p></td><td><p>This week</p></td></tr></tbody></table><blockquote><p>Type “/” anywhere for checklists, tables, headings and more.</p></blockquote>`,
      2,
      { pinned: true },
    ),
    note("n2", "Meeting notes — Design sync", "<h1>Design sync</h1><p>Agreed on the new onboarding flow.</p>", 90),
    note("n3", "Reading list", "<ul><li><p>Deep Work</p></li><li><p>The Pragmatic Programmer</p></li></ul>", 60 * 26),
    note("n4", "Ideas", "<p>Weekly review template…</p>", 60 * 50),
  ],
  activeNoteId: "n1",
  todos: [
    { id: "t1", title: "Finish onboarding emails (Priya)", completed: false, priority: "high", dueDate: day(-1), listId: "l-launch", labels: ["writing"], subtasks: [], createdAt: iso(3_600_000) },
    { id: "t6", title: "Send the weekly team update", completed: false, dueDate: day(-1), dueTime: "09:00", repeat: { unit: "week", every: 1, weekdays: [1] }, listId: "l-launch", subtasks: [], createdAt: iso(3_700_000) },
    { id: "t7", title: "Water the plants", completed: false, dueDate: day(0), repeat: { unit: "day", every: 3 }, listId: "l-home", labels: ["home"], subtasks: [], createdAt: iso(3_800_000) },
    { id: "t2", title: "Prepare release notes", completed: false, priority: "medium", dueDate: day(-3), listId: "l-launch", labels: ["writing"], subtasks: [{ id: "s1", title: "Editor changes", completed: true }, { id: "s2", title: "Drive backup", completed: false }], createdAt: iso(7_200_000) },
    { id: "t3", title: "Review pull request #2", completed: true, priority: "high", subtasks: [], createdAt: iso(9_000_000) },
    { id: "t4", title: "Book team offsite", completed: false, priority: "low", dueDate: day(-10), labels: ["waiting"], subtasks: [], createdAt: iso(10_000_000) },
    { id: "t5", title: "Update store screenshots", completed: false, subtasks: [], createdAt: iso(11_000_000) },
  ],
  habits: [
    { id: "h1", name: "Read 20 pages", emoji: "📚", color: "#60a5fa", completedDays: Array.from({ length: 12 }, (_, i) => day(i)), createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h2", name: "Exercise", emoji: "🏃", color: "#4ade80", completedDays: [0, 1, 2, 4, 5, 7, 8, 9, 11].map(day), createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h3", name: "Meditate", emoji: "🧘", color: "#a78bfa", completedDays: [0, 1, 2, 3, 4, 5].map(day), createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h4", name: "Drink water", emoji: "💧", color: "#38bdf8", kind: "count", target: 8, unit: "glasses", completedDays: [1, 2, 3, 5, 6].map(day), log: { [day(0)]: 5, [day(1)]: 8, [day(2)]: 9, [day(3)]: 8, [day(5)]: 8, [day(6)]: 10 }, createdAt: iso(40 * 86_400_000), archived: false },
    { id: "h5", name: "Practice guitar", emoji: "🎸", color: "#fb923c", kind: "timed", target: 20, completedDays: [1, 3, 4].map(day), log: { [day(0)]: 10, [day(1)]: 25, [day(3)]: 20, [day(4)]: 30 }, days: [1, 2, 3, 4, 5], createdAt: iso(40 * 86_400_000), archived: false },
  ],
  lists: [
    { id: "l-launch", kind: "list", name: "Launch", emoji: "🚀", createdAt: iso(20 * 86_400_000) },
    { id: "l-home", kind: "list", name: "Home", emoji: "🏠", createdAt: iso(20 * 86_400_000) },
  ],
  quickLinks: [
    { id: "q1", title: "GitHub", url: "https://github.com", createdAt: iso(86_400_000) },
    { id: "q2", title: "Gmail", url: "https://mail.google.com", createdAt: iso(86_400_000) },
    { id: "q3", title: "Calendar", url: "https://calendar.google.com", createdAt: iso(86_400_000) },
    { id: "q4", title: "Figma", url: "https://figma.com", createdAt: iso(86_400_000) },
    { id: "q5", title: "Linear", url: "https://linear.app", createdAt: iso(86_400_000) },
  ],
  tabSessions: [
    { id: "ts1", name: "Launch research", tabs: [{ url: "https://developer.chrome.com/docs/webstore", title: "Chrome Web Store docs" }, { url: "https://github.com", title: "GitHub" }, { url: "https://figma.com", title: "Figma: store assets" }], createdAt: iso(5 * 3_600_000) },
  ],
  readLater: [
    { id: "r1", url: "https://example.com/deep-work", title: "How to protect your mornings for deep work", createdAt: iso(3 * 3_600_000) },
  ],
  focusBlock: { enabled: true, sites: ["youtube.com", "x.com", "reddit.com"], schedules: [{ id: "fs1", days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" }], duringPomodoro: true },
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


// ── Today, the weekly review and an account (served by the stand-in below) ──
const TODAY = day(0);
const at = (offsetDays, hour) => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const mondayOf = (offsetWeeks) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - offsetWeeks * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// The Review section opens on this week from Friday, otherwise on last week.
const REVIEW_WEEK = new Date().getDay() === 0 || new Date().getDay() >= 5 ? mondayOf(0) : mondayOf(1);
const daysSinceReviewWeek = Math.round((new Date(TODAY) - new Date(REVIEW_WEEK)) / 86_400_000);
const inReviewWeek = (i) => Math.max(0, daysSinceReviewWeek - (i % 5)); // Monday–Friday of that week

DEMO.todos.unshift(
  { id: "p1", title: "Write the launch blog post", completed: false, priority: "high", plannedFor: TODAY, estimateMin: 60, block: { day: TODAY, start: "10:00" }, subtasks: [], createdAt: iso(5_000_000) },
  { id: "p2", title: "Reply to beta testers", completed: false, priority: "medium", plannedFor: TODAY, estimateMin: 30, block: { day: TODAY, start: "11:30" }, subtasks: [], createdAt: iso(5_100_000) },
  { id: "p3", title: "Review the Q4 budget", completed: false, plannedFor: TODAY, estimateMin: 45, block: { day: TODAY, start: "15:00" }, subtasks: [], createdAt: iso(5_200_000) },
);
const doneLastWeek = ["Ship Editor v2", "Fix the sync conflict bug", "Interview a designer", "Draft the pricing page", "Plan the team offsite agenda", "Send the investor update", "Clean up the backlog", "Record the demo video", "Test on Windows", "Write the release notes", "Update the privacy policy", "Review pull request #41", "Set up uptime alerts", "Pay the contractor invoice"];
doneLastWeek.forEach((title, i) => DEMO.todos.push({ id: `d${i}`, title, completed: true, completedAt: at(inReviewWeek(i), 10 + (i % 6)), subtasks: [], createdAt: at(inReviewWeek(i) + 2, 9) }));
DEMO.pomodoroSessions = [...Array.from({ length: 11 }, (_, i) => ({ completedAt: at(inReviewWeek(i), i < 9 ? 9 + (i % 3) : 15), duration: 25 })), { completedAt: at(0, 9), duration: 25 }];

const BRIEF = {
  headline: "A clear morning for deep work, then the product sync",
  summary: "Three tasks planned and one meeting. Write the launch post first while your calendar is empty; the onboarding emails are due tomorrow.",
  priorities: [
    { title: "Write the launch blog post", reason: "Your top task, and it needs a quiet hour: do it before the 1 pm sync." },
    { title: "Finish onboarding emails", reason: "Due tomorrow, and Priya is waiting for the copy." },
    { title: "Reply to beta testers", reason: "Three replies have been waiting since Friday." },
  ],
  schedule: [
    { start: "09:30", end: "10:00", title: "Plan the day and clear the inbox", kind: "task" },
    { start: "10:00", end: "11:00", title: "Write the launch blog post", kind: "focus" },
    { start: "11:30", end: "12:00", title: "Reply to beta testers", kind: "task" },
    { start: "13:00", end: "13:30", title: "Weekly product sync", kind: "meeting" },
    { start: "15:00", end: "15:45", title: "Review the Q4 budget", kind: "task" },
    { start: "18:00", end: "18:20", title: "Read 20 pages", kind: "habit" },
  ],
  watchouts: ["“Book team offsite” is due in 10 days and hasn't been started."],
  habits: ["Read 20 pages: a 12-day streak, keep it going"],
  prep: [
    { event: "Weekly product sync (13:00)", note: "Last met earlier today in launch planning: Priya owes the onboarding emails and Alex the Drive backup merge; ask whether you need a launch blog post." },
    { event: "Customer call: Acme (16:00)", note: "Open from last time: refresh the store screenshots before the demo." },
  ],
  tip: "Put your phone in another room for the first focus block.",
  model: "claude-haiku-5-5",
  generatedAt: iso(20 * 60_000),
  source: "ai",
};
const REVIEW = {
  headline: "A strong week: 14 tasks done and Editor v2 shipped",
  summary: "You finished 14 tasks, kept your reading streak every day and did 11 focus sessions. The offsite booking slipped again.",
  wins: ["Shipped Editor v2 and fixed the sync conflict bug", "Read every day: 12 days in a row", "Sent the investor update on time"],
  slipped: [{ title: "Book team offsite", suggestion: "Pick two dates and send a poll on Monday morning." }],
  patterns: ["Your best focus is before noon: 9 of 11 focus sessions were in the morning.", "Wednesday's back-to-back meetings left no time for deep work."],
  nextWeek: [
    { title: "Launch on the Chrome Web Store", reason: "Everything else is ready; the listing is the last step." },
    { title: "Book team offsite", reason: "Slipped twice: do it first thing Monday." },
    { title: "Write the launch blog post", reason: "Goes out with the launch." },
  ],
  habitTip: "Exercise dropped to 4 days: try a 15-minute walk after lunch.",
  question: "What would make next week feel like a win?",
  model: "claude-haiku-5-5",
  generatedAt: iso(3_600_000),
  source: "ai",
};
DEMO.days = [{ id: TODAY, focus: "Ship the launch blog post", brief: BRIEF, createdAt: iso(3_600_000) }];
const reviewDay = DEMO.days.find((d) => d.id === REVIEW_WEEK);
if (reviewDay) reviewDay.review = REVIEW;
else DEMO.days.push({ id: REVIEW_WEEK, review: REVIEW, createdAt: iso(3_600_000) });

const USER = { id: "u_demo", email: "alex@example.com", name: "Alex Morgan", picture: null, plan: "free", createdAt: now - 40 * 86_400_000 };
DEMO.prodliAccount = USER;
DEMO.prodliSession = { token: "demo-session" };

const ASK_QUESTION = "What should I focus on now?";
const ASK_ANSWER = {
  answer:
    "Start the launch blog post. It's your top priority and you have a clear hour before the 1 pm product sync.\n\nAfter that:\n• Reply to the three beta testers (about 30 minutes)\n• Finish the onboarding emails: Priya needs them by tomorrow\n\nIn this morning's launch planning call you decided to launch next Tuesday, so the store screenshots should be ready by Friday.",
  actions: [{ type: "add_task", title: "Refresh store screenshots by Friday", details: "From the launch planning call" }],
  usage: { used: 13, limit: 100 },
};

// A stand-in for ProdLi's server: just enough for the screenshots.
const LIMITS = { storageBytes: 100 * 1024 * 1024, summaries: 20, briefs: 62, asks: 100, writes: 200 };
const api = createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE" });
    res.end(JSON.stringify(obj));
  };
  req.resume();
  req.on("end", () => {
    const url = (req.url || "").split("?")[0];
    if (req.method === "OPTIONS") return send(204, {});
    if (url === "/api/me") return send(200, { user: USER });
    if (url === "/api/sync") return send(200, { seq: 1, changes: [], more: false, usage: { bytes: 2_400_000, quota: LIMITS.storageBytes } });
    if (url === "/api/ai/usage") return send(200, { used: 3, limit: 20, available: true, briefs: { used: 9, limit: 62 }, asks: { used: 12, limit: 100 }, writes: { used: 7, limit: 200 } });
    if (url === "/api/ai/ask") return setTimeout(() => send(200, ASK_ANSWER), 300);
    if (url === "/api/billing") return send(200, { plan: "free", onSale: null, prices: {}, canManage: false, subscription: null, limits: { free: LIMITS, pro: { storageBytes: 2 * 1024 ** 3, summaries: 300, briefs: 200, asks: 1000, writes: 2000 } } });
    if (url === "/api/config") return send(200, { googleWebClientId: null });
    send(404, { error: "not found" });
  });
}).listen(PORT);

const MEETING = {
  id: "mtg_demo",
  platform: "google-meet",
  title: "Launch planning",
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
    { id: "1", speaker: "You", text: "Let's lock the scope for the 1.4 launch.", startMs: 4000, endMs: 8000 },
    { id: "2", speaker: "Priya Shah", text: "Editor is done. I'll finish the onboarding emails by Thursday.", startMs: 12000, endMs: 18000 },
    { id: "3", speaker: "Alex Kim", text: "Drive backup is in review — should merge tomorrow.", startMs: 21000, endMs: 26000 },
  ],
  summary: {
    title: "Launch planning",
    overview: "The team confirmed the 1.4 launch scope. The editor is complete, Drive backup merges tomorrow, and the store submission goes out next week.",
    keyPoints: ["Editor v2 is complete and tested", "Drive backup is in code review", "Store screenshots need refreshing before submission"],
    decisions: ["Launch 1.4 next Tuesday", "Keep sign-in optional"],
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

// Last week's calls, for the weekly review's numbers and the meetings list.
const MEETINGS = [
  MEETING,
  ...[
    ["Design review", 2, 11, 45],
    ["Hiring sync", 2, 14, 30],
    ["Customer call: Acme", 2, 16, 40],
    ["Sprint planning", 4, 10, 50],
  ].map(([title, weekday, hour, mins], i) => {
    const start = new Date(at(Math.max(0, daysSinceReviewWeek - weekday), hour));
    return { ...MEETING, id: `mtg_week_${i}`, title, meetingCode: null, url: null, startedAt: start.toISOString(), endedAt: new Date(start.getTime() + mins * 60_000).toISOString(), durationSec: mins * 60, updatedAt: start.toISOString(), summary: { ...MEETING.summary, title } };
  }),
];

const browser = new Browser();
try {
  await browser.loadExtension();
  const p = await browser.openPage();
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  // Today's calendar (test-build stand-in for Google Calendar): the product sync shares the
  // launch planning call's Meet link, so Today shows meeting prep for it.
  const EVENTS = [
    { id: "ev1", title: "Weekly product sync", start: "13:00", end: "13:30", allDay: false, meetLink: "https://meet.google.com/abc-defg-hij", attendees: [{ name: "Priya Shah" }, { name: "Alex Kim" }] },
    { id: "ev2", title: "Customer call: Acme", start: "16:00", end: "16:40", allDay: false, attendees: [{ email: "jordan@acme.example" }] },
  ];
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__prodliCalendarStub = () => ${JSON.stringify(EVENTS)};` });
  await p.eval(`chrome.storage.local.set(${JSON.stringify(DEMO)})`);
  await p.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open("prodli-meetings", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meetings", { keyPath: "id" });
      db.createObjectStore("audio");
      db.createObjectStore("audioChunks", { keyPath: ["meetingId", "seq"] }).createIndex("byMeeting", "meetingId");
    };
    req.onsuccess = () => { const tx = req.result.transaction("meetings", "readwrite"); for (const m of ${JSON.stringify(MEETINGS)}) tx.objectStore("meetings").put(m); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); };
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

  // Old numbering would leave stale files behind.
  for (const f of readdirSync(OUT)) if (/^screenshot-\d+-.*\.png$/.test(f)) rmSync(path.join(OUT, f));

  // 1. Today: the daily brief, time blocks and today's focus
  await open("today");
  await sleep(600);
  await shot(1, "today");

  // 2. Ask ProdLi, over Today
  await p.eval(`window.dispatchEvent(new CustomEvent("prodli-ask", { detail: { question: ${JSON.stringify(ASK_QUESTION)} } }))`);
  await sleep(1800);
  await shot(2, "ask");

  // 3. Meetings
  await open("meetings");
  // Show the meeting's notes, not the setup panel (open until the recorder is turned on).
  await p.eval(`(() => { if (document.body.innerText.includes("AI SUMMARIES") || document.body.innerText.includes("AI summaries")) [...document.querySelectorAll("button")].find((b) => /setup/i.test(b.textContent))?.click(); })()`);
  await sleep(500);
  await shot(3, "meetings");

  // 4. Notes
  await open("editor");
  await p.eval(`document.activeElement?.blur?.()`);
  await shot(4, "notes");

  // 5. Weekly review
  await open("review");
  await sleep(600);
  await shot(5, "review");

  // Extras (the store takes 5): To-Dos, Time Tracker, Files, Habits, Pomodoro.
  await open("todos");
  await shot(6, "todos");
  await open("tracker");
  await sleep(800);
  await shot(7, "time-tracker");
  await open("files");
  const { root } = await p.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await p.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await p.send("DOM.setFileInputFiles", { nodeId, files: [path.join(FIXTURES, "demo-roadmap.md")] });
  await sleep(800);
  await shot(8, "files");
  await open("habits");
  await shot(9, "habits");
  // 11. Today's Day view and meeting prep (scrolled to the Agenda).
  await open("today");
  await p.eval(`document.querySelector('[data-testid="agenda"]')?.scrollIntoView({ block: "start" })`);
  await sleep(600);
  await shot(11, "day-view");
  await open("pomodoro");
  await p.eval(`[...document.querySelectorAll("button")].find(b => /start/i.test(b.textContent))?.click()`);
  await sleep(2500);
  await shot(10, "pomodoro");
} finally {
  browser.close();
  api.close();
}
