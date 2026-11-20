# ProdLi for iOS and Android

Status: **first version built** (2026-11-20), not yet in the stores. One codebase (`artifacts/prodli-mobile`, Expo + React Native + TypeScript) builds both apps.

## What's in the app

| | Phone app | Extension / web app |
|---|---|---|
| Today: focus, today's to-dos, habits, daily brief, evening reflection | ✅ | ✅ |
| To-dos: smart add, Today / Upcoming / lists / Done, subtasks, repeats, labels | ✅ | ✅ (+ Board, Matrix, time blocks) |
| Notes: list, search, pin, rich editing (same editor engine) | ✅ (notes with tables are read-only) | ✅ |
| Habits: check, count, minutes, quit; streaks; scheduled days | ✅ | ✅ |
| Meetings: transcripts, summaries, action items → to-dos, summarize, share | ✅ view (recording stays on the computer) | ✅ record + view |
| Ask ProdLi | ✅ | ✅ |
| Pomodoro (history and count sync) | ✅ with a notification when a session ends | ✅ |
| Time Tracker | ✅ view (phones don't track) | ✅ |
| Read later | ✅ save links, read in the in-app browser, mark read | ✅ (+ page summaries) |
| Reminders at a to-do's time | ✅ opt-in (Settings), local notifications | ✅ |
| Account: Google sign-in, devices, sign out everywhere, delete account | ✅ | ✅ |
| Buying ProdLi Pro | — (the plan bought on the web applies in the app) | ✅ |

Everything works offline and without an account. Signed in, the phone syncs both ways with the extension and app.prodli.com: within a second while the app is open (live WebSocket nudge), when it comes to the foreground, and every 5 minutes.

## How it's built

```
artifacts/prodli-mobile/
  app/                 screens (Expo Router: one file per screen; (tabs)/ is the tab bar)
  src/lib/             storage, API client, sync, data operations, AI, reminders
  src/ui/              theme (the extension's palette) and shared components
  src/shared/          re-exports logic from the extension (see below)
  tests/unit/          Vitest (sync against the real server storage, data, HTML, reminders)
  app.config.ts        app name, bundle ids, plugins, build-time settings
  eas.json             cloud build profiles (development / preview / production)
```

- **Shared logic, not copies.** The sync rules (`syncCore`), repeating to-dos (`recurrence`), habit streaks (`habits`), smart add (`taskParse`) and the data types come straight from `artifacts/prodli/src` through `src/shared/index.ts`. Change them there and both apps follow (the phone's typecheck and tests cover them).
- **Same data, same keys.** The phone stores `notes`, `todos`, `habits`, `days`, `lists`, `meetings`, `pomodoroSessions`, … under the extension's keys, in SQLite (`expo-sqlite/kv-store`). The session token is in the Keychain / Keystore (`expo-secure-store`), never in regular storage.
- **Sync** (`src/lib/sync.ts`) is the extension's protocol: push what changed since the last sync (fingerprints), pull everything after the last sequence number, newest edit wins, deletions carry tombstones, a meeting merely missing on the phone is fetched again (never deleted everywhere). `tests/unit/sync.test.ts` runs it against the server's own `syncStore.ts`.
- **Notes** are TipTap HTML. The phone edits them with TenTap (TipTap inside a WebView), so the HTML stays the same on every device. TenTap has no tables, so a note with a table (or anything unknown) opens read-only — the phone can never drop content. Opening a note never rewrites it: the editor only saves when the content differs from what it loaded.
- **Sign-in:** native Google sign-in (`@react-native-google-signin/google-signin`) asks Google for an ID token for ProdLi's **web** client; the server verifies it like the web app's and returns a bearer token (`POST /api/auth/google` with `kind: "mobile"`, session type `mobile`, 180 days, shown as "ProdLi app on iPhone/Android" in the devices list). Server change: migration `0011_mobile_sessions.sql`.
- **AI** uses the account's allowances (brief, Ask, summaries) through the same endpoints as the extension. Without an account or offline, Today shows the basic (non-AI) brief.

## Run it

Requirements: Node 22+, pnpm. No Mac or Android SDK is needed: builds run on Expo's cloud (EAS).

```bash
pnpm install
pnpm --filter @workspace/prodli-mobile run typecheck
pnpm --filter @workspace/prodli-mobile run test
pnpm --filter @workspace/prodli-mobile run export:check   # bundles the iOS + Android JavaScript (what CI checks)
```

**Quick look in a browser** (layout and logic only; notes are read-only there and Google sign-in is phone-only):

```bash
pnpm --filter @workspace/prodli-mobile run web
```

**Against a local server** (developer sign-in, no Google): start the API with fake Google, then the app pointed at it. The web preview must run on port 5173 (an origin the local server allows).

```bash
cd artifacts/prodli-api && CI=true pnpm exec wrangler d1 migrations apply DB --local && pnpm exec wrangler dev --var DEV_FAKE_GOOGLE:true
```

```bash
cd artifacts/prodli-mobile && PRODLI_API=http://localhost:8787 pnpm exec expo start --web --port 5173
```

Then More → Sign in → Developer sign-in. (The local server only accepts this with `DEV_FAKE_GOOGLE=true` in development; staging and production ignore it.)

**On a phone:** native modules (Google sign-in, the note editor, secure storage) need a ProdLi build, not Expo Go. Make a development build once, install it, then `pnpm --filter @workspace/prodli-mobile start` reloads your changes live:

```bash
cd artifacts/prodli-mobile && pnpm dlx eas-cli@latest build --profile development --platform android
```

## One-time setup (needs you)

1. **Expo account** (free): `eas login`, then `eas init` in `artifacts/prodli-mobile` and put the project id in `EAS_PROJECT_ID` (or let `eas init` write it).
2. **Google sign-in** — in the same Google Cloud project as the extension and web app (APIs & Services → Credentials → Create OAuth client ID):
   - **iOS** client: bundle ID `com.prodli.app`. Put its client ID in `eas.json` → `build.base.env.GOOGLE_IOS_CLIENT_ID`. (Public; it ships in the app.)
   - **Android** clients: package `com.prodli.app` with the SHA-1 of each signing certificate — the upload key (`eas credentials -p android`) and, once on Google Play, the app-signing key (Play Console → App integrity). No ID goes in the app.
   - The web client (already used by app.prodli.com) is the audience the server checks; nothing changes on the server.
3. **Apple Developer Program** ($99/year) and **Google Play Console** ($25 once).
4. **Builds and submission:** `eas build --profile production --platform all`, then `eas submit -p ios` / `eas submit -p android` (the Android submit profile uploads a draft to the internal testing track).
5. **Store listings:**
   - Privacy: the same data as the web app (account: Google ID, email, name, picture; user content you sync; no tracking, no ads). Apple's privacy labels: *Contact info (email, name)* and *User content*, linked to the user, not used for tracking. Google's data safety form: the same, encrypted in transit, deletable in the app.
   - Account deletion is in the app (Account → Delete account), as both stores require.
   - ProdLi Pro is not sold in the app and the app doesn't point to the web checkout (store rules); a Pro plan bought on the web simply applies.
   - Ask the lawyer to add the phone apps to the privacy policy and terms (they describe the extension and web app today).

## Costs

| Piece | Cost |
|---|---|
| Apple Developer Program | $99/year |
| Google Play Console | $25 once |
| EAS Build / Submit | Free plan (a limited number of cloud builds a month) is enough to start |
| Server | Nothing new: the phone uses the existing API, sync and AI allowances |

## Not yet (next steps)

- Record in-person meetings on the phone (needs WAV recording on Android; the transcribe endpoint expects 16 kHz WAV pieces).
- Table editing in notes (a custom TenTap editor build with TipTap's table extension).
- To-do Board / Matrix views, time blocks, note templates and saved filters on the phone.
- Home-screen widgets (today's to-dos) and share-to-ProdLi (save a link to Read later from any app).
