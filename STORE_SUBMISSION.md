# ProdLi — Chrome Web Store Submission Checklist

## Quick Start

1. Run `pnpm run build:extension` from the repo root (or download `prodli-extension.zip` from the latest CI run)
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Click **New Item** → upload `prodli-extension.zip`
4. Fill in the listing fields below
5. Upload store assets from `artifacts/prodli/store-assets/`

---

## Extension Package

| File | Status |
|------|--------|
| `prodli-extension.zip` | ✅ Generated at workspace root |
| `manifest.json` (MV3) | ✅ Included |
| `index.html` (new tab override) | ✅ Included |
| `icons/icon-16.png` | ✅ Included |
| `icons/icon-48.png` | ✅ Included |
| `icons/icon-128.png` | ✅ Included |
| All assets bundled (no CDN calls) | ✅ Fonts + JS/CSS self-hosted |

---

## Store Assets

| Asset | File | Required Size | Status |
|-------|------|---------------|--------|
| Screenshot | `store-assets/screenshot-1280x800.jpg` | 1280×800 | ✅ Ready |
| Small Promo Tile | `store-assets/promo-440x280.png` | 440×280 | ✅ Ready |
| Large Promo Tile | _(optional)_ | 920×680 | ⬜ Not required for launch |
| Marquee Promo | _(optional)_ | 1400×560 | ⬜ Not required for launch |

> **Note:** The Chrome Web Store accepts screenshots as JPEG or PNG. The screenshot is JPEG; the promo tile is PNG. Both can be uploaded directly.

---

## Listing Copy

**Name:** ProdLi — Productivity New Tab

**Short description (max 132 chars):**
> New tab workspace: rich-text editor, to-dos, Pomodoro, habits, and automatic time tracker. No account needed.

**Detailed description:**
```
ProdLi replaces your new tab with a focused, five-tool productivity workspace — no account, no cloud, no distractions. Everything stays on your device.

✏️ EDITOR
Rich-text notes with font picker, multiple note management, fullscreen focus mode, and full-text search across title and body.

✅ TO-DOS
Task management with priority levels, due dates, and subtasks. Drag to reorder. Filter by status or priority.

🍅 POMODORO
Configurable focus timer that keeps running even when you switch tabs. Receive browser notifications on session completion.

🎯 HABITS
Daily habit check-ins with automatic streak tracking and a visual heatmap calendar — stay consistent effortlessly.

⏱ TIME TRACKER
Automatically records time spent on every website you visit. Review today's usage, explore all-time history with interactive charts, and compare two date ranges side by side. Set daily time limits per site — when a limit is reached you get a desktop notification, and you can optionally enable an auto-redirect back to your new tab page. Block specific domains from being tracked entirely.

DESIGN
Neobrutal design with Light and Dark themes. All data is stored locally in your browser — private by default, never transmitted anywhere.

PERMISSIONS
• storage — saves your notes, tasks, habits, settings, and time-tracking data locally in your browser
• notifications — alerts you when a Pomodoro session ends or a daily site time limit is reached
• tabs — reads the active tab's URL (hostname only) to record browsing time per domain; no page content or full URLs are ever stored
• idle — detects when you step away so the tracker pauses instead of logging inactive time
• alarms — schedules the daily summary notification, the per-minute tracking heartbeat, Pomodoro phase endings and the daily Google Drive backup
• unlimitedStorage — lets notes, meeting transcripts and recordings grow beyond the default browser storage limit, so saving never fails silently
• identity — optional "Sign in with Google" to back up to the user's own Google Drive app-data folder (only when the user chooses to sign in)
• Optional (requested only when the user turns a feature on): tabCapture + offscreen + meet.google.com (meeting recorder: captures the Meet tab's audio and reads its captions); scripting + site access (Focus List auto-redirect)
```

**Category:** Productivity

**Language:** English

---

## Privacy & Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Persists notes, tasks, habits, Pomodoro settings, and time-tracking data in `chrome.storage.local`. Nothing leaves the device. |
| `notifications` | Shows a desktop alert when a Pomodoro session ends or a daily site time limit is reached. |
| `tabs` | Reads the hostname (domain) of the active tab to accumulate browsing time. The full URL and page content are never accessed or stored — only the `hostname` field of the URL is used. |
| `idle` | Detects when the user is inactive so that idle time is not counted toward a site's tracked total. |
| `alarms` | Powers the per-minute heartbeat that flushes in-memory time to storage, and schedules the optional daily summary notification. |
| `scripting` _(optional)_ | Only requested if the user explicitly enables "auto-redirect" for a Focus List rule. Used to navigate the active tab away from a site when its daily limit is reached. |
| `<all_urls>` _(optional host permission)_ | Required by `scripting` for the redirect feature above. Only granted if the user explicitly enables it. |

**What data is stored and where:**
- **Time-tracking data** — hostname + seconds per day — stored in `chrome.storage.local` under per-day keys (`tt_YYYY-MM-DD`). Never transmitted.
- **Settings** — idle threshold, notification time, Focus List rules, blocked domains — stored in `chrome.storage.local` under `tt_settings`. Never transmitted.
- **All other app data** (notes, tasks, habits, Pomodoro state) — stored in `chrome.storage.local` with a `prodli_` prefix. Never transmitted.

---

## Privacy Form (Chrome Web Store)

Copy and paste each answer directly into the Privacy tab of the Developer Dashboard.

### Single purpose description
> ProdLi replaces the browser's new tab page with a focused productivity workspace containing five tools: a rich-text editor, a to-do list, a Pomodoro timer, a habit tracker, and an automatic time tracker. All data — including browsing time per domain — is stored locally on the user's device in chrome.storage.local. No data is transmitted to any external server.

### Permission justification — `storage`
> The storage permission is used to persist the user's notes, tasks, Pomodoro settings, habit records, time-tracking data, and Focus List configuration in chrome.storage.local so that data is retained across browser sessions. No data is sent to any external server.

### Permission justification — `notifications`
> The notifications permission is used to display a desktop notification when (a) a Pomodoro focus session or break ends, and (b) the user has reached their self-configured daily time limit for a website. Notifications are triggered only by local timers and only when relevant activity is detected.

### Permission justification — `tabs`
> The tabs permission is used solely to read the hostname of the currently active tab so that the time tracker can accumulate browsing time per domain. Only the `hostname` portion of the URL is ever read or stored — the full URL, page title, and page content are never accessed. The tracked data (domain + seconds) is stored locally in chrome.storage.local and is never transmitted.

### Permission justification — `idle`
> The idle permission is used to detect when the user has been inactive for a configurable threshold (default 60 seconds). When the browser is idle, the time tracker pauses so that inactive time is not incorrectly attributed to the last visited site.

### Permission justification — `alarms`
> The alarms permission is used to schedule a per-minute heartbeat that flushes in-memory browsing time to persistent storage, ensuring data is not lost if the browser closes unexpectedly. It is also used to schedule the user's optional daily summary notification at their chosen time.

### Remote code
**Select:** No, I am not using remote code

> All JavaScript, CSS, and font files are bundled into the extension package at build time using Vite. There are no references to external scripts, no CDN links, and no use of eval() or similar dynamic code execution. The extension operates entirely offline.

---

## Pre-submission Checklist

- [ ] Developer account created and one-time $5 registration fee paid
- [ ] Extension zip rebuilt after latest changes (`pnpm build:extension`)
- [ ] Extension zip uploaded successfully (no manifest errors reported by dashboard)
- [ ] At least 1 screenshot uploaded (`store-assets/screenshot-1280x800.jpg`)
- [ ] Promo tile uploaded (`store-assets/promo-440x280.png`)
- [ ] Short description filled in (≤ 132 chars) — verify char count before pasting
- [ ] Detailed description filled in (all five tools listed)
- [ ] Category set to **Productivity**
- [ ] Privacy practices form completed — browsing history data declared as local-only
- [ ] Justification provided for all five core permissions
- [ ] `scripting` and `<all_urls>` listed as optional with reason
- [ ] Remote code answer set to **No**
- [ ] Submitted for review (typically 1–3 business days)

---

## Rebuilding After Changes

```bash
cd artifacts/prodli
pnpm build:extension
# → prodli-extension.zip at workspace root
```

Bump the `version` field in `artifacts/prodli/extension/manifest.json` before each new submission to the store.
