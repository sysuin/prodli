// Two-way time blocks with Google Calendar (Today → "Show my blocks in Google Calendar").
//
// ProdLi creates its own calendar, "ProdLi", in the user's Google Calendar
// (scope calendar.app.created: ProdLi can only see and change calendars it
// created, never the user's other calendars) and keeps one event per time block
// for today and the next 7 days:
//   - a block made, moved, resized or renamed in ProdLi updates its event;
//   - an event moved or resized in Google Calendar moves the block in ProdLi;
//   - an event deleted in Google Calendar unblocks the task (the task stays);
//   - unblocking or deleting the task removes its event; done tasks keep theirs.
// Whichever side changed last wins. Busy time still comes from the primary
// calendar (read-only), so blocks are never counted twice.

import type { Todo } from "../types";
import { blockMinutes } from "./timeBlocks";
import { storageGet, storageSet } from "./storage";

export const CALENDAR_SYNC_KEY = "calendarSync";
/**
 * On unless a build sets VITE_CALENDAR_BLOCKS=0. calendar.app.created is on ProdLi's Google consent
 * screen (added 2026-11-23) and Google lists it as non-sensitive, so it needs no extra review.
 */
export const calendarBlocksAvailable = () => import.meta.env.VITE_CALENDAR_BLOCKS !== "0";
export interface CalendarSyncSettings {
  enabled: boolean;
  /** The "ProdLi" calendar's id in this Google account. */
  calendarId?: string;
  /** Last successful sync (ms). */
  lastSync?: number;
}
export const CALENDAR_NAME = "ProdLi";
const WINDOW_DAYS = 8;
const API = "https://www.googleapis.com/calendar/v3";

export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/** Google event ids use base32hex (0-9, a-v): "pl" + the task id as hex. */
export function eventIdFor(todoId: string): string {
  return `pl${[...new TextEncoder().encode(todoId)].map((b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 1024);
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The block's start and end as local Dates. */
export function blockTimes(t: Todo): { start: Date; end: Date } | null {
  if (!t.block) return null;
  const [y, m, d] = t.block.day.split("-").map(Number);
  const [h, min] = t.block.start.split(":").map(Number);
  const start = new Date(y, m - 1, d, h, min);
  return { start, end: new Date(start.getTime() + blockMinutes(t) * 60_000) };
}

/** What a block looks like as an event (the parts ProdLi controls). */
export function eventBody(t: Todo, timeZone: string) {
  const times = blockTimes(t)!;
  return {
    id: eventIdFor(t.id),
    summary: t.title.slice(0, 300),
    description: "Time block from ProdLi. Move or resize it here and ProdLi follows.",
    start: { dateTime: times.start.toISOString(), timeZone },
    end: { dateTime: times.end.toISOString(), timeZone },
    extendedProperties: { private: { prodliTodoId: t.id } },
    transparency: "opaque",
    reminders: { useDefault: false },
  };
}

/** The block an event describes (local day, HH:MM, minutes). */
export function blockFromEvent(e: GEvent): { day: string; start: string; minutes: number } | null {
  if (!e.start?.dateTime || !e.end?.dateTime) return null;
  const s = new Date(e.start.dateTime);
  const minutes = Math.max(5, Math.round((new Date(e.end.dateTime).getTime() - s.getTime()) / 60_000));
  return { day: localDay(s), start: `${pad(s.getHours())}:${pad(s.getMinutes())}`, minutes };
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export interface SyncPlan {
  create: Todo[];
  update: Todo[];
  remove: string[];
  /** Changes made in Google Calendar to bring into ProdLi. */
  pull: { todoId: string; block: { day: string; start: string } | null; estimateMin?: number }[];
}

/** Pure: what to change on each side. `events` are the ProdLi calendar's events in the window (deleted ones included). */
export function planSync(todos: Todo[], events: GEvent[], now: Date): SyncPlan {
  const from = localDay(now);
  const to = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_DAYS));
  const inWindow = (t: Todo) => !!t.block && t.block.day >= from && t.block.day < to;
  const byTodo = new Map(todos.map((t) => [t.id, t]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const plan: SyncPlan = { create: [], update: [], remove: [], pull: [] };

  for (const t of todos) {
    if (!inWindow(t) || t.completed) continue;
    const e = eventById.get(eventIdFor(t.id));
    const changedInGoogle = !!e && ms(e.updated) > ms(t.updatedAt ?? t.createdAt);
    if (!e) plan.create.push(t);
    else if (e.status === "cancelled") {
      if (changedInGoogle) plan.pull.push({ todoId: t.id, block: null });
      else plan.create.push(t); // deleted earlier, blocked again in ProdLi since
    } else {
      const g = blockFromEvent(e);
      const same = g && g.day === t.block!.day && g.start === t.block!.start && g.minutes === blockMinutes(t) && (e.summary ?? "") === t.title.slice(0, 300);
      if (same) continue;
      if (changedInGoogle && g) plan.pull.push({ todoId: t.id, block: { day: g.day, start: g.start }, estimateMin: g.minutes });
      else plan.update.push(t);
    }
  }
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const todoId = e.extendedProperties?.private?.prodliTodoId;
    if (!todoId || e.id !== eventIdFor(todoId)) continue;
    const t = byTodo.get(todoId);
    if (!t) plan.remove.push(e.id); // the task was deleted
    else if (!t.completed && !inWindow(t)) plan.remove.push(e.id); // unblocked, or moved past the window
  }
  return plan;
}

/** Pure: apply changes from Google Calendar to the to-do list. */
export function applyPull(todos: Todo[], pull: SyncPlan["pull"], now = new Date()): Todo[] {
  if (!pull.length) return todos;
  const byId = new Map(pull.map((p) => [p.todoId, p]));
  const stamp = now.toISOString();
  return todos.map((t) => {
    const p = byId.get(t.id);
    if (!p) return t;
    if (!p.block) {
      const { block: _drop, ...rest } = t;
      return { ...rest, updatedAt: stamp };
    }
    return { ...t, block: p.block, estimateMin: p.estimateMin ?? t.estimateMin, updatedAt: stamp };
  });
}

// ── Talking to Google ─────────────────────────────────────────────────────────

class SyncError extends Error {}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 401 || res.status === 403) throw new SyncError(`auth:${res.status}`);
  if (res.status === 404 || res.status === 410) throw new SyncError("not_found");
  if (res.status === 409) throw new SyncError("conflict");
  if (!res.ok) throw new SyncError(`http:${res.status}`);
  return (res.status === 204 ? null : await res.json().catch(() => null)) as T;
}

async function ensureCalendar(token: string, s: CalendarSyncSettings): Promise<string> {
  if (s.calendarId) {
    try {
      await api(token, `/calendars/${encodeURIComponent(s.calendarId)}`);
      return s.calendarId;
    } catch (e) {
      if (!(e instanceof SyncError) || e.message !== "not_found") throw e;
    }
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const created = await api<{ id: string }>(token, "/calendars", { method: "POST", body: JSON.stringify({ summary: CALENDAR_NAME, description: "Time blocks from ProdLi (prodli.com). ProdLi keeps this calendar in step with your plan.", timeZone: tz }) });
  return created.id;
}

async function listEvents(token: string, calendarId: string, now: Date): Promise<GEvent[]> {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from.getTime() + (WINDOW_DAYS + 1) * 86_400_000);
  const out: GEvent[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const q = `singleEvents=true&showDeleted=true&maxResults=250&timeMin=${encodeURIComponent(new Date(from.getTime() - 86_400_000).toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const r = await api<{ items?: GEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    out.push(...(r?.items ?? []));
    if (!r?.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

let running: Promise<SyncResult> | null = null;
export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

/** One sync pass, if it's turned on. `interactive` may show Google's consent window. */
export function syncCalendarBlocks(interactive = false, now = new Date()): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    const s = await storageGet<CalendarSyncSettings>(CALENDAR_SYNC_KEY, { enabled: false });
    if (!s.enabled || !calendarBlocksAvailable()) return { ok: true, pushed: 0, pulled: 0 };
    const { calendarWriteToken, dropToken } = await import("./calendar");
    let token = "";
    try {
      token = await calendarWriteToken(interactive);
      const calendarId = await ensureCalendar(token, s);
      const todos = await storageGet<Todo[]>("todos", []);
      const plan = planSync(todos, await listEvents(token, calendarId, now), now);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
      for (const t of plan.create) {
        try {
          await api(token, base, { method: "POST", body: JSON.stringify(eventBody(t, tz)) });
        } catch (e) {
          // The id exists (an event deleted in Google Calendar, blocked again in ProdLi): bring it back.
          if (!(e instanceof SyncError) || e.message !== "conflict") throw e;
          await api(token, `${base}/${eventIdFor(t.id)}`, { method: "PUT", body: JSON.stringify({ ...eventBody(t, tz), status: "confirmed" }) });
        }
      }
      for (const t of plan.update) await api(token, `${base}/${eventIdFor(t.id)}`, { method: "PUT", body: JSON.stringify(eventBody(t, tz)) });
      for (const id of plan.remove) await api(token, `${base}/${id}`, { method: "DELETE" }).catch(() => {});
      if (plan.pull.length) {
        // Re-read so edits made in ProdLi meanwhile aren't lost.
        const latest = await storageGet<Todo[]>("todos", []);
        await storageSet("todos", applyPull(latest, plan.pull));
      }
      await storageSet(CALENDAR_SYNC_KEY, { ...s, calendarId, lastSync: Date.now() });
      return { ok: true, pushed: plan.create.length + plan.update.length + plan.remove.length, pulled: plan.pull.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (token && msg.startsWith("auth:")) await dropToken(token).catch(() => {});
      return { ok: false, pushed: 0, pulled: 0, error: msg.startsWith("auth:") ? "Allow ProdLi to manage its calendar: turn it off and on again." : "Couldn't update Google Calendar. ProdLi will try again." };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function setCalendarSync(enabled: boolean): Promise<SyncResult> {
  const s = await storageGet<CalendarSyncSettings>(CALENDAR_SYNC_KEY, { enabled: false });
  await storageSet(CALENDAR_SYNC_KEY, { ...s, enabled });
  if (!enabled) return { ok: true, pushed: 0, pulled: 0 };
  const r = await syncCalendarBlocks(true);
  if (!r.ok) await storageSet(CALENDAR_SYNC_KEY, { ...s, enabled: false });
  return r;
}

const ALARM = "calendar_blocks_sync";

/** Extension background: every 15 minutes, and soon after to-dos change. */
export function registerCalendarSync(): void {
  chrome.alarms.create(ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
  let timer: ReturnType<typeof setTimeout> | null = null;
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void syncCalendarBlocks(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.todos) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncCalendarBlocks(false), 5000);
  });
}
