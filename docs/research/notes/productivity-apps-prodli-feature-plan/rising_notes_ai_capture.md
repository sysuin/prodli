# Rising notes/knowledge, AI-assistant, capture, email, read-later and focus apps (2025–2026)

Research date: 23 November 2026. Sources are mostly 2025–2026. Older items are flagged. Many figures (ARR, users, valuations) come from aggregators such as Sacra, CB Insights or Dealroom, or are company-reported. Each one is labelled where that matters.

ProdLi baseline already shipped: block editor with note links, Markdown import/export, botless AI meeting notes (captions/recording) with live coach and share links, Ask (AI over your data), Wispr-style voice dictation (hold shortcut, AI cleanup, command mode, snippets, dictionary), Pomodoro, per-site time tracking, local file viewer. The "Beyond ProdLi" notes below flag what each app does that ProdLi does not.

---

## 1. Signature features per app and what makes it sticky

### Takeaway
The fastest-growing apps in these categories share three traits:
- **Capture with no friction.** Botless meeting notes, hold-to-talk dictation, and pendants that record all the time.
- **AI that acts, not just answers.** Agents, scheduled tasks, auto-drafts, inbox triage.
- **Being an open "context layer" for other AI tools.** MCP servers, APIs, connectors.

The lines between categories are dissolving fast. Granola added dictation, Wispr added a meeting notetaker, and Notion folded Mail into agents. Separately, ChatGPT and Claude are taking on tasks, memory and browser control directly.

### Cited Findings

**AI meeting / voice / capture**

Granola
- Granola's signature is a bot-free notepad. It records on the device, adds no bot to the call, and expands the user's own typed notes into full notes. — [Granola blog: Why Granola doesn't use a bot](https://www.granola.ai/blog/why-granola-doesnt-use-a-bot); [Product Hunt reviews](https://www.producthunt.com/products/granola/reviews)
- Why users stay, per G2 and Product Hunt reviewers:
  - No bot on the call means "zero awkwardness".
  - Users can stay present instead of taking notes.
  - Notes start from what the user wrote.
  - Users can ask the AI about parts of the meeting they missed.
  — [G2 Granola reviews](https://www.g2.com/products/granola/reviews); [Product Hunt](https://www.producthunt.com/products/granola/reviews)
- Caveats raised by users:
  - Some Reddit users note that having a transcript is not the same as having paid attention. — [remio.ai summary of Reddit discussion](https://www.remio.ai/post/reddit-users-are-turning-granola-into-the-new-meeting-attention-debate)
  - Granola itself admits the trade-off: other participants can't see that it is running. — [Granola blog](https://www.granola.ai/blog/why-granola-doesnt-use-a-bot)
- Pricing as of November 2026, per user per month:
  - **Basic ($0):** 30-day history; Recipes; AI chat across meetings (Auto model only); Slack integration; MCP limited to personal notes from the last 30 days; voice typing in any app; shared folders.
  - **Business ($14):** unlimited history; model selection; Notion, Zapier, HubSpot and more; MCP over workspace notes; API.
  - **Enterprise ($35):** Salesforce; SSO; HIPAA workspaces.
  - Apps: desktop, iOS, Android and Apple Watch.
  — [Granola pricing page](https://www.granola.ai/pricing)
- 2026 features:
  - **Spaces:** team workspaces with folders and granular admin access, where users can query notes by Space or folder.
  - **MCP server** (February 2026).
  - **Personal API** (Business plan) and **Enterprise API**.
  - **Integrations** with Claude, ChatGPT, Lovable, Figma Make, Replit, Manus, v0 and Bolt.new.
  — [TechCrunch, Mar 25 2026](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- Granola changed its local database and broke on-device AI agent workflows. Users complained, and Granola promised bulk-access APIs and support for local agents. — [TechCrunch, Mar 2026](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- Granola launched on Apple Watch in July 2026. — [MacRumors, Jul 28 2026](https://www.macrumors.com/2026/07/28/granola-launches-on-apple-watch/)
- Granola launched **Voice Typing** on October 29, 2026, as a Mac beta:
  - Hold Fn on a Mac (Left Ctrl + Win on Windows), speak, and cleaned-up text pastes into any app.
  - It is marketed as free with unlimited words.
  - iOS and Windows versions are planned.
  — [runtimewire](https://runtimewire.com/article/granola-adds-free-cross-app-dictation); [fourweekmba](https://fourweekmba.com/ai-granola-adds-free-voice-typing-to-compete-with-2b-wispr/); [pricingsaas](https://pricingsaas.com/news/article/granola-adds-voice-typing-to-basic-business-and-enterprise-plans)
- Beyond ProdLi:
  - Recipes (reusable prompt templates over meetings).
  - Cross-meeting chat with model choice.
  - MCP server and personal API so external AI tools can read your notes.
  - Team Spaces.
  - A watch app.
  - Free unlimited dictation used as a growth hook.

Wispr Flow
- Wispr Flow does speech-to-text in any app, in 100+ languages, on Mac, Windows, iPhone and Android. It learns names and jargon and has a personal dictionary and snippets. — [Wispr pricing page](https://wisprflow.ai/pricing)
- Wispr now also bundles a **Notetaker** (speaker identification, meeting Q&A, MCP access for Claude and ChatGPT):
  - Free plan: unlimited meetings with 30-day history on desktop.
  - Pro: unlimited history.
  — [Wispr pricing page](https://wisprflow.ai/pricing); [TechCrunch, Aug 17 2026](https://techcrunch.com/2026/08/17/wispr-raises-280m-at-2b-valuation-as-it-looks-beyond-dictation/)
- Pricing:
  - Free: weekly word limit.
  - Pro: $15/month, or $12/month billed annually. Adds unlimited dictation, a shared team dictionary and snippets, and team analytics.
  - Growth: the page shows both $23 and $33/month, with no label saying which is current. Adds SSO and HIPAA/BAA.
  - Enterprise: custom.
  — [Wispr pricing page](https://wisprflow.ai/pricing)
- New in 2026:
  - **Canto**, a speech-understanding model. Wispr claims it cuts error rates from 30% to under 10%; this is a company claim.
  - Hardware partnerships, such as the Oasis ring, for quiet dictation.
  - "Wispr Interface Labs".
  — [TechCrunch, Aug 2026](https://techcrunch.com/2026/08/17/wispr-raises-280m-at-2b-valuation-as-it-looks-beyond-dictation/)
- Complaints:
  - Several users reported a recent drop in dictation quality. — [TechCrunch, Aug 2026](https://techcrunch.com/2026/08/17/wispr-raises-280m-at-2b-valuation-as-it-looks-beyond-dictation/)
  - Heavy resource use: the Electron app on Windows reportedly uses about 800 MB RAM.
  - Privacy allegations from a viral Reddit thread: screenshots of the active window sent to the cloud for context. These are unverified.
  - Trustpilot rating of about 2.7/5 as of April 2026.
  — [getvoibe review](https://www.getvoibe.com/resources/wispr-flow-review/); [letterly review](https://letterly.app/blog/wispr-flow-review/); [Trustpilot](https://ca.trustpilot.com/review/wisprflow.ai)
- Beyond ProdLi:
  - Native apps on all four platforms, including a mobile keyboard.
  - A shared team dictionary and snippets.
  - MCP access to meeting notes.
  - A proprietary ASR model.
  - Note: ProdLi already matches the core dictation loop.

Superwhisper
- Mac dictation that can run local Whisper and Parakeet models.
- Pricing:
  - Free tier: small local models and up to 3 custom modes.
  - Pro: $8.49/month or $84.99/year. Larger local models and cloud transcription are gated here.
  - Lifetime: $249.99.
  — [activepieces pricing guide](https://www.activepieces.com/blog/superwhisper-pricing-plans-and-costs-2026-guide); [Superwhisper docs: plans](https://superwhisper.com/docs/billing/plans.md)
- Users object to paying for access to free open-source local models. — [Superwhisper feedback board](https://superwhisper.userjot.com/board/p/nvidia-parakeet-open-source-models-are-under-premium-tier)
- Beyond ProdLi: offline/local transcription models and custom "modes" (prompt presets per context).

Otter / Fireflies / tl;dv (bot-based incumbents)
- Otter announced $100M ARR and "AI Meeting Agents" in December 2025. — [BusinessWire, Dec 22 2025](https://www.businesswire.com/news/home/20251222704206/en/Otter.ai-Caps-Transformational-2025-with-100M-ARR-Milestone-Industry-first-AI-Meeting-Agents-and-Global-Enterprise-Expansion/)
- One aggregator puts Otter at 35M+ users and 1B+ meetings. This is a secondary figure. — [enterprisedna](https://enterprisedna.co/resources/ai-map/company/otter-ai)
- Fireflies:
  - Reached a valuation above $1B through a tender offer in June 2025, while profitable.
  - Has raised only about $19M in total.
  — [CB Insights](https://www.cbinsights.com/company/fireflies/financials); [yespress](https://yespress.io/fireflies-ai)
  - One third-party comparison credits Fireflies with more capture paths, live assistance, API depth and a larger integration catalog. — [circleback compare](https://circleback.ai/compare/tldv-vs-fireflies-ai.json)
- tl;dv:
  - Built its reputation with sales teams; its free tier records unlimited meetings. — [Fireflies vs tl;dv (vendor)](https://fireflies.ai/blog/fireflies-vs-tldv)
  - Funding is between $5.5M and $10M; aggregators disagree. — [CB Insights](https://www.cbinsights.com/investor/tldv); [StartupHub](https://www.startuphub.ai/startups/tl-dv)

AI recorders (status)
- **Limitless (formerly Rewind):** acquired by Meta in December 2025.
  - Device sales to new customers ended; existing users keep support.
  - The team moved into Reality Labs.
  — [TechCrunch, Dec 5 2025](https://www.techcrunch.com/2025/12/05/meta-acquires-ai-device-startup-limitless/); [Engadget](https://www.engadget.com/ai/metas-latest-acquisition-suggests-hardware-plans-beyond-glasses-and-headsets-212930339.html)
  - The original Rewind Mac app, which recorded the screen, is effectively gone. Inferred from the sunset of the Limitless/Rewind line; not separately sourced.
- **Bee:** acquired by Amazon in July 2025. Its device is a $49.99 wristband. — [etcentric](https://www.etcentric.org/tag/bee); [Sacra](https://sacra.com/research/why-meta-bought-limitless/)
- **Plaud:** the leading independent hardware notetaker.
  - More than 1M units sold by July 2025.
  - Grew from $1M to $100M ARR in two years.
  - 2M+ users in 170+ countries, as of mid-2026.
  - About $56M revenue in 2024 with a margin near 20%.
  - Devices cost about $159–189 (NotePin, Note).
  — [Plaud blog](https://www.plaud.ai/blogs/news/plaud-scales-from-1m-to-100m-arr); [Forbes Australia](https://www.forbes.com.au/news/innovation/how-an-ai-notetaker-became-one-of-the-few-profitable-ai-startups/); [KR Asia](https://kr-asia.com/plaud-reaches-usd-100-million-arr-in-two-years-as-ai-hardware-gains-traction); [Sacra](https://sacra.com/research/plaud)
  - Sacra estimates about $250M annualized revenue by September 2025, split roughly half hardware and half software subscriptions. — [Sacra](https://sacra.com/research/plaud)

**Notes / knowledge**

Notion (AI, agents, Mail, Calendar)
- **Notion 3.0 (September 2025):** an autonomous Agent that can do multi-step work for 20+ minutes, using Notion pages and databases as memory. — [Notion 3.0 release notes](https://notion.com/releases/2025-09-18); [Sacra](https://sacra.com/c/notion/)
- **Custom Agents (February 2026):** users built more than 1M of them within about two months. The feature left beta in May 2026 with usage-based pricing of $10 per 1,000 credits. — [Wikipedia, citing TechCrunch](https://en.wikipedia.org/wiki/Notion_(productivity_software)); [Sacra](https://sacra.com/c/notion/)
- **Notion Developer Platform (May 2026):**
  - Workers: sandboxed custom code.
  - Database sync from Salesforce, Zendesk and others.
  - Assigning and tracking external agents such as Claude Code, Cursor, Codex and Decagon.
  — [Wikipedia](https://en.wikipedia.org/wiki/Notion_(productivity_software))
- **Notion Mail is discontinued:**
  - Launched April 2025 as a Gmail-based AI client, built partly on infrastructure from the Skiff acquisition.
  - In June 2026 Notion announced a shutdown on September 22, 2026, across web, desktop and iOS, shifting to agent-based email workflows.
  - Users had to export drafts, snippets and auto-label rules.
  — [Wikipedia, citing Engadget](https://en.wikipedia.org/wiki/Notion_(productivity_software))
  - Sacra says email workflows moved into agents and Gmail/Outlook AI Connectors. — [Sacra](https://sacra.com/c/notion/)
- **Notion Calendar** launched in January 2024; it came from the Cron acquisition. — [Wikipedia](https://en.wikipedia.org/wiki/Notion_(productivity_software))
- Latest version is 3.8 (October 13, 2026). — [Wikipedia infobox](https://en.wikipedia.org/wiki/Notion_(productivity_software))
- Beyond ProdLi:
  - Autonomous and custom agents that edit databases.
  - Usage-based agent credits.
  - Database sync from SaaS tools.
  - Delegating tasks to coding agents.
  - A calendar.

Tana
- An AI-native outliner and knowledge graph. **Supertags** turn notes into typed, queryable records without building tables.
- AI can turn messy meeting notes into decisions, follow-up drafts and filled project fields.
- Native iOS and Android apps transcribe voice into structured graph items.
- Public launch was February 3, 2025, after a 160K+ waitlist.
— [TechCrunch, Feb 3 2025](https://techcrunch.com/2025/02/03/tana-snaps-up-25m-with-its-ai-powered-knowledge-graph-for-work-racking-up-a-160k-waitlist); [SiliconANGLE](https://siliconangle.com/2025/02/03/productivity-startup-tana-launches-25m-funding/)
- Beyond ProdLi: typed objects (supertags) with fields, live queries/views, and voice memos that become structured data.

Mem 2.0
- Relaunched October 2, 2025, rebuilt from scratch as an "AI thought partner".
- Offline support and an Agentic Chat.
— [Mem blog](https://get.mem.ai/blog/mem-2-0); [AlternativeTo, Oct 2025](https://alternativeto.net/news/2025/10/mem-2-0-relaunches-with-smarter-note-taking-tools-offline-support-and-a-new-agentic-chat); [Product Hunt](https://www.producthunt.com/products/mem-2-0/launches)
- Added in 2026: voice capture, in-app chat, semi-autonomous agent workflows, early team sharing. This comes from a Tana-written roundup, so it is a competitor's source. — [Tana blog](https://tana.inc/blog/best-mem-alternatives-2026)

Obsidian
- Free for commercial use since February 20, 2025: the Commercial license is now optional. — [Obsidian blog](https://obsidian.md/blog/free-for-work/)
- **Bases**, a core plugin since v1.9.0 (May 21, 2025): database-like views that filter notes by properties, with formulas. — [Obsidian changelog](https://obsidian.md/changelog/2025-05-21-desktop-v1.9.0)
- Official open-source **Web Clipper** that saves clips locally into your vault. — [Obsidian Clipper](https://obsidian.md/sv/clipper); [Firefox listing](https://addons.mozilla.org/firefox/addon/web-clipper-obsidian)
- Beyond ProdLi: a web clipper with templates, database views over note properties (Bases), and a plugin ecosystem.

Heptabase, Capacities, Reflect, Anytype, Craft, Saner.ai
- **Heptabase:** a visual canvas or whiteboard of nested cards. — [BuyerSprint guide, May 2026](https://buyersprint.com/?p=5056)
  - Funding: $2.2M, with the last seed in March 2023. — [CB Insights](https://www.cbinsights.com/company/heptabase/financials)
  - Revenue estimates conflict: about $7M ARR ([moklabs](https://moklabs-research.pages.dev/reports/market-analysis/2026-03-19-knowledge-management-second-brain)) versus $1.2M in 2024 with 30K paid users ([geo.sig.ai](https://geo.sig.ai/brands/heptabase.md)).
- **Capacities:** typed "objects" instead of pages and folders ([BuyerSprint](https://buyersprint.com/?p=5056)). Reportedly has no VC funding ([moklabs](https://moklabs-research.pages.dev/reports/market-analysis/2026-03-19-knowledge-management-second-brain)).
- **Reflect:** end-to-end encryption plus graph-aware AI. — [BuyerSprint](https://buyersprint.com/?p=5056)
- **Anytype:** $13.4M Series A (August 2023, Balderton). No 2026 raise found. — [moklabs](https://moklabs-research.pages.dev/reports/market-analysis/2026-03-19-knowledge-management-second-brain); [Anytype community](https://community.anytype.io/t/balderton-capital-vcware-and-anytype-s-future/29542)
- **Saner.ai:** about $120K in funding (2024). Visible mainly through SEO "alternatives" listicles that rank itself first. — [CB Insights](https://www.cbinsights.com/compare/heptabase-vs-sanerai); [Saner blog](https://blog.saner.ai/best-capacities-alternatives)

**Launchers / assistants**

Raycast
- **Windows:** public beta on November 20, 2025, with Quick AI free during the beta. Raycast 2.0 came out of beta on August 25, 2026. — [Raycast Windows changelog 2.0](https://www.raycast.com/changelog/windows%2F2-0); [Raycast blog: Raycast for Windows](https://raycast.com/blog/raycast-for-windows); [Impress Watch](https://forest.watch.impress.co.jp/docs/news/2073823.html)
- **iOS app "Raycast: AI, Notes and more":** notes and AI; the free tier includes 5 notes. — [App Store](https://apps.apple.com/us/app/raycast/id6503428327); [Raycast pricing](https://www.raycast.com/pricing)
- **Pricing:**
  - Free: 50 AI messages.
  - Pro: $10/month or $96/year, with unlimited notes, cloud sync and AI credits.
  - The billing manual says the Advanced AI add-on was replaced by Pro+ and Max plans, but the pricing page still shows +$8/month. The two sources conflict.
  — [Raycast billing manual](https://manual.raycast.com/billing); [Raycast pricing](https://www.raycast.com/pricing)
- **AI Extensions** let AI call tools such as Linear and GitHub from the launcher. — [Raycast Pro](https://raycast.com/pro?via=hypertje)

ChatGPT
- **Pulse** launched September 2025: proactive morning briefs that use memory plus opt-in Gmail and Google Calendar. — [TechCrunch, Sep 25 2025](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)
- **Pulse is being sunset.** Its proactive updates are moving into **scheduled tasks**. — [OpenAI Help: ChatGPT Pulse](https://help.openai.com/en/articles/12293630-chatgpt-pulse)
- **"ChatGPT Work":** agents that run once, on a schedule, or on an event, or monitor for changes, using connected apps and a browser.
- OpenAI is sunsetting the standalone **Atlas** browser in favour of a browser built into the ChatGPT desktop app.
— [OpenAI: ChatGPT for your most ambitious work](https://openai.com/index/chatgpt-for-your-most-ambitious-work). Exact dates were not in the sources.

Claude
- **August 12, 2026:** the Claude in Chrome side panel became a full **Cowork** client. Sessions, skills and connectors carry across desktop, web and mobile. Rolled out to Max and Team first, then Pro. — [Claude article](https://claude.com/resources/articles/cowork-chrome-side-panel); [The New Stack](https://thenewstack.io/claude-chrome-cowork-sessions/)
- **August 25, 2026:** memory is shared across chat and Cowork and is on by default for Free, Pro and Max. — [TechCrunch, Aug 25 2026](https://techcrunch.com/2026/08/25/claude-cowork-finally-remembers-what-you-told-the-app-in-chat/); [The Next Web](https://thenextweb.com/news/anthropic-claude-cowork-shared-memory-default)
- Claude reportedly gained the ability to send Gmail and manage Drive files. Thinly sourced. — [Android Authority](https://androidauthority.com/claude-cowork-shares-memory-with-chat-3702922)

Gemini / Gmail
- **January 2026:** Gmail "Gemini era":
  - **AI Inbox**, a priority view with briefings and to-dos.
  - **AI Overviews** thread summaries, free for everyone.
  - AI Overview search answers, limited to AI Pro and Ultra.
  — [Google blog](https://blog.google/products-and-platforms/products/gmail/gmail-is-entering-the-gemini-era/); [TechCrunch, Jan 8 2026](https://techcrunch.com/2026/01/08/gmail-debuts-a-personalized-ai-inbox-ai-overviews-in-search-and-more)
- AI Inbox expanded to AI Plus and AI Pro subscribers, and covers the Primary tab only. — [Android Authority hands-on](https://www.androidauthority.com/gmail-ai-inbox-hands-on-3678753/)
- Gemini **Personal Intelligence** (January 2026) can draw on Gmail, Photos, Search and YouTube history. — [TechRepublic](https://www.techrepublic.com/article/news-best-of-dti-jan-12-16-2026/)

**Email**

Superhuman
- Grammarly acquired Superhuman (email) in 2025 and renamed the whole company **Superhuman** on October 29, 2025.
- The suite is Grammarly, Coda, Superhuman Mail, and **Superhuman Go**, an assistant that works across 100+ apps.
- Go was free until February 1, 2026, then moved to subscription.
— [TechCrunch, Oct 29 2025](https://techcrunch.com/2025/10/29/grammarly-rebrands-to-superhuman-launches-a-new-ai-assistant/); [Grammarly blog](https://grammarly.com/blog/company/announcing-company-rebrand-to-superhuman); [TechRadar](https://www.techradar.com/ai-platforms-assistants/grammarly-has-rebranded-as-superhuman-launching-a-new-ai-assistant-that-works-across-100-apps)
- **Superhuman Mail AI:** proactive triage, clutter clearing, Auto Drafts in the user's voice, Ask AI, Custom Auto Labels.
- Pricing:
  - Starter: $25/member/month (annual).
  - Business: $33, adding Auto Drafts, Ask AI, auto labels and CRM.
  - Sources conflict on these figures.
— [Superhuman Mail plans](https://superhuman.com/plans/mail); [fast.io review](https://www.fast.io/resources/superhuman-ai-review-2026.md)

Shortwave and Spark
- **Shortwave:**
  - An AI assistant with voice commands and "Organize inbox with AI" (October 2024, older).
  - A Tasklet integration acts on emails automatically.
  — [Shortwave changelog](https://www.shortwave.com/changelog/)
- **Spark (Readdle, independent):**
  - GPT-based AI Compose, Rephrase and Translate on Premium.
  - Reviewers call its AI thinner than Superhuman's, and say users don't use it much.
  — [clean.email review](https://clean.email/blog/ai-for-work/spark-mail-ai-review); [AsianEfficiency](https://www.asianefficiency.com/email-management/superhuman-vs-spark/)

**Read-later / highlights**

- **Pocket shut down on July 8, 2025.** The export window and API closed November 12, 2025. — [Mozilla support](https://support.mozilla.org/en-US/kb/future-of-pocket)
- Where Pocket users went:
  - **Readwise Reader:** full Pocket import; $9.99/month after a 30-day trial.
  - **Instapaper:** import tool.
  - **Matter:** promised a migration and discount.
  — [TechCrunch, May 27 2025](https://techcrunch.com/2025/05/27/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives); [9to5Mac](https://9to5mac.com/2025/05/28/pocket-read-it-later-alternatives/); [Fast Company](https://www.fastcompany.com/91343565/pocket-alternatives-best-read-it-later-apps)
- **Readwise Reader:**
  - Ghostreader v3, a chat with cited answers and preset prompts (December 2025).
  - **Global Ghostreader** that can triage your inbox and organize your library, Quick Lookup, and a rebuilt Readwise mobile app (August 2026).
  - Text-to-speech (TTS) that keeps your place in the background, with lifelike v8 voices.
  — [Reader update Dec 2025](https://readwise.io/reader/update-dec2025); [Reader update Aug 2026](https://readwise.io/reader/update-aug2026); [Readwise changelog](https://docs.readwise.io/changelog); [App Store](https://apps.apple.com/app/readwise-reader/id1567599761)
- **Matter:** Premium adds HD TTS and an AI Co-Reader. Reportedly about $80/year in 2026. — [App Store](https://apps.apple.com/US/app/id1501592184); [toolchase](https://toolchase.com/tool/matter-app/)
- Beyond ProdLi:
  - Save-for-later queue with highlights and spaced review.
  - TTS listening.
  - An AI reading assistant scoped to a document or the whole library.
  - Pocket and Instapaper import.

**Focus / blocking / screen time**

- **Opal:** blocks apps and websites on iPhone and Mac, plus a Chrome extension.
  - "Deep Focus" mode cannot be cancelled in the app, though it can be bypassed through iOS Screen Time settings.
  - Pro is about $99.99/year.
  - Revenue is estimated at about $500K/month (third-party estimate).
  - "Opal for Schools" launched in 2026.
  — [App Store](https://apps.apple.com/us/app/1497465230); [Headway review](https://makeheadway.com/blog/opal-app-review/); [screensdesign](https://screensdesign.com/discover/apps/opal-screen-time-control/)
  - Funding: about $4.3M seed (2021, older). — [Dealroom](https://dealroom.co/companies/opal-1-1/)
- **Forest:** gamified Pomodoro where a tree dies if you leave the app. **Freedom:** cross-platform site and app blocker, $39.99/year. **Brain.fm:** about $69.99/year. **Endel:** $49.99/year. — [AsianEfficiency (prices re-verified Jul 2026)](https://www.asianefficiency.com/productivity/best-focus-deep-work-apps/); [lifestack](https://lifestack.ai/blog/best-apps-for-focus-and-concentration)
- Brain.fm says it is "not a meditation app" and makes brainwave claims. Those claims are not independently verified. — [Brain.fm blog](https://www.brain.fm/blog/best-focus-music-apps-2026)

**Start pages / new tab**

- **Momentum:** about 2M Chrome users. Reportedly locks Pomodoro, multiple to-do lists, backgrounds and countdowns behind about $30/year; that claim comes from a competitor's listing. — [web-highlights](https://www.web-highlights.com/blog/the-best-new-tab-chrome-extensions-for-2024/); [Momentum Plus CWS listing](https://chromewebstore.google.com/detail/gkkgbapmmffohbhhkppljfmcmopbhlgi)
- **Bonjourr:** about 300K–400K Chrome users. Open source, lightweight, minimal. — [Chrome Web Store](https://chromewebstore.google.com/detail/dlnejlppicbjfcfcedcflplfjajinajd); [Fast Company](https://www.fastcompany.com/91467399/chrome-dashboard-extensions-new-tab-start-page)
- **Tabliss:** about 75K Firefox users and 100K+ overall. — [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tabliss/)
- **daily.dev:** a developer news feed in the new tab.
  - 400K+ users per the Chrome listing; its own homepage claims 1M+.
  - Free and open source, with Squads and native mobile apps.
  — [Chrome Web Store](https://chromewebstore.google.com/detail/dailydev-developer-news-d/jlmpjdjjbgclbocgajdjefcidcncaied?hl=en); [daily.dev](https://daily.dev/); [docs](https://docs.daily.dev/)

### Inferences
- Stickiness comes from four things:
  - **Data gravity:** meeting history, highlights, a vault.
  - **Habit loops:** a hotkey, the new tab, a morning brief.
  - **No social cost:** no meeting bot.
  - **Openness:** MCP/API, so users don't feel locked in.
- Granola and Wispr gate history, not capture. Both offer free capture with a 30-day history limit. That suggests the paywall that works is "keep your past", not "use the feature".
- "Proactive AI" is converging on scheduled agents rather than standalone feeds. Pulse folded into scheduled tasks, Notion Mail folded into agents. Standalone AI email clients look fragile when the platform (Gmail with Gemini) ships the same triage for free.

### Gaps
- No primary source found for:
  - Granola user counts.
  - Wispr 2026 ARR. The last estimate is about $10M ARR in October 2025 (Latka, via [Sacra](https://sacra.com/c/wispr)); it was not independently verified.
  - Notion's official 2026 ARR. The $865M figure is a Sacra estimate.
- No sourced 2025–2026 material collected for:
  - one sec, Session, Toby, Workona, Craft's 2025–26 features, Saner.ai's features, Capacities' 2026 releases.
- Omnivore:
  - From memory (unverified in this session): Omnivore shut down in late 2024 after its team joined ElevenLabs, and users went to Readwise Reader, Wallabag and others. This needs a source before use.
- Reddit:
  - Direct Reddit threads were not retrieved. Reddit sentiment here is via secondhand summaries (remio.ai, review blogs).

---

## 2. Growth evidence 2024–2026 (funding, ARR, users, ranks)

### Takeaway
Capital and growth are concentrated in voice and meeting capture: Wispr at $2B, Granola at $1.5B, Plaud at $100M+ ARR, Otter at $100M ARR, Fireflies at about $1B. Notion is scaling via AI and agents to an estimated $865M ARR. The classic personal-knowledge-management (PKM) apps (Heptabase, Capacities, Anytype, Tana) are small, mostly seed or Series A, and growing quietly.

Big platforms consolidated or killed adjacent products:
- Meta bought Limitless.
- Amazon bought Bee.
- Notion is killing Mail.
- OpenAI is sunsetting Pulse and Atlas.
- Mozilla killed Pocket.

### Cited Findings
| App | Evidence | Source |
|---|---|---|
| Granola | $125M Series C at $1.5B (Mar 2026), up from $250M (May 2025, $43M Series B); $192M total; led by Index, with Kleiner Perkins; customers include Vanta, Gusto, Asana, Cursor, Mistral | [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/); [TechCrunch 2025](https://techcrunch.com/2025/05/14/ai-note-taking-app-granola-raises-43m-at-250m-valuation-launches-collaborative-features) |
| Wispr | $280M Series B at $2B (Aug 17 2026, Menlo); $361M total; $25M round Nov 2025; Android launch late 2025; company says 60B+ words dictated (company figure) | [TechCrunch](https://techcrunch.com/2026/08/17/wispr-raises-280m-at-2b-valuation-as-it-looks-beyond-dictation/); [Reworked](https://www.reworked.co/ai-platforms/wispr-hits-2b-valuation-launches-canto-voice-model/) |
| Notion | ~$500M annual revenue (Sep 2025); Sacra estimates $610M ARR at end-2025 and $865M by Jul 2026; >50% of end-2025 ARR came from AI-enabled customers; 100M users | [Sacra](https://sacra.com/research/notion-at-865m-year-growing-82-yoy/); [AI Magazine](https://aimagazine.com/news/notion-ai-agents-for-a-workspace-used-by-100-million-people) |
| Otter | $100M ARR (Dec 2025, company-announced) | [BusinessWire](https://www.businesswire.com/news/home/20251222704206/en/Otter.ai-Caps-Transformational-2025-with-100M-ARR-Milestone-Industry-first-AI-Meeting-Agents-and-Global-Enterprise-Expansion/) |
| Fireflies | ~$1B valuation via tender (Jun 2025); profitable; ~$19M raised | [yespress](https://yespress.io/fireflies-ai); [CB Insights](https://www.cbinsights.com/company/fireflies/financials) |
| Plaud | 1M+ units (Jul 2025); $100M ARR and 2M+ users (2026); est. ~$250M 2025 revenue | [Plaud](https://www.plaud.ai/blogs/news/plaud-scales-from-1m-to-100m-arr); [Forbes AU](https://www.forbes.com.au/news/innovation/how-an-ai-notetaker-became-one-of-the-few-profitable-ai-startups/); [Sacra](https://sacra.com/research/plaud) |
| Limitless | Acquired by Meta (Dec 5 2025); device sales ended | [TechCrunch](https://www.techcrunch.com/2025/12/05/meta-acquires-ai-device-startup-limitless/) |
| Bee | Acquired by Amazon (Jul 2025) | [etcentric](https://www.etcentric.org/tag/bee) |
| Superhuman / Grammarly | Grammarly acquired Superhuman (2025); renamed the company Superhuman (Oct 29 2025); four-product suite | [TechCrunch](https://techcrunch.com/2025/10/29/grammarly-rebrands-to-superhuman-launches-a-new-ai-assistant/) |
| Raycast | $30M Series B (Sep 2024, Atomico; older); Windows GA Aug 2026; iOS app | [Raycast blog](https://raycast.com/blog/series-b); [changelog](https://www.raycast.com/changelog/windows%2F2-0) |
| Tana | Launched Feb 2025 with $25M total funding ($14M Series A, Tola); 160K waitlist; ~$100M valuation (reported) | [TechCrunch](https://techcrunch.com/2025/02/03/tana-snaps-up-25m-with-its-ai-powered-knowledge-graph-for-work-racking-up-a-160k-waitlist); [yespress](https://yespress.io/tana) |
| Mem | 2.0 relaunch Oct 2025 (Product Hunt launch) | [Product Hunt](https://www.producthunt.com/products/mem-2-0/launches) |
| Heptabase / Anytype / Capacities / Saner | Small or unclear: Heptabase $2.2M; Anytype $13.4M (2023); Capacities bootstrapped; Saner ~$120K | [CB Insights](https://www.cbinsights.com/company/heptabase/financials); [moklabs](https://moklabs-research.pages.dev/reports/market-analysis/2026-03-19-knowledge-management-second-brain) |
| Pocket | Shut down Jul 8 2025 | [Mozilla](https://support.mozilla.org/en-US/kb/future-of-pocket) |
| Notion Mail | Shutdown Sep 22 2026 (announced Jun 2026) | [Wikipedia, citing Engadget](https://en.wikipedia.org/wiki/Notion_(productivity_software)) |
| ChatGPT Pulse / Atlas | Pulse sunset into scheduled tasks; Atlas sunset into a browser built into the ChatGPT app | [OpenAI Help](https://help.openai.com/en/articles/12293630-chatgpt-pulse); [OpenAI](https://openai.com/index/chatgpt-for-your-most-ambitious-work) |
| Opal | ~$4.3M seed (2021); est. ~$500K/month revenue (third-party) | [Dealroom](https://dealroom.co/companies/opal-1-1/); [screensdesign](https://screensdesign.com/discover/apps/opal-screen-time-control/) |
| New-tab apps | Momentum ~2M Chrome users; Bonjourr 300–400K; daily.dev 400K+ (CWS) / 1M+ (self-reported) | [web-highlights](https://www.web-highlights.com/blog/the-best-new-tab-chrome-extensions-for-2024/); [CWS](https://chromewebstore.google.com/detail/dlnejlppicbjfcfcedcflplfjajinajd); [daily.dev](https://daily.dev/) |

### Inferences
- The two most valuable independents, Wispr and Granola, are each crossing into the other's core feature. Dictation plus meeting notes is becoming one category: "voice capture". ProdLi already has both, which is a strong position, but it now competes with free unlimited dictation from Granola.
- Hardware recorders split two ways. Big tech absorbs them (Meta, Amazon), or a profitable specialist wins on hardware plus subscriptions (Plaud). A browser app can't compete on hardware. It could import recordings from Plaud-type devices.
- Platform risk is high for thin AI-wrapper products: Notion Mail, Pulse and Pocket all died within 18 months. Defensibility comes from owning user data and habit, not from a single AI feature.

### Gaps
- No verified 2026 user or rank data (App Store or Chrome Web Store) for Granola, Wispr, Opal, one sec, Forest, Freedom, Brain.fm, Endel, Readwise, Matter, Capacities or Heptabase.
- Otter's current valuation is unclear: aggregators conflict, ranging from a $500M valuation in 2021 to an implausible "$14B". tl;dv funding is unclear ($5.5M vs $10M).
- No Product Hunt rank data was collected.

---

## 3. Which features fit an all-in-one browser app, and which need native/OS access?

### Takeaway
Most of the high-value features these apps differentiate on can run in a browser:
- MCP/API context layer.
- Recipes and templates over meetings.
- Cross-note agent chat.
- Typed objects and database views.
- Web clipper.
- Read-later with TTS and an AI reader.
- Scheduled agents and daily briefs.
- Email triage over the Gmail API.
- Website blocking.
- New-tab dashboard.

What needs native OS access:
- System-wide dictation outside the browser.
- Capturing system audio from desktop meeting apps without a bot.
- Blocking apps at the OS level.
- Screen recall.
- Wearables.

ProdLi's Electron desktop app can cover most of those.

### Cited Findings
- Hold-Fn system-wide dictation pasting into any app (Granola, Wispr) is delivered as native desktop and mobile apps. — [runtimewire](https://runtimewire.com/article/granola-adds-free-cross-app-dictation); [Wispr pricing](https://wisprflow.ai/pricing)
- Granola's bot-free capture runs on the device. — [Granola blog](https://www.granola.ai/blog/why-granola-doesnt-use-a-bot)
- Wispr reportedly takes screenshots of the active window for context, which needs OS access and raises privacy concerns. — [getvoibe](https://www.getvoibe.com/resources/wispr-flow-review/)
- Opal pairs native iOS/Mac blocking with a Chrome extension. Its unbypassable mode relies on iOS Screen Time APIs. — [screensdesign](https://screensdesign.com/discover/apps/opal-screen-time-control/); [Headway](https://makeheadway.com/blog/opal-app-review/)
- Claude's Chrome side panel runs full agent sessions with skills and connectors inside the browser. — [Claude](https://claude.com/resources/articles/cowork-chrome-side-panel)
- The Obsidian Web Clipper is a browser extension. — [Firefox listing](https://addons.mozilla.org/firefox/addon/web-clipper-obsidian)
- Granola and Wispr expose MCP servers for Claude and ChatGPT. — [Granola pricing](https://www.granola.ai/pricing); [Wispr pricing](https://wisprflow.ai/pricing)
- Gmail's AI Inbox triage is server-side on Gmail data. — [Google blog](https://blog.google/products-and-platforms/products/gmail/gmail-is-entering-the-gemini-era/)

### Inferences

The table maps each feature to whether a browser can host it. Shortened, the browser options are: the extension, the web app, and the Electron desktop app. MV3 is Chrome's Manifest V3 extension platform.

| Feature (source app) | Browser-feasible? | Notes for ProdLi (beyond current baseline) |
|---|---|---|
| MCP server and personal API over notes, meetings, time data (Granola, Wispr) | Yes (server-side) | High leverage: lets Claude, ChatGPT and Cursor read ProdLi. Low build cost if a backend exists. |
| Recipes / prompt templates over meetings and notes (Granola) | Yes | Extends existing Ask and meeting notes. |
| Cross-meeting chat with model choice (Granola) | Yes | Ask already covers most of this. Add per-folder or per-space scoping. |
| Team Spaces and shared folders with access control (Granola, Notion) | Yes | Needs a team backend. |
| Supertags, typed objects, database views (Tana, Capacities, Obsidian Bases, Notion) | Yes | Biggest gap compared with the PKM leaders. Block editor plus properties plus table and board views. |
| Agents that edit the workspace, plus scheduled tasks and daily briefs (Notion agents, ChatGPT scheduled tasks, Pulse) | Yes | Run in the extension service worker or on a server. A "morning brief" on the new tab is a natural fit. |
| Web clipper with templates (Obsidian) | Yes (extension) | Natural extension feature. |
| Read-later queue, highlights, TTS, AI reader, Pocket/Instapaper import (Readwise Reader, Matter) | Yes | Web Speech API or cloud TTS. Captures Pocket refugees. |
| Email triage, auto-drafts, auto-labels (Superhuman, Shortwave, Gmail AI Inbox) | Yes (Gmail API or a Gmail content script) | Cautionary tale: Notion Mail died, and Gmail gives triage away free. Better as a sidebar or agent than as a full client. |
| Website blocking with a strict mode, and screen-time reports (Opal, Freedom, Forest) | Yes for sites (MV3 declarativeNetRequest) | Pairs with existing time tracking and Pomodoro. Blocking apps needs native access. |
| Focus soundscapes (Brain.fm, Endel) | Yes (audio in an offscreen document) | Licensing or generation cost; low differentiation. |
| New-tab dashboard: brief, tasks, focus timer, quotes (Momentum, Bonjourr, daily.dev) | Yes (chrome_url_overrides) | Momentum paywalls Pomodoro and to-dos, which ProdLi has. A free, rich new tab could undercut it. |
| System-wide dictation into any desktop app (Wispr, Granola, Superwhisper) | No (needs native) | ProdLi's dictation is likely limited to the browser. The Electron app is the path. |
| Offline/local ASR models (Superwhisper) | Partial (WASM Whisper in the browser) | Feasible but heavy. A privacy selling point. |
| Botless capture of desktop Zoom or Teams apps, as opposed to browser meeting tabs (Granola) | No in the browser; Yes in Electron | Tab audio is browser-feasible; system audio needs native. |
| Screen-context awareness and screen recall (Wispr, Rewind/Limitless) | No / privacy-risky | Avoid, or keep strictly local and opt-in. |
| Wearable or pendant capture (Plaud, Bee, Limitless) | No | At most, import audio files and transcribe them. |
| Watch or mobile keyboard dictation (Granola Apple Watch, Wispr iOS keyboard) | No (native mobile) | The Expo mobile app is the path. |

- Cheapest wins with clear evidence of demand:
  1. MCP server and API.
  2. Recipes and templates.
  3. Typed properties and database views.
  4. Web clipper plus read-later with Pocket/Instapaper import.
  5. Site blocking tied to the existing Pomodoro.
  6. A new-tab daily brief built from scheduled agents.
- Avoid building a standalone email client. Notion Mail was shut down, and Gmail ships AI triage free.

### Gaps
- Did not verify current Chrome MV3 limits, such as tabCapture inside service workers or offscreen audio. Those details would come from Chrome developer docs.
- No data found on how often users of browser-only tools ask for app-level blocking or system-wide dictation, so the relative priority of the native-only features is unquantified.
