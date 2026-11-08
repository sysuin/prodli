# ProdLi

All-in-one productivity workspace that lives in your Chrome new tab: notes, to-dos, Pomodoro, habits, time tracking, AI meeting notes for Google Meet, and a file previewer.

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
| `pnpm run build:extension` | Builds the extension into `artifacts/prodli/dist-extension/` and `prodli-extension.zip` |
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
2. Push — CI attaches `prodli-extension.zip` to the run (Actions → the run → Artifacts). Or build it locally.
3. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). See `STORE_SUBMISSION.md`.

## Hosting & cost

Everything runs on free tiers. See [docs/MOVING-OFF-REPLIT.md](docs/MOVING-OFF-REPLIT.md) for the one-time setup and [docs/COSTS.md](docs/COSTS.md) for the full cost plan.

| Piece | Where | Cost |
|---|---|---|
| Code + CI | GitHub (private repo) + GitHub Actions | Free |
| Website + live preview | Cloudflare Pages | Free |
| Extension | Chrome Web Store | One-time $5 (already paid) |
| AI meeting notes | Each user's own Claude API key (Claude Haiku 5.5) | $0 to you |
| Domain | prodli.com | ~$10–15/year (only unavoidable cost) |

## Privacy model

All data stays in the user's browser (`chrome.storage.local` + IndexedDB). The only network calls are to Anthropic's API for meeting summaries, made with the user's own key, and only when they've added one.
