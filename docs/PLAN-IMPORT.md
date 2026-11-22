# Plan: importing from other apps

**Status:** parked for later (2026-11-23). Listed in [TODO.md](../TODO.md) → Next ideas.

Everything here runs in the browser: no server work, no cost, and no app review
(except Google's free review if Google Tasks is done through sign-in).

## To-dos: three ways in

ProdLi's `Todo` already has title, done, priority, due date/time, repeat, list,
labels, subtasks and created date, so importing is mostly field mapping.

1. **Paste a list (any app). Easy, ~half a day.**
   - One line = one to-do; `- [ ] Call Sam tomorrow !high #work` goes through the
     existing smart-add parser (dates, priority, list).
   - Covers apps with no export (Apple Reminders, Things copy as text).
2. **Upload an export file. Easy–medium, 2–4 days for the main apps.**
   - Preview first ("142 tasks, 6 lists, 12 repeating"), then import, with Undo.
   - A small mapper per app, plus a generic CSV with column mapping.
3. **Sign in to the other app. Medium, 1–3 days per app.**
   - One-time import, not two-way sync (sync is several times harder).
   - Google Tasks: reuses ProdLi's Google sign-in; `tasks.readonly` is "sensitive"
     like Calendar → free Google review with a demo video.
   - Todoist: personal API token (fastest) or OAuth; TickTick: OAuth. Free developer apps.
   - Microsoft To Do: no export file; Microsoft Graph sign-in (free Azure app registration).

| App | Easiest route | Difficulty |
|---|---|---|
| Todoist | CSV export or personal API token | Easy |
| TickTick | Backup CSV | Easy |
| Google Tasks | Google sign-in (free review) or Takeout file | Easy–medium |
| Microsoft To Do | Microsoft sign-in only | Medium |
| Trello / Asana / Notion / ClickUp | Their CSV/JSON export | Easy each |
| Apple Reminders / Things 3 | Paste; a real import only via the Mac desktop app | Paste easy, real import hard |
| Plain text / Markdown checklists | Paste or file | Easy |

### The fiddly parts
- Priorities: Todoist has 4 levels (its API numbers them the other way round); ProdLi has 3.
- Repeat rules: "every 2nd Tuesday", "3 days after done" don't all fit `Repeat`;
  map the common ones, put the rest in a note on the task.
- Nesting: sub-subtasks flatten into subtasks; sections become lists or labels.
- Completed tasks: user chooses skip or import as done.
- Re-importing: remember each task's original id to skip duplicates.
- Comments/attachments: into the task's notes or dropped; the preview says which.

## What people would love to import (by how much it helps switching)
1. **To-dos:** Todoist, TickTick, Microsoft To Do, Google Tasks, Apple Reminders, Things.
2. **Notes:** Notion (Markdown export), Evernote (.enex), Google Keep (Takeout),
   Obsidian/Bear (Markdown folders). ProdLi already imports a single .md; extend to
   folders/ZIPs. Apple Notes and OneNote are hard (no simple export).
3. **Meeting notes/transcripts:** Otter, Fireflies, Granola, Zoom (.txt/.vtt/.docx)
   into Meetings, with ProdLi's AI summary. Pairs with the comparison pages.
4. **Habit history:** Loop Habit Tracker, Streaks, Habitica (CSV); done days map onto `completedDays`.
5. **Calendar .ics files:** Outlook/Apple users (ProdLi only connects Google Calendar).
6. **Time tracking history:** Toggl, RescueTime (CSV) into the Time tracker.
7. **Journals:** Day One (JSON) into Notes.

## Suggested order
1. Paste a list.
2. Todoist + TickTick files and a generic CSV, with preview and Undo.
3. Google Tasks and Microsoft To Do sign-in imports.
4. Bulk notes from Notion, Evernote and Keep.
5. Meeting transcripts from Otter and Granola.
