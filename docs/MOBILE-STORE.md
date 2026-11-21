# ProdLi for iOS and Android: store submission kit

Everything to paste into App Store Connect and the Google Play Console for the first release (0.1.0). Before submitting, do the one-time setup in [MOBILE.md](MOBILE.md) → "One-time setup" (Expo account, Google sign-in clients, developer accounts) and deploy the production API (phone sign-in needs migration `0011_mobile_sessions.sql` there).

## 1. Build and upload

From `artifacts/prodli-mobile`:

```bash
pnpm dlx eas-cli@latest build --profile production --platform all
```

```bash
pnpm dlx eas-cli@latest submit -p ios --latest
```

```bash
pnpm dlx eas-cli@latest submit -p android --latest
```

- Version **0.1.0** (`app.config.ts` → `version`); build numbers go up automatically (`eas.json` → `autoIncrement`, remote version source).
- Production builds talk to https://app.prodli.com. Test first with the `preview` profile (staging server): TestFlight for iOS, the internal testing track for Android.
- iPhone only for now (`supportsTablet: false`): on iPad the app runs in iPhone mode, so no iPad screenshots are needed. Turn tablets on once the layouts have been checked there.

## 2. Screenshots and graphics

Made from the app with demo data (no real account): `node scripts/store-screenshots.mjs` in `artifacts/prodli-mobile`. Files land in `artifacts/prodli-mobile/store-assets/`.

| Store | Size | Files |
|---|---|---|
| App Store, iPhone 6.9" | 1320 × 2868 | `ios/01-today.png` … `ios/06-review.png` (upload in order) |
| Google Play, phone | 1080 × 2400 | `android/01-today.png` … `android/06-review.png` |
| Google Play, feature graphic | 1024 × 500 | `feature-graphic.png` |
| Google Play, app icon | 512 × 512 | `icon-512.png` |

The App Store takes the app icon from the build.

The screenshots come from the app's web build, which uses the same screens as the phone apps. Once a real-device build exists, replace them with device captures if anything looks different (fonts and the status bar).

## 3. App Store Connect

**Name** (30 max): `ProdLi: Plan, Notes, Meetings`

**Subtitle** (30 max): `Your day, planned with AI`

**Category:** Productivity (secondary: Business) · **Age rating:** 4+ · **Price:** Free · **In-app purchases:** none

**Promotional text** (170 max):

```
Plan your day with an AI brief, capture to-dos in plain words, keep notes and habits, and get AI notes from meetings — synced with ProdLi on your computer.
```

**Keywords** (100 max, comma-separated):

```
todo,planner,notes,habits,pomodoro,meeting notes,transcribe,daily brief,tasks,focus,weekly review
```

**Description:**

```
ProdLi plans your day, keeps your to-dos, notes and habits, and turns meetings into notes — on your phone and in sync with ProdLi on your computer.

☀️ TODAY
Set one focus for the day, see what's due and planned, check off habits, and get a short AI daily brief: your top priorities and why, what to watch out for, and a tip. In the evening, jot down how it went.

✅ TO-DOS IN PLAIN WORDS
Type "Call Sam tomorrow 3pm !high #Work @calls" and ProdLi sets the date, time, priority, list and label. Repeating to-dos, subtasks, lists and reminders. See them as a list, a Board, or an Eisenhower matrix.

🎙️ MEETING NOTES
Record a meeting in the room: ProdLi transcribes it while you talk and writes a summary with decisions and action items, which become to-dos in one tap. Calls recorded with the ProdLi extension on your computer (Google Meet, Zoom, Teams and more) show up here too.

✨ ASK PRODLI
Ask about your day, notes and meetings — "What should I do next?", "What did we decide about the launch?" Answers come from your own data and can add to-dos or notes for you.

📝 NOTES, HABITS AND FOCUS
Rich notes with checklists, templates and a daily note. Habits you check off, count or time, with streaks. A Pomodoro timer that notifies you when a session ends. A weekly review of what got done, what slipped, and next week's top three.

🔄 ONE PRODLI, EVERYWHERE
Sign in with Google to sync with the ProdLi Chrome extension and app.prodli.com. Everything works offline and syncs when you're back. Or use it without an account — your data then stays on this phone.

🔒 PRIVATE BY DESIGN
No ads, no tracking. Meeting audio is sent in short pieces to transcribe and isn't kept. Delete your account and data from the app at any time.
```

**URLs:** Support `https://prodli.com` · Marketing `https://prodli.com` · Privacy policy `https://prodli.com/privacy`

**App Review information → Notes:**

```
ProdLi works without an account: tap "Start without an account" on the first screen to try to-dos, notes, habits, Pomodoro and the weekly review.

Sign-in is "Sign in with Google" (any Google account works; the ProdLi account is free and created on first sign-in). Signing in enables sync with the ProdLi Chrome extension and web app, the AI daily brief, Ask ProdLi, and recording in-person meetings (More → Meetings → Record in person), which transcribes speech with ProdLi's AI.

Accounts can be deleted in the app: More → your account → Delete account.

There are no purchases in the app. ProdLi Pro is a separate subscription sold only on our website; the app neither sells it nor links to it.
```

**App Privacy** (Data types → all "linked to the user", none "used for tracking", purpose "App functionality"):

| Data type | Why |
|---|---|
| Contact info → Name, Email address | The ProdLi account (from Google sign-in) |
| User content → Audio data | In-person recordings, sent in pieces to transcribe; not stored |
| User content → Other user content | Notes, to-dos, habits, meeting transcripts and summaries the user syncs |
| Identifiers → User ID | The ProdLi account ID |

Data that stays on the phone without an account isn't "collected" and isn't listed.

**Export compliance:** the app uses only standard encryption (HTTPS); `ITSAppUsesNonExemptEncryption` is already set to NO.

## 4. Google Play Console

**App name** (30 max): `ProdLi: Plan, Notes, Meetings`

**Short description** (80 max):

```
Plan your day with AI: to-dos, notes, habits, meeting notes and a daily brief.
```

**Full description:** the App Store description above.

**Category:** Productivity · **Tags:** To-do list, Note taking, Planner · **Contains ads:** No · **In-app purchases:** No

**Content rating questionnaire:** Utility/productivity app; no violence, sexual content, profanity, drugs, gambling or user-to-user communication. Expected rating: Everyone / PEGI 3.

**Target audience:** 18 and over (a productivity tool; not designed for children).

**Data safety:**

| Question | Answer |
|---|---|
| Collects or shares data? | Collects; does not share with third parties (Cloudflare hosts the servers and Anthropic writes the AI answers — both are service providers, which Google doesn't count as sharing) |
| Personal info | Name, Email address — App functionality, Account management; required to sign in, optional to use the app |
| Audio | Voice or sound recordings — App functionality; processed ephemerally (transcribed, not stored); optional |
| App activity / Other user-generated content | Notes, to-dos, habits, meeting notes — App functionality; optional (only when signed in) |
| Encrypted in transit | Yes |
| Users can request deletion | Yes: in the app (More → account → Delete account), and on the web at https://app.prodli.com (Account → Delete account) — use this link for Play's "delete account URL" |

**App access:** "All or some functionality is restricted" → the same text as the App Review notes above (no special test account is needed; any Google account works).

**Permissions to explain if asked:** microphone (record in-person meetings when you tap Record, also with the screen locked — a foreground service with a notification while recording); notifications (Pomodoro and opt-in to-do reminders).

## 5. After approval

- TestFlight / internal testing first, then a phased release (App Store) / staged rollout (Play).
- Update TODO.md and prodli.com (a "Get the app" link) when the listings are live.
