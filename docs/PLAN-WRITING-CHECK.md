# Writing check (Grammarly-style) — plan and how it works

**Status:** built 2026-11-27. Decided the same day by you: on demand with no permission, plus an optional "Check on every site"; Chrome's on-device model first, ProdLi AI as the fallback. This replaces the 17 Nov decision in PLAN-WRITING-ASSIST.md not to check text on other websites.

## What people get

- Underlines as they type in any text box (Gmail, LinkedIn, X, Slack and Notion on the web, forms): red for mistakes (spelling, grammar, punctuation), blue for clearer wording, purple for tone.
- Click (or move the caret into) an underline: the fix and a short reason; accept, dismiss, or "Add to dictionary".
- The badge in the field's corner: the count (✓ when clean), a list of suggestions, **Fix all**, **Rewrite** (shorter, clearer, more formal, friendlier) with a preview and Replace, **Turn off on this site**, Settings.
- Settings → Writing check: on every site, mistakes only or also clearer writing, English spelling (US, UK, Indian, Australian, Canadian), Chrome's built-in AI (status and a Download button), usage, sites turned off, dictionary.

## Where it beats Grammarly

| | Grammarly | ProdLi |
|---|---|---|
| Install permission | Reads all websites from install | None. On demand via right-click; all sites only if the user turns it on |
| Privacy | All text to its servers; product-improvement training on by default for individuals | English on the computer with Chrome's built-in model when available; otherwise sent to Claude and not stored or trained on |
| Breaking sites | Known lag, misplaced fixes, overlays in the way | No markup changes (CSS Highlight API / see-through copy); fixes are typed with `execCommand`, so undo works and React/Gmail notice |
| Languages | English + 5 in beta | Every language Claude writes, incl. Hindi and Hinglish |
| Price | $12–30/month for full suggestions | Included in ProdLi (free 300 AI checks; unlimited on the computer) |
| Rewrites | Paid | Included, on the writing-help allowance |

## How it works

- `src/writing/checker.ts` (built as `writing-check.js`, self-contained): runs in the page. It reads the focused field, splits it into paragraphs (`text.ts`) and checks changed ones after a pause (the paragraph you're typing in waits 1.2 s). Results are cached by paragraph text, so accepting a fix or retyping the same text never costs a check.
  - English paragraphs go to Chrome's Prompt API (`onDevice.ts`, Gemini Nano) when it's downloaded and the setting is on; anything else, or a failure, goes to the background.
  - Drawing: `CSS.highlights` for contenteditable; for textarea and input, a transparent copy of the text with the same font and padding, laid over the box.
  - Skips: password, `autocomplete` card/one-time-code/username fields, `spellcheck="false"`, CodeMirror/Monaco/Ace, read-only fields, inputs narrower than 160 px, and Google Docs (canvas).
- `src/writing/background.ts`: right-click menu and `check-writing` command (activeTab → inject), ProdLi AI calls with a session cache, dictionary/site settings, and the optional content-script registration for "Check on every site" (kept in sync with the setting and the permission).
- `prodli-api/src/proofread.ts`, `POST /api/ai/proofread`: up to 8 paragraphs (6,000 characters); Claude returns each issue's exact text plus the words before it, and the server finds the offsets (anything it can't place is dropped). Own allowance (`proofread_usage`: Free 300, Pro 3,000, Pro Plus 8,000) and rate limit (`CHECK_LIMITER`, 40/min). Cost about $0.0003 per check.
- Constants the checker needs live in `constants.ts` (its own copy, since it's bundled alone); `settings.ts` is the rest of the extension's copy; a unit test keeps them equal.

## Tests

- `prodli-api/test/proofread.test.ts`: placing issues, the endpoint, the allowance.
- `artifacts/prodli/tests/unit/writingCheck.test.ts`: paragraphs, cache keys, placing, dictionary, shifting, Fix all.
- `artifacts/prodli/tests/e2e/writing.mjs`: a fake site with a textarea, a rich editor, a password box and a spellcheck=false box; underlines, card, accept (and undo), Fix all, rewrite, dictionary, turn off per site, the every-site setting without permission.

## Later

- The same underlines inside ProdLi's own note editor.
- Google Docs (Google gives some extensions "annotated canvas" access; needs an application).
- Personal style rules ("never say 'just'"), tone goals per site, a weekly writing report.
