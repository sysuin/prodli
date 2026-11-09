# ProdLi as a personal AI assistant: research and plan

Goal: ProdLi helps people plan their day, starting with an AI daily brief built from what they already keep in ProdLi.

## What leading tools do (research, November 2026)

| Tool | Known for | What ProdLi takes from it |
|---|---|---|
| **Sunsama** | guided daily planning ritual; evening shutdown | **Plan your day** (pick today's tasks, estimate them, see if they fit) and **Wrap up the day** (done list, move the rest to tomorrow, reflection) |
| **Motion** | AI rebuilds your day around meetings | **Suggested schedule** in the brief: focus blocks for priorities in free time around calendar events |
| **Reclaim.ai** | protects focus time and habits on the calendar | the schedule includes breaks; **habit nudges** with streaks |
| **Akiflow** | one inbox for tasks from everywhere | meeting action items flow into the brief and can become planned tasks (☀️ Plan) |
| **Momentum** (new-tab extension) | one daily focus, greeting | **Main focus** for the day and a greeting on Today |
| **Gemini Daily Brief** and briefing apps (Vellum, BriefingAM, DailyStack) | morning snapshot of priorities from calendar, tasks and email; overdue flagged | the **daily brief** itself: headline, top priorities, schedule, watch-outs, habits, tip; a **morning reminder** |

The approaches split into **automatic schedulers** (Motion, Reclaim) and **guided rituals** (Sunsama). ProdLi does both lightly:
- the AI suggests a schedule;
- the user stays in control of what's planned.

## Built now (Today section)

- **Today** is the first section. The first ProdLi tab each day opens on it; this can be turned off.
- **Main focus:** one line for the day, which the brief uses.
- **Daily brief:**
  - With a ProdLi account, Claude Haiku 5.5 writes it through `/api/ai/brief`. It includes a headline, summary, top 3 priorities, a suggested schedule around calendar events within working hours, watch-outs (overdue items, overload), habit nudges and a tip based on yesterday.
  - Without an account (or offline, or when the allowance is used up), a **basic brief** is built on the device.
  - The brief is written automatically on the first visit each day and saved with the day (synced).
- **What it reads:**
  - to-dos (planned, overdue, due, priority, estimates);
  - habits and streaks;
  - Google Calendar events (optional);
  - recent meeting action items not already in To-Dos;
  - yesterday's Time Tracker top sites and Pomodoro sessions;
  - yesterday's reflection and the day's focus.
  
  It's capped at 60 tasks and about 40 KB.
- **Plan your day:** ☀️ adds a task to today. Time estimates are summed and compared with the free time left (working hours minus meetings), with a warning when there's too much.
- **Agenda:** Google Calendar, read-only and optional. Events are read in the browser and never stored on ProdLi's servers. There's a "Join" link for Meet events.
- **Habits today:** one-tap check-off.
- **Wrap up the day:** what got done today, "Move to tomorrow" for unfinished planned tasks, and a reflection that tomorrow's brief reads.
- **Morning reminder** (extension): a notification at a chosen time (default 08:30) that opens Today. It's skipped if Today was already opened that day.
- **Allowance:** 62 AI briefs a month on Free (two a day), 200 on Pro. Separate from meeting summaries. Failed briefs aren't counted.
- **Sync:** a new `days` collection (focus, reflection, brief). To-dos gain `plannedFor`, `estimateMin` and `completedAt`.

## Built next: Ask ProdLi, Add to ProdLi, new layout

- **Ask ProdLi** (`/api/ai/ask`; 100 questions a month on Free, 1,000 on Pro):
  - **Where:** a chat panel that opens from the sidebar, the phone tab bar, the command palette ("Ask ProdLi: …") or the box on Today.
  - **What it reads:** the same day information as the brief, plus up to 8 note and meeting excerpts that match the question, chosen on the device (`pickSnippets`).
  - **Actions:** answers can suggest them (add a to-do, plan for today, save a note), and they apply only when clicked.
  - **Privacy:** the chat isn't stored or synced.
- **Add to ProdLi:**
  - **Right-click menu** on any page, link or selection: "Add to ProdLi to-dos" or "Save to ProdLi notes", with the source link.
  - **Quick add window:** Alt+Shift+A.
  - **Phones:** "Share → ProdLi" (web app share target) and app shortcuts (Today, Quick add).
  - **Command palette:** type anything, then "Add to-do".
- **Layout:**
  - **Section list:** one list (`src/sections/registry.ts`) drives the sidebar, phone tabs, palette and shortcuts. A new section is one entry plus its component.
  - **Desktop sidebar:** grouped Plan / Create / Focus, with Ask ProdLi, Search ⌘K, Quick add, account, backup, help, theme and clock. You can collapse it to icons, and it does so automatically on narrower windows.
  - **Phones:** a slim top bar and bottom tabs (Today, Notes, To-Dos, Ask, More). More lists every section and setting.
  - **Command palette (Ctrl/⌘+K):** go anywhere, run any action, add a to-do or ask ProdLi.
  - **Naming:** "Editor" is now "Notes".

## Next (proposed)

1. **Weekly review:** a Friday summary of what got done, habits, focus time, and next week's priorities.
2. **Time-blocking on the calendar:** write the suggested focus blocks to Google Calendar (needs write access, so ask first).
3. **Email in the brief:** important unread Gmail. This uses a restricted scope that needs Google's security assessment, so it's later, and only if users ask for it.

## Needs you
- **Google Cloud console:**
  - enable the **Google Calendar API** for the project;
  - add the `calendar.readonly` scope to the OAuth consent screen. It's a "sensitive" scope, so publishing needs Google's verification: a short justification and a demo video of the Agenda card.
  
  Until then, only test users can connect a calendar.
- Review the privacy policy wording for daily briefs and calendar (in this PR).
