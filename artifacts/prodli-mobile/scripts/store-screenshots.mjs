#!/usr/bin/env node
// App Store and Google Play screenshots of the phone app, with demo content and
// no real account: builds the app's web version (same screens as iOS and
// Android) against the local stand-in server from the browser tests, signs in
// there, and captures each screen at the stores' sizes.
//
//   node scripts/store-screenshots.mjs            (from artifacts/prodli-mobile)
//   E2E_SKIP_BUILD=1 node scripts/store-screenshots.mjs   reuse dist-web
//
// Output: store-assets/ios/NN-name.png (1320×2868, iPhone 6.9"),
//         store-assets/android/NN-name.png (1080×2400),
//         store-assets/feature-graphic.png (1024×500, Google Play).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, sleep } from "../tests/e2e/cdp.mjs";
import { startServer } from "../tests/e2e/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const PORT = 8799; // the same as the browser tests, so their web build can be reused
const DIST = path.join(pkg, "dist-web");
const OUT = path.join(pkg, "store-assets");

if (!process.env.E2E_SKIP_BUILD || !existsSync(DIST)) {
  console.log("Building the web version…");
  execFileSync("pnpm", ["exec", "expo", "export", "--platform", "web", "--output-dir", "dist-web"], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1", PRODLI_API: `http://localhost:${PORT}` } });
}

// ── Demo content ─────────────────────────────────────────────────────────────
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return dayKey(d);
};
// Screenshots show a morning: the page's clock is pinned to 9:12 today.
const FAKE = (() => {
  const d = new Date();
  d.setHours(9, 12, 0, 0);
  return d.getTime();
})();
const now = FAKE;
const pinClock = `(() => { const Real = Date; const offset = ${FAKE} - Real.now(); class Pinned extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); } static now() { return Real.now() + offset; } } globalThis.Date = Pinned; })();`;
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const today = day(0);
const monday = (() => {
  const d = new Date();
  d.setHours(12);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();
// The week the review screen opens on: this week from Friday on, otherwise last week.
const reviewWeek = (() => {
  const dow = new Date().getDay();
  const d = new Date(monday);
  if (!(dow === 0 || dow >= 5)) d.setDate(d.getDate() - 7);
  return dayKey(d);
})();

const T = (id, title, extra = {}) => ({ id, title, completed: false, subtasks: [], createdAt: iso(3000), updatedAt: iso(60), ...extra });
const todos = [
  T("t1", "Finish the investor update", { priority: "high", plannedFor: today, dueTime: "11:00", dueDate: today, listId: "work", subtasks: [{ id: "s1", title: "Metrics slide", completed: true }, { id: "s2", title: "Hiring plan", completed: false }] }),
  T("t2", "Send beta invites", { priority: "high", plannedFor: today, listId: "work", labels: ["launch"] }),
  T("t3", "Call the dentist", { dueDate: today, dueTime: "16:30", labels: ["calls"] }),
  T("t4", "Review Priya's design doc", { dueDate: day(1), priority: "medium", listId: "work" }),
  T("t5", "Gym", { dueDate: today, repeat: { unit: "week", every: 1, weekdays: [1, 3, 5] } }),
  T("t6", "Plan Q1 roadmap", { dueDate: day(5), priority: "high", listId: "work" }),
  T("t7", "Book flights for the offsite", { dueDate: day(3) }),
  T("t8", "Read “Deep Work”", {}),
  T("t9", "Weekly 1:1 notes", { completed: true, completedAt: iso(90) }),
  T("t10", "Update the store listing", { completed: true, completedAt: iso(240) }),
];
// This week's history, so the weekly review's counters match its text: 14 done, 9 focus sessions.
const sinceMonday = Math.round((new Date(FAKE).setHours(12) - monday.getTime()) / 86_400_000);
const atWeekDay = (i, hour) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + (i % (sinceMonday + 1)));
  d.setHours(hour, 0, 0, 0);
  return new Date(Math.min(d.getTime(), FAKE - 60_000)).toISOString();
};
const DONE = ["Design sign-off", "Fix the login bug", "Prepare the board slides", "Interview: frontend candidate", "Reply to the press request", "Renew the domain", "Team lunch booking", "Write the release notes", "Pay the electricity bill", "Order a new monitor cable", "Draft the beta FAQ", "Clean up the backlog"];
todos.push(...DONE.map((title, i) => T(`d${i}`, title, { completed: true, completedAt: atWeekDay(i, 10 + (i % 6)), createdAt: atWeekDay(i, 8) })));
const sessions = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: i % 2 ? "Investor update" : "Deep work", completedAt: atWeekDay(i, 9 + (i % 4)), duration: 25 }));
const lists = [
  { id: "work", kind: "list", name: "Work", emoji: "💼", createdAt: iso(9000) },
  { id: "home", kind: "list", name: "Home", emoji: "🏡", createdAt: iso(9000) },
];
const doneDays = (n, skip = []) => Array.from({ length: n }, (_, i) => day(-i)).filter((d, i) => !skip.includes(i));
const habits = [
  { id: "h1", name: "Read 20 minutes", emoji: "📚", color: "#FFD700", kind: "timed", target: 20, log: Object.fromEntries(doneDays(12, [0]).map((d) => [d, 20])), completedDays: doneDays(12, [0]), createdAt: iso(30 * 1440), archived: false },
  { id: "h2", name: "Drink water", emoji: "💧", color: "#00BCD4", kind: "count", target: 8, unit: "glasses", log: { ...Object.fromEntries(doneDays(9).map((d) => [d, 8])), [today]: 5 }, completedDays: doneDays(9, [0]), createdAt: iso(30 * 1440), archived: false },
  { id: "h3", name: "Meditate", emoji: "🧘", color: "#66BB6A", completedDays: doneDays(21), createdAt: iso(40 * 1440), archived: false },
  // Mon/Wed/Fri only: done on every scheduled day of the last four weeks except one.
  { id: "h4", name: "Workout", emoji: "💪", color: "#FF6B6B", days: [1, 3, 5], completedDays: Array.from({ length: 28 }, (_, i) => i).filter((i) => [1, 3, 5].includes(new Date(new Date(FAKE).setDate(new Date(FAKE).getDate() - i)).getDay())).slice(0, -1).map((i) => day(-i)), createdAt: iso(40 * 1440), archived: false },
];
const note = (id, title, content, minutesAgo, extra = {}) => ({ id, title, content, createdAt: iso(minutesAgo + 1440), updatedAt: iso(minutesAgo), autoTitle: false, ...extra });
const notes = [
  note("n1", "Product launch plan", '<h1>Product launch plan</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Final design review</p></li><li data-type="taskItem" data-checked="false"><p>Record the demo video</p></li></ul>', 25, { pinned: true }),
  note("n2", "Ideas for the offsite", "<p>Morning: retro. Afternoon: roadmap. Dinner by the lake.</p>", 180),
  note("n3", "Reading list", "<ul><li><p>Deep Work</p></li><li><p>The Pragmatic Programmer</p></li><li><p>Make Time</p></li></ul>", 60 * 26),
  note("n4", "Daily note · today", "<h1>Today</h1><p>Main focus: the investor update.</p>", 60 * 3),
  note("n5", "Recipes", "<p>Lemon pasta: lemons, parmesan, butter, black pepper.</p>", 60 * 70),
];
const meeting = {
  id: "m1", platform: "google-meet", title: "Weekly product sync", meetingCode: null, url: "", startedAt: iso(150), endedAt: iso(105), durationSec: 2700, status: "ready",
  transcript: [
    { id: "e1", speaker: "Priya", text: "Design is signed off; the last screens went out yesterday.", startMs: 12_000, endMs: 18_000 },
    { id: "e2", speaker: "Sam", text: "Then let's ship the beta on Friday and invite the first 200 testers.", startMs: 21_000, endMs: 27_000 },
    { id: "e3", speaker: "Alex", text: "I'll have the onboarding emails ready by Thursday.", startMs: 30_000, endMs: 34_000 },
  ],
  summary: {
    title: "Weekly product sync: beta on Friday",
    overview: "Design is signed off and the team agreed to ship the beta on Friday to the first 200 testers. Onboarding emails are due Thursday; pricing stays as is for the beta.",
    keyPoints: ["Final screens delivered", "Scope is frozen for the beta", "Support rota starts next week"],
    decisions: ["Ship the beta on Friday", "Keep pricing unchanged during the beta"],
    actionItems: [
      { task: "Send beta invites", owner: "Sam", dueDate: null, priority: "high" },
      { task: "Write the onboarding emails", owner: "Alex", dueDate: "Thursday", priority: "medium" },
      { task: "Set up the support rota", owner: "Priya", dueDate: null, priority: "low" },
    ],
    openQuestions: ["Do we need a waitlist page?"],
    model: "demo", generatedAt: iso(100),
  },
  error: null, notice: null, hasAudio: false, micIncluded: true, audioMimeType: null, updatedAt: iso(100),
};
const brief = {
  headline: "Finish the investor update before your 2 pm sync",
  summary: "Two high-priority tasks today and a free morning — protect it for the update.",
  priorities: [
    { title: "Finish the investor update", reason: "Due at 11, and the hiring plan is still open" },
    { title: "Send beta invites", reason: "Agreed in yesterday's sync — testers are waiting" },
    { title: "Call the dentist", reason: "Quick win before 4:30" },
  ],
  schedule: [], watchouts: ["Back-to-back meetings from 2 pm"], habits: [], tip: "Start a 25-minute Pomodoro before opening email.",
  model: "demo", generatedAt: iso(30), source: "ai",
};
const review = {
  headline: "A focused week with the launch on track",
  summary: "You finished 14 tasks and logged 9 focus sessions, and your meditation streak reached 21 days. A few things for today are still open.",
  wins: ["Shipped the design sign-off", "21-day meditation streak", "9 focus sessions (3.8 h)"],
  slipped: [{ title: "Book flights for the offsite", suggestion: "Do it Monday morning; prices go up after Wednesday." }],
  patterns: ["Tuesday was your most productive day", "Afternoons with meetings had little focus time"],
  nextWeek: [
    { title: "Ship the beta on Friday", reason: "The team's main goal" },
    { title: "Plan Q1 roadmap", reason: "Due next week and high priority" },
    { title: "Book flights for the offsite", reason: "Slipped this week" },
  ],
  habitTip: "Workout was the hardest to keep — book it in your calendar like a meeting.",
  question: "What will you say no to next week?",
  model: "demo", generatedAt: iso(200), source: "ai",
};
const days = [{ id: today, focus: "Investor update out by 11", brief, createdAt: iso(300), updatedAt: iso(30) }, { id: reviewWeek, review, createdAt: iso(3000), updatedAt: iso(200) }];
const DEMO = {
  mobileWelcomed: true,
  mobileTheme: "light",
  prodliAccount: { id: "11111111-2222-3333-4444-555555555555", email: "dev@example.com", name: "Dev", picture: null, plan: "free", createdAt: now },
  todos, lists, habits, notes, meetings: [meeting], days,
  pomodoroSessions: sessions,
  completedPomodoros: 128,
};

const SCREENS = [
  ["01-today", "/", async () => {}],
  ["02-todos", "/todos", async (p) => p.tap("All")],
  ["03-meeting", "/meetings/m1", async () => {}],
  [
    "04-ask",
    "/ask",
    async (p) => {
      await p.type("Ask anything", "What should I focus on before lunch?", { enter: true });
      await p.waitForText("If there's time");
      await p.type("Ask anything", "What did we decide in the product sync?", { enter: true });
      await p.waitForText("keep pricing unchanged");
    },
  ],
  ["05-habits", "/habits", async () => {}],
  ["06-review", "/review", async () => {}],
];
const DEVICES = [
  { dir: "ios", width: 440, height: 956, scale: 3 }, // 1320×2868
  { dir: "android", width: 360, height: 800, scale: 3 }, // 1080×2400
];

const server = await startServer({ root: DIST, port: PORT });
const browser = new Browser();
try {
  for (const dev of DEVICES) {
    mkdirSync(path.join(OUT, dev.dir), { recursive: true });
    const page = await browser.openPage("about:blank", dev);
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: pinClock });
    await page.navigate(`${server.url}/settings`);
    await page.eval(`(() => { localStorage.clear(); sessionStorage.setItem("prodliSessionToken", "pls_test"); const d = ${JSON.stringify(DEMO)}; for (const [k, v] of Object.entries(d)) localStorage.setItem("prodli:" + k, JSON.stringify(v)); })()`);
    for (const [name, route, act] of SCREENS) {
      await page.navigate(`${server.url}${route}`);
      await act(page);
      await sleep(700);
      await page.eval("window.scrollTo(0, 0)");
      await page.shot(path.join(OUT, dev.dir, `${name}.png`));
      console.log(`  ${dev.dir}/${name}.png`);
    }
  }

  // Google Play feature graphic: the mark, the name and the line.
  const fg = await browser.openPage("about:blank", { width: 1024, height: 500, scale: 1 }).catch(() => null);
  const page = fg ?? (await browser.openPage(server.url, { width: 1024, height: 500, scale: 1 }));
  const sq = (x, y, c) => `<div style="position:absolute;left:${x}px;top:${y}px;width:116px;height:116px;background:${c}"></div>`;
  const html = `<html><head><meta charset="utf-8"></head><body style="margin:0;width:1024px;height:500px;background:#EDE1CF;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box">
    <div style="position:relative;width:256px;height:256px;background:#000;flex-shrink:0;box-shadow:12px 12px 0 #000">${sq(8, 8, "#FFD700")}${sq(132, 8, "#00BCD4")}${sq(8, 132, "#FF6B6B")}${sq(132, 132, "#66BB6A")}</div>
    <div><div style="display:inline-block;background:#FFD700;border:4px solid #000;font-weight:900;font-size:72px;padding:4px 22px;letter-spacing:-2px">ProdLi</div>
    <div style="font-weight:900;font-size:46px;margin-top:22px;letter-spacing:-1px;color:#231E1A">Your day, planned.</div>
    <div style="font-size:26px;margin-top:10px;color:#564C43">To-dos · Notes · Habits · AI meeting notes</div></div></body></html>`;
  await page.send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
  await sleep(800);
  await page.shot(path.join(OUT, "feature-graphic.png"));
  console.log("  feature-graphic.png");
} finally {
  browser.close();
  server.close();
}
