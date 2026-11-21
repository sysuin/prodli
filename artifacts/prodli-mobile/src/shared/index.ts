// Logic shared with the extension and web app. These files live in
// artifacts/prodli/src and are pure (no browser or Chrome APIs), so the phone
// app uses the very same code: same sync rules, same repeating to-dos, same
// habit streaks, same smart add. Change them there, and both apps follow.
export * from "../../../prodli/src/lib/syncCore";
export { nextOccurrence, nextDue, firstOccurrence, repeatLabel, toggleTodo, reminderAt, timeLabel } from "../../../prodli/src/lib/recurrence";
export { kindOf, isScheduled, amountOn, targetOf, isDone, currentStreak, bestStreak, setAmount, addAmount, toggleCheck, toggleSkip, progressLabel, dayLevel, type HabitKind } from "../../../prodli/src/lib/habits";
export { parseTask, type ParsedTask } from "../../../prodli/src/lib/taskParse";
export { boardColumn, quadrant, isImportant, isUrgent, moveToColumn, moveToQuadrant, describeMove, BOARD_COLUMNS, QUADRANTS, type BoardColumn, type Quadrant } from "../../../prodli/src/lib/todoBoards";
export { getDayKey, generateId } from "../../../prodli/src/lib/utils";
export { RATE, AUDIO_SPEAKER, Resampler, Segmenter, encodeWav, toEntries, type Piece, type PieceResult, type AudioEntry } from "../../../prodli/src/recorder/audioPieces";
export { addDays, weekStart, defaultReviewWeek, weekDays, weekLabel, weekStats, reviewContext, basicReview, reviewDue, type WeekStats, type ReviewContext, type ReviewMeeting } from "../../../prodli/src/lib/reviewCore";
export { BUILTIN_TEMPLATES, fillTemplate, newNoteFromTemplate, buildDailyNote, type BuiltinTemplate } from "../../../prodli/src/lib/noteTemplatesCore";
export type { Note, Todo, Subtask, Repeat, Habit, DayRecord, DailyBrief, WeeklyReview, ListItem, TaskQuery, QuickLink, ReadLaterItem, TabSession, TimeTrackingDay } from "../../../prodli/src/types";
