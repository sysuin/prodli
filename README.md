# ProdLi

All-in-one productivity workspace that lives in your Chrome new tab: a rich notes editor (checklists, tables, `/` commands), to-dos, Pomodoro, habits, time tracking, AI meeting notes for Google Meet, a file previewer, and optional Google sign-in with backup to your own Google Drive.

- Chrome Web Store: https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp
- Website: https://prodli.com

## What's in this repo

| Folder | What it is | Hosted at |
|---|---|---|
| `artifacts/prodli` | The Chrome extension (React + Vite). The same code also builds a web preview. | Chrome Web Store; preview at `prodli.com/extension/` |
| `artifacts/prodli-site` | Marketing website and privacy policy | `prodli.com` |
| `scripts/build-web.mjs` | Builds the website + preview into `site-dist/` | — |
| `.github/workflows` | CI (tests on every push) and website deploy | GitHub Actions |
| `TODO.md` | What's next | — |

## Setup

Requirements: Node.js 22+, pnpm (`corepack enable` picks the right version from `package.json`), Google Chrome for the browser tests.

```bash
pnpm install
```

## Everyday commands (run from the repo root)

| Command | What it does |
|---|---|
| `pnpm run build:extension` | Builds the extension for your own testing into `artifacts/prodli/dist-extension/` (account server from `.env.local`) |
| `pnpm run build:extension:store` | Builds the Web Store version against https://app.prodli.com into `prodli-extension-store.zip` (doesn't touch `dist-extension/`) |
| `pnpm run dev:extension` | Web preview of the new tab at http://localhost:5173/extension/ (hot reload) |
| `pnpm run dev:site` | Website at http://localhost:5174 |
| `pnpm run build:web` | Builds the website + preview into `site-dist/` (what gets deployed) |
| `pnpm run typecheck` | TypeScript checks for both apps |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Builds the extension and drives it in a throwaway headless Chrome |

### Try the extension locally

1. `pnpm run build:extension`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose `artifacts/prodli/dist-extension`.
3. After code changes, rebuild and click the reload icon on the ProdLi card.

### Release a new version

1. Bump `version` in `artifacts/prodli/extension/manifest.json`.
2. `pnpm run build:extension:store` → `prodli-extension-store.zip` (production server, Google sign-in from `.env.local`).
3. Upload that zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). See `STORE_SUBMISSION.md`.

## Hosting & cost

Everything runs on free tiers. See [docs/MOVING-OFF-REPLIT.md](docs/MOVING-OFF-REPLIT.md) for the one-time setup and [docs/COSTS.md](docs/COSTS.md) for the full cost plan.

| Piece | Where | Cost |
|---|---|---|
| Code + CI | GitHub (private repo) + GitHub Actions | Free |
| Website + live preview | Cloudflare Pages | Free |
| Extension | Chrome Web Store | One-time $5 (already paid) |
| AI meeting notes | Each user's own Claude API key (Claude Haiku 5.5) | $0 to you |
| Sign in with Google + backup | Chrome identity API + the user's own Google Drive (app-data folder) | Free |
| Domain | prodli.com | ~$10–15/year (only unavoidable cost) |

## Privacy model

All data stays in the user's browser (`chrome.storage.local` + IndexedDB). The only network calls are optional: Anthropic's API for meeting summaries (with the user's own key), and Google sign-in / Drive backup to the user's own Drive. Setup for Google sign-in: [docs/GOOGLE-SIGN-IN.md](docs/GOOGLE-SIGN-IN.md).
