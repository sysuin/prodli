# ProdLi — guide for Claude sessions

ProdLi is an AI meeting-notes and daily-planner product: a Chrome extension (new tab + meeting recorder), a web app at app.prodli.com, a desktop app (Electron) and a phone app (Expo). One owner, building features people pay for. What's open and what's done: [TODO.md](TODO.md).

## Repository

| Folder | What | Notes |
|---|---|---|
| `artifacts/prodli` | Extension **and** web app (React/Vite, Tiptap notes) | `vite.extension.config.ts` builds the extension; the same app is the web app and runs inside the desktop app |
| `artifacts/prodli-api` | Cloudflare Worker (Hono, D1, Durable Objects, Workers AI Whisper, Claude Haiku 5.5) | Also serves the built web app at app.prodli.com. Billing: Dodo Payments (`src/billing.ts`, docs/PRO-PLAN.md) |
| `artifacts/prodli-site` | prodli.com (marketing, Privacy & Terms, Compare) | Deploys by itself when main changes |
| `artifacts/prodli-desktop` | Electron app (Mac + Windows) | docs/DESKTOP.md |
| `artifacts/prodli-mobile` | Expo app (iOS + Android) | Imports pure logic from `artifacts/prodli/src` via `src/shared`; docs/MOBILE.md |

## Commands (repo root)

- `pnpm install --frozen-lockfile` (pnpm only; version pinned in package.json)
- `pnpm run typecheck` · `pnpm test` (every package)
- End-to-end, extension: `pnpm --filter @workspace/prodli run build:extension:test`, then `node artifacts/prodli/tests/e2e/run.mjs [suite,suite]` (suite names are the keys in `run.mjs`), plus the separate files `recording.mjs`, `localfiles.mjs`, `dictation.mjs`, `snippets.mjs`, `languages.mjs`, `screenshot.mjs`. All of them: `pnpm test:e2e`.
- End-to-end, accounts and billing against a local API: `pnpm test:e2e:server` (wrangler dev + a stand-in for Dodo).
- On Linux (cloud), run Chrome-based tests with `CI=1` (adds `--no-sandbox`) and `CHROME_PATH` if Chrome isn't at `/usr/bin/google-chrome`.
- Desktop: `pnpm --filter @workspace/prodli-desktop test`. Phone: `pnpm --filter @workspace/prodli-mobile typecheck`, `test`, `export:check`.

## How the owner wants work done

- **Batch related changes on one branch, one PR per batch** (one commit per change). Urgent fixes (a broken build, legal wording) get their own small PR. Each CI run takes about 15–18 minutes and Actions minutes are limited.
- **Run the unit tests and the affected e2e suites before opening a PR.** Run the full `test:e2e` (and `test:e2e:server` for billing/accounts changes) before big merges.
- **Merge after CI without asking**, but only when CI actually passed: `if gh pr checks N --watch --fail-fast; then gh pr merge N --merge; else echo "CI FAILED - NOT MERGED"; fi`. Never merge a red PR. (On the owner's Mac, `gh auth switch -u sysuin` first.)
- **Always ask first** before: deploying production, uploading to the Chrome Web Store, changing Dodo/billing settings or prices, changing Google Cloud settings, or publishing anything outside the normal merge → deploy flow. An explicit "deploy" in the request counts as the yes.
- Keep TODO.md current: tick items with a short dated "done" note in the existing style; add new open items where they belong.
- Write UI text, docs and messages plainly and briefly.

## Deploys

- **Website and staging API:** automatic on every push to main (`.github/workflows/deploy.yml`).
- **Production API + web app (app.prodli.com):** GitHub → Actions → Deploy → Run workflow → `production-api` (or `gh workflow run deploy.yml -f target=production-api`). It saves a D1 restore point (the restore command is in the run summary), applies migrations, deploys and checks `/api/health`. Ask the owner first. Sessions don't hold Cloudflare credentials; don't add them to a cloud environment.
- After a production deploy, check `https://app.prodli.com/api/health` and the feature you shipped (for billing: `GET /api/billing/plans`).
- The Chrome extension reaches users only through a Chrome Web Store upload (version in `artifacts/prodli/extension/manifest.json`; kit in STORE_SUBMISSION.md). The store zip is built on the owner's Mac (`pnpm run build:extension:store`, needs `.env.local`).

## Only on the owner's Mac (not in cloud sessions)

- Anything in the owner's own Chrome: Dodo dashboard, Google Cloud console, Chrome Web Store dashboard, Search Console.
- Store zip builds (`.env.local`), desktop app packaging/signing (macOS), and the desktop e2e/smoke scripts on macOS. Before running a freshly packaged unsigned build: `security delete-generic-password -s "ProdLi Safe Storage"`, and kill stale instances (`pkill -f "electron@.*Electron"`), or it looks like a hang.
- Native phone builds go through EAS (needs the owner's Expo account); locally, check the phone app with typecheck, tests and `export:check`.

## Things that bite

- Tiptap tests: CDP `Input.insertText` inserts a whole string and skips Markdown input rules; type piecewise and send real Enter key events.
- Touch emulation in tests needs `Emulation.setTouchEmulationEnabled` (media emulation of hover/pointer doesn't work).
- Flaky e2e checks: poll for the result (up to a couple of seconds) instead of reading once.
- Server limits: notes are capped by `MAX_ITEM_BYTES` (1.5 MB); note images are WebP ≤300 KB each, ≤1.3 MB per note (`src/lib/noteImages.ts`).
- Plans: `users.plan` is `free | pro | plus`; the API sends `plan` as `free | pro` (Pro Plus shows as Pro for older app versions) and the exact plan as `tier`. Limits live in `prodli-api/src/{ai,ask,brief,write,transcribe,dictate,syncStore}.ts`; if you change them, update the Terms (prodli-site `Privacy.tsx`), the site's pricing (`Landing.tsx`) and docs/PRO-PLAN.md.
- Keys like `uploadPieces_*`, `pendingUpgrade`, `e2eWebDictation` are device-only; storage keys that sync or back up are listed in `src/lib/backupRestore.ts` and `src/lib/prodliSync.ts`.
- No new required extension permissions or host permissions without a very good reason (store review); use activeTab or optional permissions.
- Never commit `.env*`, `.claude/settings.local.json` or credentials.

## Cloud sessions

- Set up with `bash scripts/cloud-setup.sh` (Node 22, pnpm, dependencies, Google Chrome for the e2e tests). The environment needs network access to the npm registry and dl.google.com; it needs no secrets.
- Work on a branch, push, open a PR, let CI run, and merge after CI as above. Deploy production only through the GitHub workflow, and only with the owner's yes.
- If something needs the Mac (list above), say so in the PR or TODO.md instead of working around it.
