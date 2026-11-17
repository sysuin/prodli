# Writing help in ProdLi: plan

Goal: help people write better **where they already write in ProdLi**: notes and meeting follow-ups. This is not a Grammarly clone. ProdLi doesn't read what you type on other websites.

## Why this shape (decided 2026-11-17)

- Grammarly works on every website, which needs the "all websites" permission. That conflicts with ProdLi's "no tracking" promise and its install warning, and you'd be competing with a big product built only for that. Google Docs, Gmail and Chrome already check spelling for free.
- Inside ProdLi it needs **no new permissions**, reuses the account and its AI allowances, and makes notes and meeting notes better. Those are what ProdLi is for.
- **Not doing:** checking text on other websites, plagiarism checks, AI-text detection, team style guides.

## Phase 1: "Improve" for selected text in Notes ✅ built (branch `writing-assist`, not released)

What's built, beyond the outline below:
- The panel is `src/sections/editor/ImproveMenu.tsx`. Replace works like a paste (one paragraph merges into the line), and Ctrl/⌘+Z undoes it in one step. Insert below adds new paragraphs after the block. If the note changed while waiting, Replace asks you to select the text again rather than overwriting the wrong words.
- Clicking elsewhere closes the menu, but a suggestion stays until Discard/Escape, since it used one of the month's rewrites.
- Underline doesn't survive a rewrite (Markdown has no underline). Bold, italics, strikethrough, highlights, links, lists and checklists do.
- Command palette: search "improve" (the entries are hidden from the default list).
- Tests: `prodli-api/test/ai.test.ts` (route, allowance, refunds, limits), `tests/unit/write.test.ts` (helpers, plus Replace/Insert in a real editor), `tests/e2e/run.mjs` suite `improve` (with an axe check in light and dark).


**Where:** the bubble menu that appears when you select text (`src/sections/EditorSection.tsx`, `formatBubble`). Add a **✨ Improve** button that opens a short list:

| Action | What it does |
|---|---|
| Fix spelling & grammar | Smallest possible edits; keeps your wording |
| Shorter | Same meaning, fewer words |
| Clearer | Simpler sentences, same content |
| More formal | For work emails, documents |
| Friendlier | Warmer, more casual |

Also: **Ctrl/⌘+J** opens the list on a selection, and the command palette gets "Improve selection: …".

**How it behaves:**
- The suggestion shows in a small card under the selection. Words that changed are highlighted. Buttons: **Replace**, **Insert below**, **Copy**, **Discard**. Your text is never replaced without a click.
- **Replace** is one undo step, so Ctrl/⌘+Z brings the original back.
- **Formatting is kept.** The selection is sent as Markdown (`htmlToMarkdown` in `lib/markdownExport.ts`). The reply comes back as Markdown and is inserted with `markdownToNoteHtml` (`lib/editorHtml.ts`). Bold, links, lists and checklists survive. Both modules already load on demand, so the new tab doesn't slow down.
- **Limits per request:** up to about 6,000 characters (about 1,000 words). Not shown inside code blocks (the bubble already hides there) or for multi-cell table selections in phase 1.
- **Same language:** a Spanish note stays Spanish. It never translates.
- **Signed out:** the button shows "Sign in (free) to use writing help", like the other AI features.
- **Web app:** works the same (it shares the editor code).

**Server (`artifacts/prodli-api`):**
- New `src/write.ts`: `RewriteInputSchema` (`action` from the table above, `text` up to 6,000 chars) and `rewriteWithClaude()`. It follows the pattern in `ask.ts`: Claude Haiku 5.5 (`AI_MODEL`), low effort, structured output `{ text, changed }`, and the same error handling (`ai_refused`, `ai_busy`, `ai_failed`).
- The prompt says to keep the meaning, names, numbers, links and Markdown structure. For "Fix", change only real mistakes. Return the same language. Never add facts.
- Route `POST /api/ai/rewrite` in `src/app.ts`, built like `/api/ai/ask`: `requireAuth`, `AI_LIMITER`, size check, `reserveAi(..., "write_usage")`, refund on failure. The text goes to Anthropic and isn't stored.
- Migration `0008_write_usage.sql`, the same shape as `0005_ask_usage.sql`. Add `"write_usage"` to `UsageTable`.
- **Monthly allowance (proposed):** `WRITE_MONTHLY_LIMIT = { free: 200, pro: 2000 }`. A rewrite sends far less than an Ask question (which includes day context and up to 8 excerpts), so each one costs less than an Ask.
- `/api/ai/usage` and the plan limits in `/api/billing/plans` gain `writes`, and the account window shows "Writing help: x of 200 this month".

**App:**
- New `src/lib/write.ts`: `rewriteSelection(action, markdown)` through `accountRequest`. It returns a friendly message when the allowance runs out ("You've used this month's 200 rewrites. ProdLi Pro raises this to 2,000.").
- New `src/sections/editor/ImproveMenu.tsx` for the menu and the suggestion card, so `EditorSection.tsx` (795 lines) doesn't grow much.
- The suggestion card follows the existing look (`--nb-border`, `--nb-shadow-sm`) and must pass the axe check like every other pop-up.

## Phase 2: follow-up email from a meeting

- In a meeting's summary (`src/sections/MeetingsSection.tsx`), next to **Add all to To-Dos**: a **✉️ Draft follow-up** button.
- It writes a subject and an email body from the **summary only** (overview, decisions, action items with owners and dates, open questions), never the full transcript. That keeps it small and cheap.
- Tone choice: Formal / Friendly. Buttons: **Copy**, **Open in email app** (`mailto:` with subject and body, only when short enough for a link; otherwise just Copy).
- Server: `POST /api/ai/follow-up` in the same `write.ts`. Counts toward the same writing allowance.

## Phase 3 (later, optional)

- **On-device mode in the extension.** Chrome's general on-device model (the Prompt API) is stable for extensions. Its dedicated Proofreader, Rewriter and Writer tools were still trials when checked on 2026-11-17. When the device supports it, Improve could run locally: free, the text never leaves the computer, and it wouldn't count toward the allowance. The server stays the fallback. Only desktop Chrome on capable hardware supports it, and the first use downloads a large model, so it should be an opt-in setting ("Use on-device AI when available"), like on-device transcription.
- **Proofread the whole note:** a list of suggested fixes, each applied with one click. This needs matching each fix back to its place in the note, so it waits until phase 1 shows people use the feature.
- **Custom instruction:** a free-text "Make it…" box in the Improve menu.

## Needs you (before phase 1 ships)

Wording approved on 2026-11-17. The privacy policy and Terms are updated on the branch (`Privacy.tsx`); the website pricing waits for the release.

- **Privacy policy** (`artifacts/prodli-site/src/pages/Privacy.tsx`): rename the AI section to "AI features: daily brief, weekly review, Ask ProdLi, meeting summaries and writing help (optional)" and add:
  > Writing help (✨ Improve in Notes): with an account, you can select text in a note and ask ProdLi to fix spelling and grammar, make it shorter or clearer, or change its tone. Our server sends Anthropic's Claude API only the selected text (up to about 1,000 words) and the kind of change you picked. Neither the text nor the suggestion is stored on our servers; your note changes only if you click Replace or Insert below. We count how many times you use writing help each month.
- **Terms** (same file, plan sections): add "2,000 writing-help uses" to the Pro list and "200 writing-help uses" to the free list.
- **Website pricing** (`artifacts/prodli-site/src/pages/Landing.tsx`): add "200 writing-help uses" (Free) and "2,000 writing-help uses" (Pro). Do this when phase 1 is released, not before.


- **Privacy policy** (`artifacts/prodli-site/src/pages/Privacy.tsx`, the "AI features" section): add a paragraph saying selected text is sent to Claude to rewrite it and isn't stored. Add the follow-up email when phase 2 ships. Your lawyer reviewed these pages, so they may want to see this change.
- **Terms and PRO-PLAN.md:** add the writing allowance (Free 200 / Pro 2,000, or your numbers). `docs/PRO-PLAN.md` says to update the Terms when limits change.
- **Store listing** (`STORE_SUBMISSION.md`): add a line under NOTES, e.g. "Select text and ✨ Improve it: fix grammar, shorten, change the tone."
- **Decide:** the allowance numbers, and whether writing help is a headline Pro perk.

## Tests

- **API** (`prodli-api/test/ai.test.ts` style, with a stub `deps.rewrite`): signed-out requests are refused, bad input gets 400, oversize text gets 413, the allowance runs out at the limit, the count is refunded on failure, and `/api/ai/usage` reports writes.
- **App unit tests:** the selection-to-Markdown round trip keeps bold, links, lists and checklists; error messages; the change highlighting.
- **E2E** (`tests/e2e`, Editor suite, with the stand-in server in `tests/e2e/server.mjs`): select text → Improve → Fix → Replace changes the text; Ctrl/⌘+Z restores it; Discard leaves it alone; the axe check on the card passes in light and dark.
- Build a separate test copy for manual checks. Don't rebuild the `dist-extension` folder your Chrome loads.

## Order of work

1. Server: `write.ts`, migration, route, usage and plan limits, tests.
2. App: `lib/write.ts`, `ImproveMenu.tsx`, the bubble-menu button, shortcut, command palette, tests.
3. Privacy, Terms, store text (you), then ship phase 1 in the next version.
4. Phase 2: follow-up email.
