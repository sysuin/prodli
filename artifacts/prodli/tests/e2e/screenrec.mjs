// End-to-end tests for 🎥 Record a video (the Loom-style screen recorder):
// Chrome's fake camera, microphone and screen stand in for real ones. Records
// screen + camera bubble (drawn into the video), pauses, saves a seekable
// video to Meetings, transcribes it (stand-in), opens it in Meetings, records
// camera only, and discards one.
//
//   pnpm run build:extension:test && node tests/e2e/screenrec.mjs

process.env.PRODLI_CHROME_ARGS = [process.env.PRODLI_CHROME_ARGS, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"].filter(Boolean).join(" ");
const { Browser, sleep } = await import("./cdp.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const readMeetings = (p) =>
  p.eval(`new Promise((res) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("meetings").objectStore("meetings").getAll(); q.onsuccess = () => res(q.result.map((m) => ({ id: m.id, title: m.title, platform: m.platform, hasVideo: m.hasVideo, status: m.status, mime: m.audioMimeType, durationSec: m.durationSec, transcript: m.transcript.map((e) => e.text) }))); }; })`);
const videoSize = (p, id) => p.eval(`new Promise((res) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("audio").objectStore("audio").get(${JSON.stringify(id)}); q.onsuccess = () => res(q.result ? q.result.size : -1); }; })`);

const b = new Browser();
try {
  await b.loadExtension();
  console.log("screen recorder");
  const p = await b.openPage();
  await p.goto("meetings");
  check("Meetings has 🎥 Record screen", await p.eval(`!!document.querySelector('[data-testid="record-screen"]')`));

  const openRecorder = async (prefs) => {
    await p.eval(`chrome.storage.local.set({ screenRecorderPrefs: ${JSON.stringify(prefs)} })`);
    await p.send("Page.navigate", { url: `chrome-extension://${b.extId}/index.html#record` });
    await sleep(300);
    await p.send("Page.reload", {});
    for (let i = 0; i < 30 && !(await p.eval(`!!document.querySelector('[data-testid="record-start"]')`)); i++) await sleep(200);
    await sleep(800);
  };
  const waitFor = async (expr, ms = 8000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await p.eval(expr)) return true;
      await sleep(200);
    }
    return false;
  };

  // Screen + camera, the bubble drawn into the video.
  await openRecorder({ mode: "screen-camera", layout: { size: "large", corner: "bottom-right", shape: "circle", visible: true }, countdown: false });
  const setup = await p.eval(`({ modes: document.querySelectorAll('[data-testid^="record-mode-"]').length, cams: document.querySelector('select[aria-label="Camera"]')?.options.length ?? 0, mics: document.querySelector('select[aria-label="Microphone"]')?.options.length ?? 0, preview: !!document.querySelector('[aria-label="Preview"] video') })`);
  check("The recorder offers three modes, the camera and microphone, and a live bubble preview", setup.modes === 3 && setup.cams >= 1 && setup.mics >= 2 && setup.preview, JSON.stringify(setup));
  await p.eval(`(() => { globalThis.__prodliForceComposite = true; globalThis.__prodliTranscribeStub = async () => ({ text: "Here is the new onboarding flow.", segments: [{ start: 0, end: 2, text: "Here is the new onboarding flow." }], language: "en" }); document.querySelector('[data-testid="record-start"]').click(); return true; })()`);
  const recording = await waitFor(`/recording/i.test(document.querySelector("main")?.innerText ?? "")`, 6000);
  check("Start records right away (no countdown) and shows the clock", recording);
  await sleep(2200);
  await p.eval(`document.querySelector('[data-testid="record-pause"]').click(); true`);
  await sleep(300);
  const pausedAt = await p.eval(`document.querySelector('[data-testid="record-clock"]').textContent`);
  await sleep(1500);
  const stillAt = await p.eval(`document.querySelector('[data-testid="record-clock"]').textContent`);
  check("Pause stops the clock", pausedAt === stillAt && /paused/i.test(await p.eval(`document.querySelector("main").innerText`)), `${pausedAt} → ${stillAt}`);
  await p.eval(`document.querySelector('[data-testid="record-pause"]').click(); true`);
  await sleep(1200);
  await p.eval(`document.querySelector('[data-testid="record-stop"]').click(); true`);
  const done = await waitFor(`!!document.querySelector('[data-testid="record-done"]')`);
  check("Stop saves it and shows the video", done);
  const frame = await p.eval(`new Promise((r) => { const v = document.querySelector('[data-testid="record-playback"]'); v.muted = true; const go = async () => { v.currentTime = Math.min(1.5, v.duration / 2); await new Promise((s) => v.addEventListener("seeked", s, { once: true })); const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext("2d"); x.drawImage(v, 0, 0); const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data.slice(0, 3)); const s = Math.round(Math.min(c.width, c.height) * 0.33), m = Math.round(Math.min(c.width, c.height) * 0.035); const cx = c.width - m - s / 2, cy = c.height - m - s / 2; r({ d: v.duration, w: c.width, h: c.height, ring: px(Math.round(cx + s / 2 - 2), Math.round(cy)), outside: px(Math.round(cx - s / 2 - 30), Math.round(cy)) }); }; v.readyState >= 1 ? go() : v.addEventListener("loadedmetadata", go); setTimeout(() => r(null), 6000); })`);
  const white = (c) => c && c.every((v) => v > 200);
  check("The video has its length (so it can be seeked) and doesn't count the pause", !!frame && Number.isFinite(frame.d) && frame.d >= 2.5 && frame.d <= 5, JSON.stringify(frame));
  check("The camera bubble is drawn into the video, in the corner chosen", !!frame && white(frame.ring) && !white(frame.outside), JSON.stringify(frame));
  let meetings = [];
  for (let i = 0; i < 40; i++) {
    meetings = await readMeetings(p);
    if (meetings.some((m) => m.platform === "screen" && m.status === "ready")) break;
    await sleep(250);
  }
  const m = meetings.find((x) => x.platform === "screen");
  check("It's saved to Meetings as a video, transcribed", !!m && m.hasVideo === true && /^video\/webm/.test(m.mime ?? "") && m.transcript[0] === "Here is the new onboarding flow." && (await videoSize(p, m.id)) > 10_000, JSON.stringify(m));
  await p.eval(`(() => { const i = document.querySelector('[aria-label="Title"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Onboarding walkthrough"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(500);
  check("Renaming it on the done screen renames the meeting", (await readMeetings(p)).find((x) => x.id === m?.id)?.title === "Onboarding walkthrough");

  // Open in Meetings: the video plays there.
  await p.eval(`document.querySelector('[data-testid="record-open"]').click(); true`);
  await sleep(2500);
  const shown = await waitFor(`!!document.querySelector("[data-testid='meeting-video'][src^='blob:']")`, 6000);
  if (!shown) {
    const { data } = await p.send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync("/tmp/claude-0/-home-user-prodli/f05f1f1f-efa8-5aa9-8f01-386b65124f4e/scratchpad/sr/open-fail.png", Buffer.from(data, "base64"));
    console.log("    url:", await p.eval("location.href"), "section:", JSON.stringify(await p.storage(["lastSection", "openMeetingId"])));
  }
  check("Open in Meetings shows the meeting with its video player and Download", shown && (await p.eval(`/download video/i.test(document.body.innerText) && /onboarding walkthrough/i.test(document.body.innerText)`)));

  // Camera only.
  await openRecorder({ mode: "camera", layout: { size: "medium", corner: "bottom-left", shape: "circle", visible: true }, countdown: false });
  await p.eval(`document.querySelector('[data-testid="record-start"]').click(); true`);
  await waitFor(`/recording/i.test(document.querySelector("main")?.innerText ?? "")`, 6000);
  await sleep(2000);
  await p.eval(`document.querySelector('[data-testid="record-stop"]').click(); true`);
  await waitFor(`!!document.querySelector('[data-testid="record-done"]')`);
  const cam = await p.eval(`new Promise((r) => { const v = document.querySelector('[data-testid="record-playback"]'); const f = () => r({ w: v.videoWidth, h: v.videoHeight, d: v.duration }); v.readyState >= 1 ? f() : v.addEventListener("loadedmetadata", f); setTimeout(() => r(null), 4000); })`);
  check("Camera only records the camera", !!cam && cam.w > 0 && cam.w < 1920 && Number.isFinite(cam.d), JSON.stringify(cam));

  // Discard keeps nothing.
  const before = (await readMeetings(p)).length;
  await openRecorder({ mode: "screen", layout: { size: "medium", corner: "bottom-left", shape: "circle", visible: true }, countdown: false });
  await p.eval(`document.querySelector('[data-testid="record-start"]').click(); true`);
  await waitFor(`/recording/i.test(document.querySelector("main")?.innerText ?? "")`, 6000);
  await sleep(1500);
  await p.eval(`[...document.querySelectorAll("button")].find((x) => x.textContent === "Discard").click(); true`);
  await waitFor(`!!document.querySelector('[data-testid="record-start"]')`);
  await sleep(500);
  const leftover = await p.eval(`new Promise((res) => { const r = indexedDB.open("prodli-meetings"); r.onsuccess = () => { const q = r.result.transaction("audioChunks").objectStore("audioChunks").count(); q.onsuccess = () => res(q.result); }; })`);
  check("Discard saves nothing and leaves no pieces behind", (await readMeetings(p)).length === before && leftover === 0, JSON.stringify({ before, after: (await readMeetings(p)).length, leftover }));

  const errors = b.jsErrors();
  check("No script errors", errors.length === 0, JSON.stringify(errors.slice(0, 2)));
} catch (err) {
  failures++;
  console.error(err);
} finally {
  b.close();
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
