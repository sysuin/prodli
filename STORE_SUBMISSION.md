# ProdLi — Chrome Web Store Submission Checklist

## Quick Start

1. Run `pnpm build:extension` from `artifacts/prodli/` to produce `prodli-extension.zip`
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
| Small Promo Tile | `store-assets/promo-440x280.jpg` | 440×280 | ✅ Ready |
| Large Promo Tile | _(optional)_ | 920×680 | ⬜ Not required for launch |
| Marquee Promo | _(optional)_ | 1400×560 | ⬜ Not required for launch |

> **Note:** The Chrome Web Store requires screenshots as JPEG or PNG. The files above are saved as JPEG and can be uploaded directly.

---

## Listing Copy

**Name:** ProdLi — Productivity New Tab

**Short description (max 132 chars):**
> Your distraction-free new tab hub. Editor, To-Dos, Pomodoro, and Habit Tracker in one Neobrutalist interface.

**Detailed description:**
```
ProdLi replaces your new tab with a focused, four-quadrant productivity workspace — no account, no cloud, no distractions.

✏️ EDITOR
Rich-text notes with font picker, multiple note management, fullscreen focus mode, and full-text search across title and body.

✅ TO-DOS
Task management with priority levels, due dates, and subtasks. Drag to reorder. Filter by status or priority.

🍅 POMODORO
Configurable focus timer that keeps running even when you switch tabs. Receive browser notifications on session completion.

🎯 HABITS
Daily habit check-ins with automatic streak tracking and a visual heatmap calendar — stay consistent effortlessly.

DESIGN
Neobrutal design with Light and Dark themes. All data stays on your device via localStorage — private by default.

PERMISSIONS
• storage — to sync settings across browser profiles (optional)
• notifications — to alert you when a Pomodoro session ends
```

**Category:** Productivity

**Language:** English

---

## Privacy & Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Sync app data across browser profiles (optional) |
| `notifications` | Pomodoro session-complete desktop alerts |

**Privacy policy:** No data is collected, transmitted, or stored on external servers. All data lives in the browser's localStorage / chrome.storage.local.

---

## Pre-submission Checklist

- [ ] Developer account created and one-time $5 registration fee paid
- [ ] Extension zip uploaded successfully (no manifest errors)
- [ ] At least 1 screenshot uploaded (screenshot-1280x800.jpg)
- [ ] Promo tile uploaded (promo-440x280.jpg)
- [ ] Short description filled in (≤ 132 chars)
- [ ] Detailed description filled in
- [ ] Category set to **Productivity**
- [ ] Privacy practices form completed (no user data collected)
- [ ] Justification provided for `notifications` permission
- [ ] Submitted for review (typically 1–3 business days)

---

## Rebuilding After Changes

```bash
cd artifacts/prodli
pnpm build:extension
# → prodli-extension.zip at workspace root
```

Bump the `version` field in `artifacts/prodli/extension/manifest.json` before each new submission.
