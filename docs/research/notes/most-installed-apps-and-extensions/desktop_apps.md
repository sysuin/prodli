# Most installed and most loved desktop productivity apps and utilities (macOS, Windows, web), 2025–2026, and what ProdLi could bring in

Research date: 23 Nov 2026. Scope: usage evidence, signature features and pricing for the most popular desktop productivity apps and utilities, plus which of their features ProdLi (Chrome extension + web app, with an Electron desktop app for Mac and Windows in progress) could integrate. ProdLi baseline (from the brief, not re-verified): to-dos, notes, habits, Pomodoro, per-website time tracking, botless meeting notes, AI Ask, voice dictation (extension; system-wide dictation planned for desktop), Quick add shortcut and tray in Electron, local file viewer.

Method note: The best hard usage data found is Homebrew's public cask analytics (365 days to 22 Nov 2026) and GitHub star counts (pulled 23 Nov 2026 via the GitHub API). Both skew heavily toward developers and open-source tools. Mac App Store-only apps (Things 3, Amphetamine, Magnet) and many paid apps don't show up in Homebrew. Most "user count" figures for big SaaS apps come from secondary aggregators, flagged where relevant.

---

## 1. Most used desktop/work apps overall (Microsoft 365, Google Workspace, Slack, Zoom, Teams, Notion, ChatGPT desktop, Claude desktop): usage 2025–2026

### Takeaway
ChatGPT is now the largest single work and productivity app by reach: about 900M weekly users officially (Feb 2026), with 1B+ by Aug 2026 and 1.2B reported later in 2026. Microsoft 365 Copilot passed 30M paid seats in FY2026. Teams (320M+ MAU officially, 360M per one secondary source), Google Workspace (3B users including consumers, 8M+ paying orgs) and Slack (about 47M DAU, estimated) are the collaboration incumbents. Among Mac power users and developers, Claude's desktop app now out-installs ChatGPT's desktop app on Homebrew, and AI coding CLIs are the #1 and #2 casks overall.

### Cited Findings
**ChatGPT**
- OpenAI reports only weekly users, no MAU or DAU. The last figure tied to an official disclosure is 900M weekly users (Feb 2026). OpenAI reportedly said on 6 Aug 2026 that "1 billion people turn to ChatGPT every week". Secondary sites cite 1.2B weekly users from DevDay on 29 Sep 2026, which is less firmly verified. — [TechnologyChecker (secondary)](https://technologychecker.io/blog/chatgpt-statistics); [Whizi (secondary)](https://whizi.io/resources/chatgpt-statistics/); [Wikipedia: ChatGPT](https://en.wikipedia.org/wiki/ChatGPT)
- Homebrew cask `chatgpt` (desktop app): #47 with 112,893 installs in the 365 days to 22 Nov 2026. — [Homebrew cask analytics, 365d](https://formulae.brew.sh/analytics/cask-install/365d/)

**Claude / AI coding tools (developer-skewed signal)**
- Homebrew's top two casks over 365 days are `codex` (1,485,268) and `claude-code` (1,172,205). `claude-code@latest` adds another 152,409 (#27), and `copilot-cli` has 262,305 (#16). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)
- The Claude desktop app (`claude`) is #17 with 248,063 installs, more than twice ChatGPT desktop (#47, 112,893). `ollama-app` is #54 (95,115) and `cursor` is #45 (118,207). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)
- `steipete/tap/codexbar`, a third-party menu-bar app, is #34 with 127,145 installs. It is a popular menu-bar utility built around AI tools. — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Microsoft 365 / Teams / Copilot**
- Microsoft's FY2026 proxy statement says Microsoft 365 Copilot "surpassed 30 million paid seats" in fiscal 2026. Secondary coverage describes growth from 15M (Q2 FY26) to 30M+ (Q4 FY26). — [Microsoft DEF 14A FY2026 (SEC)](https://www.sec.gov/Archives/edgar/data/0000789019/000119312526427849/d61756ddef14a.htm); [SQ Magazine (secondary)](https://sqmagazine.co.uk/copilot-statistics/)
- Teams: Microsoft's FY2024 proxy says Teams passed 320M monthly active users, up from 300M in the FY2023 proxy. Wikipedia lists 360M monthly users as of June 2025. I found no official 2026 Teams figure. — [Microsoft DEF 14A FY2024](https://www.sec.gov/Archives/edgar/data/789019/000119312524242883/d858775ddef14a.htm); [Wikipedia: Microsoft Teams](https://en.wikipedia.org/wiki/Microsoft_Teams)
- Secondary aggregators say Microsoft's family of Copilots passed 150M MAU in FY26 Q1 (not verified against Microsoft). — [tools8020 (secondary)](https://tools8020.com/blog/microsoft-copilot-statistics/)
- Homebrew: `microsoft-teams` is #108 (45,929) and `microsoft-office` is #223 (17,624). Mac users mostly install these outside Homebrew. — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Google Workspace**
- A 2025 compilation reports 8M+ paying Workspace customers and 3B+ total users (the latter includes free consumer accounts). Wikipedia's older figure is 9M paying businesses (Oct 2021). These figures conflict. — [Exploding Topics (secondary)](https://explodingtopics.com/blog/google-workspace-stats); [Wikipedia: Google Workspace](https://en.wikipedia.org/wiki/Google_Workspace)

**Slack**
- Slack has published no official DAU or MAU since 2019. The most-cited estimate is about 47.2M DAU in 2025 (38.8M in 2024) and about 79M MAU. Other outlets say 42M+ DAU in early 2025. — [DemandSage (estimate)](https://www.demandsage.com/slack-statistics/)
- Homebrew `slack`: #57 (90,719). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Zoom**
- I found no reliable company-sourced MAU. One secondary source says "700 million+ monthly users" without a primary citation. Zoom revenue was US$4.67B (2025). — [Wikipedia: Zoom Communications](https://en.wikipedia.org/wiki/Zoom_Communications)
- Homebrew `zoom`: #76 (64,863). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Notion / Obsidian**
- Notion says it has passed 100M total users (not MAU). Sources date the milestone to 2024 or 2025, with 4M+ paying customers reported. — [Okara (secondary)](https://okara.ai/blog/how-notion-grew); [Toolfinder (secondary)](https://toolfinder.com/lists/notion-in-statistics)
- On Homebrew, Obsidian (#19, 219,444) is installed about 3.3× more often than Notion (#74, 66,662). The obsidian-releases GitHub repo has 23,464 stars. — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/); [GitHub API, obsidianmd/obsidian-releases](https://api.github.com/repos/obsidianmd/obsidian-releases)

### Inferences
- AI assistants (ChatGPT, Claude, Copilot) are now the default "always open" desktop app for knowledge workers. An all-in-one productivity app is expected to have an AI command bar or AI Ask, which ProdLi already has. The new step would be making AI Ask reachable system-wide (desktop hotkey) and context-aware (selected text, screenshot, current window).
- The Claude-over-ChatGPT ratio and the AI CLIs at the top of Homebrew show ProdLi's likely early adopters (Mac power users and developers) lean heavily toward AI tools. Supporting multiple model providers (Claude, OpenAI) is table stakes for this audience.
- The #34 rank of a third-party menu-bar app for AI tools shows strong appetite for small menu-bar status utilities. ProdLi's tray could show glanceable state (Pomodoro countdown, today's tasks, time tracked).

### Gaps
- No official 2025–2026 MAU for Zoom, Slack, Teams (newest official figure is FY2024) or Notion DAU.
- No official usage for the ChatGPT or Claude desktop apps specifically. Homebrew counts include upgrades and reinstalls and cover only Homebrew users.
- Google Workspace paying-customer counts conflict (8M vs 9M) and none are recent official figures.

---

## 2. Most popular Mac utilities and productivity apps

### Takeaway
On Homebrew, the most-installed Mac productivity utilities are, in order: Stats (system monitor in the menu bar), Raycast, Rectangle, Maccy, BetterDisplay, AeroSpace, AltTab, Karabiner, Ice and HiddenBar. Free and open-source tools beat paid incumbents by a wide margin: Ice beats Bartender about 7×, Shottr beats CleanShot about 3.5×, and Raycast beats Alfred about 4.7×. macOS Tahoe (26) built clipboard history, Actions and "Quick Keys" into Spotlight, which sets a baseline that third-party launchers (and ProdLi) now have to beat.

### Cited Findings
**Homebrew 365-day cask installs (to 22 Nov 2026, 26.8M events, includes upgrades and reinstalls)** — all from [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)
| Category | App (cask) | Rank | Installs |
|---|---|---|---|
| Notes | obsidian | 19 | 219,444 |
| System monitor (menu bar) | stats | 26 | 152,641 |
| Launcher | raycast | 42 | 119,884 |
| Window management | rectangle | 43 | 119,757 |
| Clipboard history | maccy | 48 | 110,321 |
| Display | betterdisplay | 52 | 96,388 |
| Tiling WM | nikitabobko/tap/aerospace | 78 | 63,495 |
| Window switcher | alt-tab | 79 | 63,393 |
| Keyboard remap | karabiner-elements | 84 | 59,318 |
| Menu-bar organiser | jordanbaird-ice | 88 | 58,025 |
| Uninstaller | appcleaner | 98 | 49,781 |
| Menu-bar hider | hiddenbar | 139 | 33,143 |
| Screenshot | shottr | 159 | 27,946 |
| Launcher | alfred | 163 | 25,612 |
| Keep-awake | keepingyouawake | 253 | 14,924 |
| Dictation | wispr-flow | 280 | 13,237 |
| Text expander | espanso | 317 | 10,462 |
| Dictation | superwhisper | 343 | 9,114 |
| Menu-bar organiser | bartender | 364 | 8,341 |
| Screenshot | cleanshot | 376 | 7,850 |
| Meeting notes | granola | 440 | 6,619 |
| Tasks | todoist-app | 474 | 5,955 |
| Screen video | loom | 527 | 5,132 |
| Time tracking | activitywatch | 669 | 3,655 |
| Tasks | ticktick | 716 | 3,364 |
- Not found in Homebrew analytics: TextExpander, Amphetamine and Magnet (Mac App Store apps), Toggl Track, Rize, Timing, Freedom and Cold Turkey. — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**GitHub stars (pulled 23 Nov 2026)** — [GitHub API](https://api.github.com/repos/exelban/stats)
- Stats 43,570; Rectangle 30,319; Ice 30,084; AeroSpace 23,924; Maccy 22,423; AltTab 16,554; Espanso 14,820 (cross-platform); ActivityWatch 19,785 (cross-platform); raycast/extensions 7,851. — GitHub API: [exelban/stats](https://api.github.com/repos/exelban/stats), [rxhanson/Rectangle](https://api.github.com/repos/rxhanson/Rectangle), [jordanbaird/Ice](https://api.github.com/repos/jordanbaird/Ice), [p0deje/Maccy](https://api.github.com/repos/p0deje/Maccy), [espanso/espanso](https://api.github.com/repos/espanso/espanso)

**Spotlight in macOS Tahoe (26), shipped fall 2025**
- Spotlight can now run Shortcuts and a large set of system and app actions (send an email, set a reminder, play a podcast). "Quick Keys" are short character combinations bound to actions, for example "sm" to send a message or "ar" to add a reminder. Users can assign their own, via Cmd+Space then Cmd+3 (Actions) then Add Quick Key. — [MacRumors, Do More With Spotlight in Tahoe](https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/); [MacRumors WWDC report (Jun 2025)](https://www.macrumors.com/2025/06/09/apple-supercharges-spotlight-in-macos-tahoe-with-quick-keys-and-more/); [TechCrunch](https://techcrunch.com/2025/06/09/apple-updates-spotlight-to-take-actions-on-your-mac/)
- Spotlight now has a clipboard history mode (Cmd+Space then Cmd+4) that supports text, files and more. macOS 26.1 added a retention setting (30 min, 8 h or 7 days, or off) and a "Clear Clipboard History" button. The default is about 8 hours. — [MacRumors](https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/); [AppleInsider](https://appleinsider.com/inside/macos-tahoe/tips/spotlight-got-a-huge-upgrade-in-macos-tahoe-heres-how-to-use-it)

**Raycast**
- Raised a $30M Series B (Sep 2024, led by Atomico) to build Windows and iOS apps. Total funding is about $47.85M across 6 rounds (CB Insights). — [Raycast blog](https://raycast.com/blog/series-b); [TechCrunch](https://techcrunch.com/2024/09/25/raycast-raises-30m-to-bring-its-mac-productivity-app-to-windows-and-ios); [CB Insights](https://www.cbinsights.com/company/raycast/financials)
- The Windows public beta launched 20 Nov 2025 for free, with Quick AI free during the beta. I found no confirmation of a full (non-beta) Windows release. — [Impress Watch (JP)](https://forest.watch.impress.co.jp/docs/news/2073823.html); [Raycast careers timeline](https://www.raycast.com/careers)
- Pricing (secondary blogs): Pro about $10/month monthly or $96/year (about $8/month). Higher tiers are reported at $20/month and $50/month. — [Techpresso (secondary)](https://academy.techpresso.co/reviews/is-raycast-worth-it); [raycast-discount-code (secondary)](https://raycast-discount-code.com/blog/raycast-pricing-2026)

**Alfred**
- Powerpack single licence £34 one-time; Mega Supporter £59 (lifetime upgrades). — [TechLila (secondary)](https://www.techlila.com/raycast-vs-alfred/); [aiproductivity.ai (secondary)](https://aiproductivity.ai/blog/raycast-vs-alfred-2026/)

**Setapp (CleanShot X, Bartender)**
- Setapp's own "most valuable" list puts CleanShot X (screenshot and recording; replaces Snappy, Lightshot, Shottr and Xnip) and Bartender (menu-bar organiser, $60 standalone) near the top. CleanShot X is described as "one of the most practical and well-loved apps on Setapp" with 12k+ ratings and a 99% score. The list is editorial, not download data. — [Setapp: most valuable Mac apps](https://setapp.com/app-reviews/most-valuable-mac-apps); [Setapp: best Setapp apps](https://setapp.com/app-reviews/best-setapp-apps)
- Setapp's "most downloaded Mac apps" article is based on App Store downloads and review sites, not Setapp telemetry, and gives no counts. — [Setapp](https://setapp.com/app-reviews/most-downloaded-mac-apps)

### Inferences
- Six of the ten most-installed Mac utilities live in the menu bar or run as background agents (Stats, Maccy, Ice, HiddenBar, KeepingYouAwake, Rectangle). Mac power users clearly want small, single-purpose, always-on tools behind a hotkey. ProdLi's Electron tray is the right surface, but each feature has to feel as fast as a native single-purpose app.
- Free and open-source tools dominate Homebrew (Ice > Bartender, Shottr > CleanShot, Maccy as #1 clipboard tool, Espanso). For Mac users, utility features are close to commodities. ProdLi should bundle them as free hooks that feed its paid core (tasks, notes, meetings, AI), not sell them as premium features.
- Tahoe's built-in clipboard history (8 hours by default, up to 7 days) and Quick Keys raise the floor. A ProdLi clipboard or launcher only adds value if it does more: longer and searchable history, synced across devices and the web app, pinning, "send clip to note or task", and AI transforms.
- Raycast's move to Windows (beta Nov 2025) shows that even the category leader sees cross-platform as important. ProdLi's Chrome + web + Electron (Mac and Windows) reach is a real differentiator against Mac-only utilities.

### Gaps
- No usage data found for Things 3, Fantastical, Bear, Craft, Drafts, Amphetamine or Magnet (App Store-only, so not in Homebrew). Their pricing was not verified this session.
- CleanShot X and TextExpander official pricing not verified (secondary sources conflict: TextExpander $3.33–$4.17/month).
- No Setapp telemetry-based "most used" ranking for 2025–2026 was found. Setapp publishes only editorial lists.
- Raycast user counts not found.

---

## 3. Most popular Windows utilities and productivity apps

### Takeaway
Microsoft PowerToys is the dominant Windows power-user utility suite (141k GitHub stars, the most of any tool checked). In 2025–2026 Microsoft has turned its Command Palette (the replacement for PowerToys Run) into a full Raycast-style launcher with extensions, an extension gallery and a Dock. The built-in Snipping Tool now covers OCR (Text Extractor), screen recording and GIF export, which commoditises basic capture on Windows. ShareX (41k stars) and Flow Launcher (16k) remain the leading third-party open-source options.

### Cited Findings
**PowerToys / Command Palette timeline (Microsoft dev blog)**
- 0.91 (May 2025): PowerToys Run v1 calculator ported into Command Palette, plus settings and better fallbacks. — [Neowin](https://www.neowin.net/news/powertoys-091-is-out-with-improved-command-palette-launcher-and-more/)
- 0.93 (Aug 2025): faster Command Palette and a new Settings dashboard. — [MS DevBlogs 0.93](https://devblogs.microsoft.com/commandline/powertoys-0-93-is-here-faster-command-palette-new-dashboard-ux-and-more/)
- 0.94 (Sep 2025): Settings search and shortcut conflict detection. — [MS DevBlogs 0.94](https://devblogs.microsoft.com/commandline/powertoys-0-94-is-here-settings-search-shortcut-conflict-detection-and-more/)
- 0.95 (Oct 2025): new Light Switch utility, a new fuzzy matcher for Command Palette, and Peek opened with the spacebar. — [MS DevBlogs 0.95](https://devblogs.microsoft.com/commandline/powertoys-0-95-is-here-new-light-switch-utility-faster-command-palette-and-peek-with-spacebar/)
- 0.96 (Nov 2025): Advanced Paste gained endpoints for more AI model providers; PowerRename gained metadata support. — [MS DevBlogs 0.96](https://devblogs.microsoft.com/commandline/powertoys-0-96-is-here-endpoints-for-advanced-paste-metadata-support-for-powerrename-and-more); [BetaNews](https://betanews.com/2025/11/19/microsoft-releases-powertoys-v0-96-0-with-support-for-more-ai-model-providers/)
- 0.97 (Jan 2026): big Command Palette update (Personalization page, a built-in extension to control PowerToys) and the CursorWrap mouse utility. — [MS DevBlogs 0.97](https://devblogs.microsoft.com/commandline/powertoys-0-97-is-here-a-big-command-palette-update-and-a-new-mouse-utility/)
- 0.100 (Jun 2026): new Shortcut Guide, a Command Palette Extension Gallery and multi-monitor Dock. — [MS DevBlogs 0.100](https://devblogs.microsoft.com/commandline/powertoys-0-100-is-here-new-shortcut-guide-command-palette-improvements-and-much-more/)
- 0.101 (Aug 2026): Window Hopper and Command Palette compact mode, per search summary. 0.102 (Mouse Button Lock, CursorHide, a Command Palette quick-access shelf, snip dictation in ZoomIt) comes from a secondary source with an unconfirmed date. — [MS DevBlogs (Aug 2026 post)](https://devblogs.microsoft.com/commandline/?p=11731)
- PowerToys GitHub repo: 141,305 stars, pushed 22 Nov 2026. — [GitHub API microsoft/PowerToys](https://api.github.com/repos/microsoft/PowerToys)

**Snipping Tool (built into Windows 11)**
- Snipping Tool added a Text Extractor (OCR) that copies text to the clipboard without saving a screenshot. — [BleepingComputer](https://www.bleepingcomputer.com/news/microsoft/windows-snipping-tool-now-lets-you-create-animated-gif-recordings/)
- GIF export for screen recordings (clips of 30 seconds or less, via Win+Shift+R then Export GIF) reached Insiders in mid-2025 (v11.2505.21.0). Wikipedia lists v11.2511.31.0 (Jan 2026) and screen recording since a 7 Nov 2025 update. I found no source confirming GIF export reached stable builds. — [Neowin](https://www.neowin.net/news/windows-11-snipping-tool-gets-a-useful-new-screen-recording-feature/); [ElevenForum](https://www.elevenforum.com/t/gif-export-in-snipping-tool-begins-rolling-out-to-windows-insiders-on-windows-11.37170/); [Wikipedia: Snipping Tool](https://en.wikipedia.org/wiki/Snipping_Tool)

**Open-source Windows utilities (GitHub stars, 23 Nov 2026)**
- ShareX 41,314; Notepad++ 29,951; Flow Launcher 16,070; Ditto (clipboard) 7,516; Espanso (cross-platform text expander) 14,820. — GitHub API: [ShareX](https://api.github.com/repos/ShareX/ShareX), [Notepad++](https://api.github.com/repos/notepad-plus-plus/notepad-plus-plus), [Flow Launcher](https://api.github.com/repos/Flow-Launcher/Flow.Launcher), [Ditto](https://api.github.com/repos/sabrogden/Ditto)

**Raycast for Windows**
- Public beta since 20 Nov 2025, free during beta. — [Impress Watch](https://forest.watch.impress.co.jp/docs/news/2073823.html)

### Inferences
- On Windows, Microsoft itself covers launcher (Command Palette), window zones (FancyZones), OCR (Text Extractor in PowerToys and Snipping Tool), quick-look (Peek) and AI paste (Advanced Paste). It is hard for ProdLi to win on pure utilities there. The opening is integration: utilities that route output into ProdLi's tasks, notes and AI (for example "OCR this region into a note", "Advanced Paste-style AI transform from clipboard history").
- PowerToys Advanced Paste (AI transforms on clipboard contents, now with multiple model providers) is the closest Windows analogue to "clipboard + AI Ask". ProdLi already has AI Ask, so a clipboard-aware AI action would be cheap differentiation.

### Gaps
- No public winget or Microsoft Store top-installs ranking was found. Neither Microsoft nor winget publishes per-package install counts comparable to Homebrew.
- No usage figures found this session for Everything (voidtools), Microsoft To Do, OneNote, Windows Copilot app, or Clipchamp.

---

## 4. Cross-platform apps: dictation, meetings, time tracking, blocking, tasks

### Takeaway
Two categories next to ProdLi's roadmap have drawn very large funding in 2025–2026. AI dictation: Wispr Flow raised a $280M Series B at a $2B valuation (Aug 2026, figures mostly from secondary sources). Botless meeting notes: Granola raised a $125M Series C at a $1.5B valuation (Mar 2026). Time tracking and blocking tools are smaller and steady: Toggl claims 5M+ users, Freedom 2.5–4M (company claims), and Rize charges $9.99–$39.99/month with no free tier.

### Cited Findings
**Dictation**
- Wispr Flow: $280M Series B at a $2B valuation (Aug 2026, led by Menlo Ventures), total funding about $361–362M. The prior valuation was about $700M (June 2025 Series A plus a Nov 2025 extension). The company reports 60B+ words written with Flow and use at 10,000+ enterprises. These are mostly secondary or SEO sources, so verify. — [SQ Magazine](https://sqmagazine.co.uk/wispr-280-million-series-b-2-billion-valuation/); [Tracxn](https://tracxn.com/d/companies/wispr-flow/__XTPty9fIPUjngX0uMeYcKZnHJVG4WCoPwSamLLI2QjE); [Wikipedia: Wispr Flow](https://en.wikipedia.org/wiki/Wispr_Flow)
- Superwhisper appears bootstrapped (no outside funding), with "hundreds of thousands of weekly active users" as of May 2026 (single profile, unverified). — [LeadWave](https://getleadwave.io/dossier/superwhisper)
- Homebrew: wispr-flow #280 (13,237), superwhisper #343 (9,114). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Meeting notes**
- Granola: $125M Series C at a $1.5B valuation (25 Mar 2026), led by Index Ventures with Kleiner Perkins. The prior round was a $43M Series B at $250M (May 2025). Bloomberg reported 250% quarterly revenue growth. The company launched Spaces (team workspaces), personal and enterprise APIs, and an MCP server. — [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/); [The Next Web](https://thenextweb.com/news/granola-series-c-meeting-ai-enterprise-context)
- Homebrew granola: #440 (6,619). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

**Time tracking**
- Rize: Basic $9.99, Pro $23.99, Max $39.99 per month (billed annually). Teams from $29.99/seat/month. No free tier; 7-day trial. — [Rize pricing comparison (vendor)](https://rize.io/blog/time-tracking-software-pricing-comparison); [G2](https://www.g2.com/products/rize/pricing)
- Toggl Track: one source claims 5M+ users in 120 countries. Free-plan size is reported as 5 users (older) or 3 users (newer combined "Toggl" product). Starter is $9 and Premium $16. — [TimeCamp](https://www.timecamp.com/blog/what-is-toggl-track/); [gettimen](https://www.gettimen.com/articles/is-toggl-track-free); [Toggl community](https://community.toggl.com/t/toggl-2-0-for-toggl-track-users-your-questions-answered/4798)
- ActivityWatch (open-source, local-first automatic tracker): 19,785 GitHub stars; Homebrew #669 (3,655). — [GitHub API](https://api.github.com/repos/ActivityWatch/activitywatch); [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/)

**Blocking**
- Freedom: user counts are cited as 2.5M+ or 4M+ (company claims). The free plan doesn't expire. Reviewers note blocking can fail if users disable the app or VPN from system settings. A 2025 PNAS Nexus randomized trial had 467 people block mobile internet with Freedom for two weeks. — [Wikipedia: Freedom](https://en.wikipedia.org/wiki/Freedom_(application)); [Blok review](https://www.blok.so/resources/freedom-app-review-does-blocking-websites-and-apps-actually-work); [Freedom](https://freedom.to/)

**Tasks / other**
- Homebrew todoist-app #474 (5,955), ticktick #716 (3,364), loom #527 (5,132), spotify #51 (100,728), 1password #75 (65,617), bitwarden #85 (59,053). — [Homebrew cask analytics](https://formulae.brew.sh/analytics/cask-install/365d/)

### Inferences
- Investors are rewarding the exact two features ProdLi already has, botless meeting notes and voice dictation, at unicorn valuations. ProdLi's pitch is that it bundles a Granola-like and a Wispr-like feature with tasks, notes and habits. Making dictation system-wide (desktop) is the single highest-value desktop feature, because that is the whole Wispr Flow and Superwhisper product.
- Granola's move into team Spaces, APIs and MCP suggests meeting-notes tools win on what happens to notes after the meeting (searchable company memory, AI over transcripts). ProdLi's notes, to-dos and AI Ask can play the same role, for example auto-creating action items as to-dos.
- Rize ($10–40/month, no free tier) and Toggl show users pay for automatic, app-level time tracking. ProdLi has per-website tracking. Extending it to per-app tracking on desktop makes it a Rize/Timing-style product, which pairs well with Pomodoro and habits.
- Freedom's known weakness (users disable it) and ProdLi's browser presence suggest ProdLi can do site blocking well in the browser (declarativeNetRequest) and add app blocking on desktop as a softer "nudge" rather than a hard lock.

### Gaps
- Granola user counts not disclosed. Wispr Flow and Superwhisper user counts unverified.
- No current pricing verified this session for Wispr Flow, Superwhisper, Granola, Loom, Todoist, TickTick, Timing, Cold Turkey or Freedom paid tiers.
- No usage data found for Timing (Mac), Cold Turkey or RescueTime in 2025–2026.

---

## 5. Which features recur and are loved

### Takeaway
Across Mac and Windows, these feature patterns recur, in rough order of install evidence: (1) launcher or command palette, (2) window management, (3) clipboard history, (4) menu-bar or tray status utilities, (5) screenshot + OCR + annotate, (6) AI dictation, (7) text expansion, (8) keep-awake, (9) automatic time tracking, (10) meeting notes. The OS vendors absorbed 1, 3 and 5 in 2025 (Spotlight in Tahoe, PowerToys Command Palette and Text Extractor, Snipping Tool OCR and recording), so standalone value now comes from sync, AI and integration with personal data.

### Cited Findings
- Launcher: Raycast #42 (119,884), Alfred #163 (25,612), Flow Launcher 16k stars, and PowerToys Command Palette actively developed through 2026 with an extension gallery. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/); [GitHub API](https://api.github.com/repos/Flow-Launcher/Flow.Launcher); [MS DevBlogs 0.100](https://devblogs.microsoft.com/commandline/powertoys-0-100-is-here-new-shortcut-guide-command-palette-improvements-and-much-more/)
- Window management: Rectangle #43 (119,757), AeroSpace #78, AltTab #79, Rectangle 30k stars; FancyZones and Window Hopper in PowerToys. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/); [GitHub API](https://api.github.com/repos/rxhanson/Rectangle)
- Clipboard history: Maccy #48 (110,321; 22k stars); Ditto 7.5k stars; Apple added it to Spotlight in Tahoe. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/); [MacRumors](https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/)
- Menu-bar status and organising: Stats #26 (152,641; 43.6k stars), Ice #88, HiddenBar #139, codexbar #34. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/)
- Screenshot + OCR: Shottr #159, CleanShot X (Setapp 99% from 12k+ ratings), ShareX 41k stars, Snipping Tool Text Extractor. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/); [Setapp](https://setapp.com/app-reviews/best-setapp-apps); [BleepingComputer](https://www.bleepingcomputer.com/news/microsoft/windows-snipping-tool-now-lets-you-create-animated-gif-recordings/)
- AI on clipboard: PowerToys Advanced Paste gained multi-provider AI endpoints in 0.96. — [MS DevBlogs 0.96](https://devblogs.microsoft.com/commandline/powertoys-0-96-is-here-endpoints-for-advanced-paste-metadata-support-for-powerrename-and-more)
- Dictation: Wispr Flow at a $2B valuation; Superwhisper bootstrapped with "hundreds of thousands" WAU. — [SQ Magazine](https://sqmagazine.co.uk/wispr-280-million-series-b-2-billion-valuation/); [LeadWave](https://getleadwave.io/dossier/superwhisper)
- Text expansion: Espanso #317 and 14.8k stars. — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/)
- Quick actions with short aliases: Spotlight Quick Keys ("ar" adds a reminder). — [MacRumors](https://www.macrumors.com/2025/06/09/apple-supercharges-spotlight-in-macos-tahoe-with-quick-keys-and-more/)
- Keep-awake: KeepingYouAwake #253 (14,924). — [Homebrew](https://formulae.brew.sh/analytics/cask-install/365d/)

### Inferences
- Apple's Quick Keys ("ar" adds a reminder) map directly onto ProdLi's Quick add. Adding typed prefixes (for example "t " for a to-do, "n " for a note, "h " for a habit check-in, "p 25" to start a Pomodoro, "? " for AI Ask) inside one global palette would match the pattern users now learn from the OS.
- The loved pattern is "global hotkey → tiny floating window → action → disappear". Every feature ProdLi adds on desktop should fit that one interaction model (a single palette window), which also keeps solo-dev effort down.

### Gaps
- No user-satisfaction surveys (NPS, Reddit sentiment data) gathered this session. "Loved" is inferred from installs, stars and Setapp ratings.

---

## 6. Feasibility for ProdLi: browser extension or web app vs Electron, and solo-dev effort

### Takeaway
Most of the high-demand utilities need OS-level access a Chrome extension can't get: system-wide clipboard monitoring, keystroke hooks for text expansion, other apps' windows, app-level time tracking, and system-wide dictation insertion. These belong in the Electron app. Inside the browser, ProdLi can do tab and screen recording with share links, page screenshot + annotate + OCR, a command palette on web pages, site blocking, and a limited global hotkey (Chrome caps suggested global shortcuts at Ctrl+Shift+0–9). Best ROI for a solo developer: (1) one global command palette in Electron that unifies Quick add, AI Ask, search and Pomodoro; (2) system-wide dictation; (3) per-app time tracking extending the existing per-site tracker; (4) clipboard history with "send to note or task"; (5) screenshot + OCR into notes.

### Cited Findings
- Chrome extension global shortcuts: "Global commands also work while Chrome does not have focus". Suggested keys for global commands are "limited to Ctrl+Shift+[0..9]"; users can remap them at chrome://extensions/shortcuts. ChromeOS does not support global commands. An extension may suggest at most four keyboard shortcuts. — [Chrome Extensions docs: chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- Electron screen capture: `desktopCapturer.getSources()` (main process) lists screens and windows. The renderer calls `getDisplayMedia()` and the main process answers via `session.setDisplayMediaRequestHandler()`, optionally with system audio (`audio: 'loopback'`) and an experimental system picker. — [Electron docs: desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- macOS screen capture needs user consent on 10.15+ (check with `systemPreferences.getMediaAccessStatus`). System audio capture on macOS 14.2+ requires the `NSAudioCaptureUsageDescription` Info.plist key. If permission is missing, the audio track is created in the "ended" state and never delivers samples, with no JS error. Since Electron 39, CoreAudio Tap is the default with "no automatic fallback" to ScreenCaptureKit. — [Electron docs: desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)

### Inferences

Feasibility and effort matrix. Effort is for one developer reusing ProdLi's existing stack; S ≈ under 1 week, M ≈ 1–3 weeks, L ≈ 1–2 months. Platform statements not cited above are well-known Chrome and Electron API behaviour that wasn't re-verified this session.

| Feature (who has it) | ProdLi status | Browser extension / web app | Electron needed for | OS permissions | Effort |
|---|---|---|---|---|---|
| Global quick capture hotkey (Things, Todoist, Spotlight Quick Keys) | **Present** (Electron Quick add); extension can add a Ctrl+Shift+digit global command | Yes, limited: Chrome global command, Ctrl+Shift+0–9 only, Chrome must be running | Any key combo, works without Chrome, floating window | None (Electron `globalShortcut`) | S (extend) |
| Command palette / launcher (Raycast, Alfred, Command Palette, Flow) | **New** (Quick add is a seed) | In-page palette (content script) and new-tab or web-app palette covering ProdLi data and tabs, bookmarks, history | Launching apps, searching local files, system actions, palette over any app | None for the palette itself; file search via Spotlight `mdfind` or Windows Search | M (ProdLi-scoped palette); L (full launcher with app/file search and extensions) |
| AI Ask from anywhere, with selected text or screenshot as context (Raycast AI, ChatGPT/Claude desktop hotkeys) | **AI Ask present**; system-wide context is new | Yes on web pages (selection via content script) | Reading selection in other apps (simulate Cmd+C or Accessibility API), screenshot context | Accessibility (macOS) for selection; Screen Recording for screenshot context | M |
| System-wide dictation (Wispr Flow, Superwhisper) | **Planned** (extension dictation present) | Only inside web pages | Global push-to-talk hotkey, mic capture, paste into focused app | Microphone; Accessibility (macOS) to simulate paste; on Windows, SendInput | M (reuse existing STT; hard parts are hotkey hold/release, paste injection, latency) |
| Clipboard history (Maccy, Paste, Ditto, Tahoe Spotlight) | **New** | No. Extensions can read the clipboard only on user action, not continuously | Polling the `clipboard` module, local encrypted store, palette UI, "send to note or task", AI transform | None to read; Accessibility to auto-paste on macOS | M |
| Text expansion (TextExpander, Espanso) | **New** | Partial: content script expanding snippets in browser text fields | System-wide needs a global keyboard hook (native module such as uiohook) plus simulated typing | Accessibility + Input Monitoring (macOS); low-level keyboard hook (Windows); fragile with secure fields and IMEs | M (browser-only); L (system-wide, best left to the browser) |
| Screenshot + annotate + OCR (CleanShot, Shottr, ShareX, Snipping Tool) | **New** | Yes for visible tab (`captureVisibleTab`), annotate in web canvas, OCR via Tesseract.js/WASM or cloud AI | Region capture of whole screen or any app | Screen Recording (macOS) | M (tab-only); M–L (desktop region capture + annotator) |
| Screen recording with share links (Loom, CleanShot Cloud, ShareX) | **New** | Yes: tab or screen capture via `getDisplayMedia` / `chrome.tabCapture` / offscreen document, upload to ProdLi storage, share link | Better system audio, camera bubble overlay, recording any app without the browser | Screen Recording, Microphone, Camera; System Audio (macOS 14.2+ Info.plist key) | L (storage, transcoding, hosting and bandwidth cost) |
| App-level automatic time tracking (Rize, Timing, RescueTime, ActivityWatch) | **New** (per-website tracking present) | Website-level only (present) | Frontmost-app and window-title polling, idle detection | macOS: window titles need Screen Recording or Accessibility; frontmost app name needs none. Windows: Win32 foreground window | M (merge with existing website timeline; ActivityWatch shows the pattern) |
| Menu-bar / tray timer and glanceable status (Stats-style, Session, Be Focused) | **Partial** (tray present; Pomodoro present) | Extension badge text only | Live countdown in menu-bar title (macOS `tray.setTitle`), tray menu with today's tasks | None | S |
| Site and app blocking (Freedom, Cold Turkey) | Site blocking likely feasible now; app blocking **new** | Yes for sites (declarativeNetRequest), tied to Pomodoro sessions | Detect and hide or kill distracting apps during focus sessions | None to detect the frontmost app; killing apps is possible but heavy-handed | S (sites); M (apps) |
| Window management / snapping (Rectangle, FancyZones, AeroSpace) | **New** | No | Moving other apps' windows needs native APIs (macOS AX API via native module; Windows SetWindowPos) | Accessibility (macOS) | L. Low strategic fit; Rectangle and FancyZones are free and the OS has built-in tiling. Skip. |
| Global file search (Everything, Spotlight, Alfred) | **Partial** (local file viewer present) | No (only user-picked files via File System Access API) | Shell out to `mdfind` (macOS) or Windows Search / Everything SDK, show in palette | Full Disk Access is not needed for Spotlight-indexed results | M |
| Keep-awake (Amphetamine, KeepingYouAwake, PowerToys Awake) | **New** | No | `powerSaveBlocker` API, toggle from tray or automatically during Pomodoro or meeting recording | None | S (cheap tray toggle; also prevents sleep during meeting recording) |
| Meeting notes (Granola) | **Present** (botless) | Present in browser (Meet etc.) | Desktop: capture Zoom/Teams native-app audio via system audio loopback | Microphone + System Audio Recording (macOS 14.2+) | Already in progress |

Recommendations, in order of value per unit of solo-dev effort:
1. **Unified global palette (Electron)**: grow Quick add into one Cmd/Ctrl+Space-style window with typed prefixes (Apple Quick Keys pattern). It covers to-do, note, habit, Pomodoro start, AI Ask, ProdLi search and later clipboard and file search. This is the shell every later feature plugs into. Effort M.
2. **System-wide dictation (Electron)**: the Wispr Flow / Superwhisper category is worth billions in valuation. ProdLi already has STT in the extension. Effort M.
3. **Per-app time tracking + tray timer (Electron)**: extends existing per-site tracking and Pomodoro into a Rize/Timing-style "where did my day go" timeline. Rize charges $10–40/month. Effort M + S.
4. **Clipboard history with "send to note or task" and AI transforms (Electron)**: beats Tahoe's 8-hour, unsynced history by syncing to the web app and integrating AI. Effort M.
5. **Screenshot + OCR into notes**: browser first (visible tab), desktop region capture later. Effort M.
6. **Cheap wins**: keep-awake toggle and auto keep-awake during recording or focus (S); focus-session site blocking in the extension (S); Ctrl+Shift+digit global command in the extension (S).
7. **Skip or defer**: window management (free OS and open-source alternatives, Accessibility-heavy, off-mission); system-wide text expansion (keyboard hooks are fragile; do browser-only expansion if at all); full Loom-style hosted recording (hosting and bandwidth cost) unless meeting notes already provides the storage pipeline.

macOS permission burden: Accessibility, Screen Recording, Microphone, Input Monitoring and System Audio each need their own System Settings toggle, and unsigned or rebuilt apps may lose grants. Bundle the permission requests behind features (ask only when a feature is first used) and make sure the Electron app is signed and notarized so TCC grants persist across updates.

### Gaps
- Chrome `tabCapture`/`desktopCapture`/offscreen-document recording limits and `captureVisibleTab` rate limits were not re-verified this session.
- Exact macOS TCC requirements for reading other apps' window titles (Screen Recording vs Accessibility) differ by macOS version. Not verified for Tahoe.
- Effort estimates are judgement-based, not benchmarked against ProdLi's codebase.
