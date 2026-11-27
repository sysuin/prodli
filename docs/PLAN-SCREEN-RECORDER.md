# Screen recorder (Loom-style) — plan

**Decided 2026-11-27 by you:** build it with share links hosted on ProdLi (Cloudflare R2), limits like Loom's (Free 25 videos / 5 min each, Pro unlimited videos up to 45 min, Pro Plus up to 2 h). Built in two phases.

## Phase 1 (built 2026-11-27): record, save, transcribe

- **Open it:** Meetings → 🎥 Record screen, or ⌘K "record". It's `index.html#record` (extension tab, web app tab, desktop main window): `src/screenrec/RecorderPage.tsx`.
- **Modes:** screen and camera, screen only, camera only. Pick the camera and microphone (with a level meter). The bubble comes in S/M/L, circle or rounded square, in any corner. Countdown on or off. Settings are remembered.
- **Capture** (`recorder.ts`): Chrome's own "share" dialog (`getDisplayMedia`: tab, window or entire screen, with the tab's or computer's sound). It needs no extension permission. Camera and microphone come from `getUserMedia`, and the browser asks.
- **The bubble:**
  - Recording a tab or a window: a worker (`compositor.worker.ts`) draws the camera into the video at 30 fps, with `MediaStreamTrackProcessor`/`MediaStreamTrackGenerator`. It isn't slowed down when the recorder's tab is in the background, and it redraws the last screen frame so the bubble keeps moving on a still screen.
  - Recording the entire screen: the floating Picture-in-Picture window (`floating.ts`) is on the screen, so it's in the video, like Loom's.
- **Controls:** the floating window stays on top of every app and shows the time, pause/resume, stop and hide-the-bubble. The controls appear only on hover, so they stay out of whole-screen recordings. Closing the window, or Chrome's "Stop sharing" bar, also stops the recording.
- **Saving:**
  - Pieces are stored in IndexedDB every 2 s (the meeting recorder's chunk store), so a crash keeps them. WebM is VP9/Opus, about 4 Mbit/s at 1080p (≈30 MB/min).
  - At Stop the duration is written into the file header (`webmDuration.ts`; MediaRecorder leaves it out), so the video can be seeked.
- **In Meetings** (`createScreenMeeting` in `recorder/upload.ts`): a meeting with `platform: "screen"` and `hasVideo`. The audio is transcribed and summarized like an upload (transcription minutes, then the usual summary with action items), shown in a video player, with Download.
- **Desktop app:** the system hands over the whole screen. There's no Picture-in-Picture in Electron, so the controls are in the window. On a Mac it needs Camera permission (added to the entitlements and Info.plist).
- **Tests:**
  - `tests/unit/screenrec.test.ts`: the duration patch and the layout.
  - `tests/e2e/screenrec.mjs`: Chrome's fake camera, microphone and screen. It checks the bubble in the frames, pause, seekable length, transcript, Open in Meetings, camera only and Discard.

## Phase 2 (built 2026-11-27): share links

- **Getting a link:** "Get a share link" on a video's page in Meetings and on the recorder's "Saved" screen (`screenrec/VideoShare.tsx`, `share.ts`). It shows upload progress and can be cancelled. Then the link, with Copy, Open, views and Stop sharing. When the summary arrives after sharing, the page gets it automatically.
- **Storage:** R2 bucket `VIDEOS` (`prodli-videos`, `prodli-videos-staging`; the deploy workflow creates each once; wrangler dev keeps a local one). D1 table `videos` (migration 0018): owner, recording, title, length, size, R2 key, upload state, page notes, views.
- **Upload** (`prodli-api/src/videos.ts`):
  - `POST /api/videos` checks the plan's limits, then starts an R2 multipart upload. It returns the existing link if that recording is already shared with the same file.
  - `PUT /api/videos/:id/parts/:n` takes 10 MiB parts. They must be equal size except the last, which is R2's rule. The app resumes parts already sent and retries 5xx errors.
  - `POST …/complete` finishes it with the notes and transcript. `PUT /api/videos/:id` updates the notes or title. `DELETE` removes the file and the page. Deleting the account removes all of them.
- **Page:** `GET /v/:id` shows the video, notes and transcript (unlisted, noindex, no scripts, strict CSP). `GET /v/:id/video` streams from R2 with byte ranges (206), so players can seek. `/v/*` runs the Worker first, and the web app's service worker leaves `/v/` and `/s/` alone.
- **Limits:** Free 25 videos up to 5 min each; Pro unlimited up to 45 min; Pro Plus up to 2 h. Files can be at most about 12 Mbit/s of their length. They're shown in the plan picker, the pricing page, the Terms and PRO-PLAN.md.
- **Tests:** `prodli-api/test/videos.test.ts` covers parts, completion, the page, ranges, limits, notes updates, Stop sharing and account deletion. `tests/e2e/server.mjs` "shared video" uploads from the app to the local server, opens the page, gets a 206 range, and stops sharing.
- **Later:** upload while recording (an "instant" link), view notifications, comments and reactions on the page, trim before sharing.

## Better than Loom

- Notes, action items into To-Dos, and Ask ProdLi search over every video, included in the plan (Loom's AI is $24/user/month).
- No 5-minute limit for recordings that stay on your device.
- The bubble's place, size and shape can be set before recording.
- Works in the web app and the desktop app too.
