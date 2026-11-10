// Today: ProdLi's personal assistant view.
//  - Greeting and one main focus for the day
//  - Daily brief (AI when signed in; a basic one otherwise): priorities, a
//    suggested schedule around your calendar, watch-outs, habit nudges, a tip
//  - Plan your day: choose today's tasks, estimate them, see if they fit
//  - Agenda: Google Calendar (optional, read-only) and habits to check off
//  - Wrap up: what got done, move the rest to tomorrow, a short reflection
//    that tomorrow's brief uses

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSyncedList } from "../lib/syncedList";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import { accountsEnabled, getAiUsage, getProdliAccount, onProdliAccountChange, type AiUsage, type ProdliUser } from "../lib/prodliAccount";
import { calendarAvailable, connectCalendar, disconnectCalendar, isCalendarConnected, todaysEvents, type CalendarEvent } from "../lib/calendar";
import { briefBasis, buildContext, dayKey, DAYS_KEY, DEFAULT_TODAY_SETTINGS, getTodaySettings, greeting, isForToday, minutesLeft, TODAY_SETTINGS_KEY, tomorrowKey, writeBrief } from "../lib/today";
import { agenda, autoSchedule, blockMinutes, blockOf, googleCalendarLink, toHM } from "../lib/timeBlocks";
import type { DailyBrief, DayRecord, Habit, Todo, TodaySettings } from "../types";

const ACCENT = "#F59E0B";
const card: CSSProperties = { border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", padding: 16 };
const label: CSSProperties = { fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" };
const btn = (kind: "primary" | "plain" = "plain", disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: kind === "primary" ? ACCENT : "hsl(var(--card))",
  color: kind === "primary" ? "#000" : "hsl(var(--foreground))",
  padding: "7px 12px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});
const KIND_COLORS: Record<DailyBrief["schedule"][number]["kind"], string> = { meeting: "#FF4FA3", focus: ACCENT, task: "#00BCD4", break: "#9CA3AF", habit: "#66BB6A" };
const ESTIMATES = [15, 30, 60, 90, 120, 180];
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

function Card({ title, right, children, testId }: { title: string; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section style={card} data-testid={testId}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ ...label, margin: 0 }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function TodaySection({ onAsk }: { onAsk?: (question?: string) => void } = {}) {
  const today = dayKey();
  const { items: todos, setItems: setTodos } = useSyncedList<Todo>("todos");
  const { items: habits, setItems: setHabits } = useSyncedList<Habit>("habits");
  const { items: days, setItems: setDays, loaded: daysLoaded } = useSyncedList<DayRecord>(DAYS_KEY);
  const [settings, setSettings] = useState<TodaySettings>(DEFAULT_TODAY_SETTINGS);
  const [user, setUser] = useState<ProdliUser | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendar, setCalendar] = useState<{ connected: boolean; error: string | null; loading: boolean }>({ connected: false, error: null, loading: false });
  const [briefing, setBriefing] = useState(false);
  const [briefNote, setBriefNote] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWrap, setShowWrap] = useState(() => new Date().getHours() >= 17);
  const [focusDraft, setFocusDraft] = useState("");
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [askDraft, setAskDraft] = useState("");
  const [blockNote, setBlockNote] = useState<{ warn: boolean; text: string } | null>(null);
  const autoTried = useRef(false);

  const record = days.find((d) => d.id === today);
  const brief = record?.brief;

  const saveDay = useCallback(
    (patch: Partial<DayRecord>) =>
      setDays((list) => {
        const existing = list.find((d) => d.id === today);
        const next: DayRecord = { ...(existing ?? { id: today, createdAt: new Date().toISOString() }), ...patch };
        return existing ? list.map((d) => (d.id === today ? next : d)) : [next, ...list].slice(0, 400);
      }),
    [setDays, today],
  );

  useEffect(() => {
    void storageSet("lastTodayVisit", today);
    void getTodaySettings().then(setSettings);
    void getProdliAccount().then(setUser);
    const offs = [onProdliAccountChange(setUser), onStorageChange<TodaySettings>(TODAY_SETTINGS_KEY, (v) => setSettings({ ...DEFAULT_TODAY_SETTINGS, ...v }))];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    if (user) getAiUsage().then(setUsage, () => setUsage(null));
    else setUsage(null);
  }, [user]);

  useEffect(() => {
    setFocusDraft(record?.focus ?? "");
    setReflectionDraft(record?.reflection ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.focus, record?.reflection]);

  const loadEvents = useCallback(async (interactive = false) => {
    if (!calendarAvailable()) return;
    const connected = await isCalendarConnected();
    if (!connected && !interactive) return setCalendar({ connected: false, error: null, loading: false });
    setCalendar((c) => ({ ...c, loading: true }));
    try {
      if (interactive && !connected) await connectCalendar();
      const list = await todaysEvents(interactive);
      setEvents(list);
      setCalendar({ connected: true, error: null, loading: false });
      return list;
    } catch (err) {
      setCalendar({ connected, error: err instanceof Error ? err.message : "Couldn't load your calendar.", loading: false });
    }
  }, []);

  useEffect(() => {
    void loadEvents(false);
  }, [loadEvents]);

  const makeBrief = useCallback(
    async (evts: CalendarEvent[] = events) => {
      setBriefing(true);
      setBriefNote(null);
      try {
        const ctx = await buildContext(evts);
        const r = await writeBrief(ctx);
        saveDay({ brief: r.brief, briefBasis: briefBasis(await storageGet<Todo[]>("todos", []), evts) });
        if (r.usage) setUsage((u) => (u ? { ...u, briefs: r.usage } : u));
        if (r.fallbackReason && r.fallbackReason !== "signed_out") setBriefNote(r.fallbackReason);
      } finally {
        setBriefing(false);
      }
    },
    [events, saveDay],
  );

  // First visit of the day: write the brief automatically (once).
  useEffect(() => {
    if (!daysLoaded || autoTried.current || brief || !settings.autoBrief) return;
    autoTried.current = true;
    void (async () => {
      const evts = (await loadEvents(false)) ?? events;
      await makeBrief(evts);
    })();
  }, [daysLoaded, brief, settings.autoBrief, loadEvents, makeBrief, events]);

  const open = todos.filter((t) => !t.completed);
  const planned = open.filter((t) => isForToday(t, today));
  const others = open.filter((t) => !isForToday(t, today));
  const plannedMinutes = planned.reduce((n, t) => n + (t.estimateMin ?? 0), 0);
  const meetingMinutes = events.filter((e) => e.start && e.end).reduce((n, e) => n + Math.max(0, toMin(e.end!) - Math.max(toMin(e.start!), nowMin())), 0);
  const freeMinutes = Math.max(0, minutesLeft(settings) - meetingMinutes);
  const doneToday = todos.filter((t) => t.completed && t.completedAt && dayKey(new Date(t.completedAt)) === today);
  const activeHabits = habits.filter((h) => !h.archived);

  const updateTodo = (id: string, patch: Partial<Todo>) => setTodos((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const timeline = agenda(events, todos, today);
  const allDay = events.filter((e) => e.allDay);
  const unblocked = planned.filter((t) => !blockOf(t, today));
  const blockedCount = todos.filter((t) => blockOf(t, today)).length;
  const blockTime = () => {
    const plan = autoSchedule({ tasks: planned, todos, events, day: today, workStart: settings.workStart, workEnd: settings.workEnd, nowMin: nowMin() });
    const n = Object.keys(plan.placed).length;
    if (n) setTodos((list) => list.map((t) => (plan.placed[t.id] ? { ...t, block: { day: today, start: plan.placed[t.id] } } : t)));
    const missing = plan.unplaced.length;
    setBlockNote(
      !n && !missing
        ? null
        : missing
          ? { warn: true, text: `${n ? `Blocked ${n} task${n > 1 ? "s" : ""}. ` : ""}${missing} didn't fit in today's free time — shorten an estimate or move ${missing > 1 ? "them" : "it"} to tomorrow.` }
          : { warn: false, text: `Blocked ${n} task${n > 1 ? "s" : ""} in your free time. Change a time, or 📅 add a block to Google Calendar.` },
    );
  };
  const clearBlocks = () => {
    setTodos((list) => list.map((t) => (t.block?.day === today ? { ...t, block: undefined } : t)));
    setBlockNote(null);
  };
  const toggleTodo = (t: Todo) => updateTodo(t.id, { completed: !t.completed, completedAt: t.completed ? undefined : new Date().toISOString() });
  const toggleHabit = (h: Habit) =>
    setHabits((list) => list.map((x) => (x.id === h.id ? { ...x, completedDays: x.completedDays.includes(today) ? x.completedDays.filter((d) => d !== today) : [...x.completedDays, today] } : x)));
  const addPriorityAsTask = (title: string) => {
    const existing = todos.find((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (existing) return updateTodo(existing.id, { plannedFor: today });
    setTodos((list) => [{ id: `t-${Date.now().toString(36)}`, title, completed: false, plannedFor: today, createdAt: new Date().toISOString() }, ...list]);
  };
  const moveRestToTomorrow = () => {
    const tomorrow = tomorrowKey();
    setTodos((list) => list.map((t) => (!t.completed && t.plannedFor && t.plannedFor <= today ? { ...t, plannedFor: tomorrow, block: undefined } : t)));
  };
  const saveSettings = async (patch: Partial<TodaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await storageSet(TODAY_SETTINGS_KEY, next);
  };

  const briefsLeft = usage?.briefs ? Math.max(0, usage.briefs.limit - usage.briefs.used) : null;
  const dateLine = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const firstName = user?.name?.split(" ")[0];

  return (
    <div style={{ height: "100%", overflow: "auto", background: "hsl(var(--background))" }}>
      <div className="today-page" style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 24px 40px", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.7 }}>{dateLine}</div>
            <h1 style={{ margin: "2px 0 0", fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>
              {greeting()}
              {firstName ? `, ${firstName}` : ""}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn()} onClick={() => setShowWrap((v) => !v)}>
              🌙 {showWrap ? "Hide wrap-up" : "Wrap up the day"}
            </button>
            <button style={btn()} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
              ⚙ Settings
            </button>
          </div>
        </header>

        {showSettings && (
          <Card title="Today settings" testId="today-settings">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 13, fontWeight: 600 }}>
              <label>
                Work day{" "}
                <input type="time" value={settings.workStart} onChange={(e) => void saveSettings({ workStart: e.target.value })} aria-label="Work day starts" style={timeInput} /> –{" "}
                <input type="time" value={settings.workEnd} onChange={(e) => void saveSettings({ workEnd: e.target.value })} aria-label="Work day ends" style={timeInput} />
              </label>
              {typeof chrome !== "undefined" && !!chrome.alarms && (
                <label>
                  <input type="checkbox" checked={settings.reminder !== null} onChange={(e) => void saveSettings({ reminder: e.target.checked ? "08:30" : null })} /> Morning reminder{" "}
                  {settings.reminder !== null && <input type="time" value={settings.reminder} onChange={(e) => void saveSettings({ reminder: e.target.value })} aria-label="Reminder time" style={timeInput} />}
                </label>
              )}
              <label>
                <input type="checkbox" checked={settings.startOnToday} onChange={(e) => void saveSettings({ startOnToday: e.target.checked })} /> Open Today first each day
              </label>
              <label>
                <input type="checkbox" checked={settings.autoBrief} onChange={(e) => void saveSettings({ autoBrief: e.target.checked })} /> Write my brief automatically
              </label>
              {typeof chrome !== "undefined" && !!chrome.alarms && (
                <label>
                  <input type="checkbox" checked={settings.blockReminders !== false} onChange={(e) => void saveSettings({ blockReminders: e.target.checked })} /> Notify me when a time block starts
                </label>
              )}
            </div>
          </Card>
        )}

        <section style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderLeft: `6px solid ${ACCENT}` }}>
          <span style={{ ...label, flexShrink: 0 }}>🎯 Main focus</span>
          <input
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            onBlur={() => focusDraft.trim() !== (record?.focus ?? "") && saveDay({ focus: focusDraft.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="What's the one thing that would make today a win?"
            aria-label="Today's main focus"
            maxLength={200}
            style={{ flex: 1, minWidth: 220, border: "none", borderBottom: "2px solid hsl(var(--foreground))", background: "transparent", color: "inherit", fontSize: 18, fontWeight: 800, padding: "4px 2px", fontFamily: "inherit", outline: "none" }}
          />
        </section>

        {onAsk && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAsk(askDraft.trim() || undefined);
              setAskDraft("");
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              value={askDraft}
              onChange={(e) => setAskDraft(e.target.value)}
              placeholder="✨ Ask ProdLi — “What should I do next?”"
              aria-label="Ask ProdLi about your day"
              style={{ flex: 1, minWidth: 0, border: "var(--nb-border)", padding: "10px 12px", fontFamily: "inherit", fontSize: 14, background: "hsl(var(--card))", color: "inherit" }}
            />
            <button type="submit" style={{ ...btn(), background: "#A78BFA", color: "#000" }}>
              Ask
            </button>
          </form>
        )}

        <div className="today-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <Card
              title={brief?.source === "ai" ? "✨ Your daily brief" : "☀️ Your daily brief"}
              testId="daily-brief"
              right={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {briefsLeft !== null && <span style={{ fontSize: 11, opacity: 0.7 }}>{briefsLeft} AI briefs left this month</span>}
                  <button style={btn("primary", briefing)} disabled={briefing} onClick={() => void makeBrief()}>
                    {briefing ? "Writing…" : brief ? "Refresh" : "Write my brief"}
                  </button>
                </div>
              }
            >
              {briefNote && <Note tone="warn">{briefNote}</Note>}
              {brief && !briefing && record?.briefBasis !== undefined && record.briefBasis !== briefBasis(todos, events, today) && (
                <Note>
                  Your tasks or calendar changed since this brief.{" "}
                  <button onClick={() => void makeBrief()} style={{ border: "none", background: "none", padding: 0, textDecoration: "underline", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "inherit" }}>
                    Refresh it
                  </button>
                </Note>
              )}
              {!brief ? (
                <p style={{ fontSize: 14, margin: 0, opacity: 0.8 }}>{briefing ? "Looking at your tasks, calendar and habits…" : "Get a short plan for today from your tasks, calendar, habits and meetings."}</p>
              ) : (
                <BriefView brief={brief} onAddPriority={addPriorityAsTask} plannedTitles={new Set(planned.map((t) => t.title.trim().toLowerCase()))} />
              )}
              {brief?.source !== "ai" && accountsEnabled() && !user && (
                <Note>Sign in (👤 at the top) for an AI-written brief that plans your day around your calendar — free.</Note>
              )}
            </Card>

            <Card
              title="📝 Plan your day"
              testId="plan-day"
              right={
                <span style={{ fontWeight: 700, ...(plannedMinutes > freeMinutes ? BADGE_RED : {}), fontSize: 12 }} data-testid="workload">
                  {fmtMin(plannedMinutes)} planned · {fmtMin(freeMinutes)} free
                </span>
              }
            >
              {plannedMinutes > freeMinutes && <Note tone="warn">That's more than the time you have left today. Move something to tomorrow?</Note>}
              {planned.length === 0 && <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 8px" }}>Pick what you'll do today from your to-dos below (☀️ adds it to today).</p>}
              <TaskList tasks={planned} today={today} onToggle={toggleTodo} onUpdate={updateTodo} />
              {others.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>Other open tasks ({others.length})</summary>
                  <div style={{ marginTop: 8 }}>
                    <TaskList tasks={others.slice(0, 50)} today={today} onToggle={toggleTodo} onUpdate={updateTodo} />
                  </div>
                </details>
              )}
            </Card>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <Card
              title="📅 Agenda"
              testId="agenda"
              right={
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {unblocked.length > 0 && (
                    <button style={btn("primary")} onClick={blockTime} title="Put today's planned tasks into your free time" data-testid="block-time">
                      ⏱ Block time
                    </button>
                  )}
                  {blockedCount > 0 && (
                    <button style={btn()} onClick={clearBlocks}>
                      Clear blocks
                    </button>
                  )}
                  {calendarAvailable() && calendar.connected && (
                    <button style={btn()} onClick={() => void disconnectCalendar().then(() => (setEvents([]), setCalendar({ connected: false, error: null, loading: false })))}>
                      Disconnect
                    </button>
                  )}
                </div>
              }
            >
              {calendar.error && <Note tone="warn">{calendar.error}</Note>}
              {blockNote && <Note tone={blockNote.warn ? "warn" : "info"}>{blockNote.text}</Note>}
              {!calendar.connected && calendarAvailable() && (
                <div style={{ display: "grid", gap: 8, marginBottom: timeline.length ? 12 : 0 }}>
                  <p style={{ fontSize: 13, margin: 0, opacity: 0.8 }}>Connect Google Calendar so your brief and time blocks plan around your meetings. Read-only; events are read on this device.</p>
                  <div>
                    <button style={btn("primary", calendar.loading)} disabled={calendar.loading} onClick={() => void loadEvents(true)}>
                      {calendar.loading ? "Connecting…" : "Connect Google Calendar"}
                    </button>
                  </div>
                </div>
              )}
              {allDay.length > 0 && (
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, opacity: 0.85 }}>All day: {allDay.map((e) => e.title).join(" · ")}</div>
              )}
              {timeline.length === 0 ? (
                (calendar.connected || !calendarAvailable()) && (
                  <p style={{ fontSize: 13, margin: 0, opacity: 0.75 }}>
                    {calendar.loading ? "Loading…" : calendar.connected ? "Nothing on your calendar today." : "Nothing scheduled."} {planned.length > 0 && "Plan tasks below, give them a time estimate, then ⏱ Block time."}
                  </p>
                )
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }} data-testid="timeline">
                  {timeline.map((item) =>
                    item.kind === "event" ? (
                      <li key={`e-${item.event.id}`} style={{ display: "flex", gap: 10, fontSize: 13, alignItems: "baseline", borderLeft: "4px solid #FF4FA3", paddingLeft: 8 }}>
                        <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, minWidth: 92, opacity: 0.8 }}>
                          {item.event.start}–{item.event.end}
                        </span>
                        <span style={{ fontWeight: 700 }}>
                          {item.event.title}
                          {item.event.meetLink && (
                            <a href={item.event.meetLink} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, fontSize: 11, textDecoration: "underline" }}>
                              Join
                            </a>
                          )}
                        </span>
                      </li>
                    ) : (
                      <li key={`b-${item.todo.id}`} data-testid="time-block" style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center", borderLeft: `4px solid ${item.conflict ? "#E53935" : ACCENT}`, paddingLeft: 8, flexWrap: "wrap" }}>
                        <input
                          type="time"
                          value={item.todo.block!.start}
                          step={300}
                          onChange={(e) => e.target.value && updateTodo(item.todo.id, { block: { day: today, start: e.target.value } })}
                          aria-label={`Start time for ${item.todo.title}`}
                          style={{ ...timeInput, fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 12 }}
                        />
                        <span style={{ flex: 1, minWidth: 120, fontWeight: 600 }}>
                          {item.todo.title} <span style={{ fontSize: 11, opacity: 0.7 }}>· {fmtMin(blockMinutes(item.todo))} · until {toHM(item.end)}</span>
                          {item.conflict && <span style={{ marginLeft: 6, ...BADGE_RED }}>OVERLAPS</span>}
                        </span>
                        <a href={googleCalendarLink(item.todo.title, today, item.todo.block!.start, blockMinutes(item.todo))} target="_blank" rel="noopener noreferrer" title="Add to Google Calendar" aria-label={`Add ${item.todo.title} to Google Calendar`} style={{ ...btn(), padding: "2px 6px", textDecoration: "none" }}>
                          📅
                        </a>
                        <button onClick={() => toggleTodo(item.todo)} title="Done" aria-label={`Done: ${item.todo.title}`} style={{ ...btn(), padding: "2px 6px" }}>
                          ✓
                        </button>
                        <button onClick={() => updateTodo(item.todo.id, { block: undefined })} title="Remove block" aria-label={`Remove time block for ${item.todo.title}`} style={{ ...btn(), padding: "2px 6px" }}>
                          ×
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Card>

            <Card title="🎯 Habits today" testId="habits-today">
              {activeHabits.length === 0 ? (
                <p style={{ fontSize: 13, margin: 0, opacity: 0.75 }}>No habits yet — add some in Habits.</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {activeHabits.map((h) => {
                    const done = h.completedDays.includes(today);
                    return (
                      <button
                        key={h.id}
                        onClick={() => toggleHabit(h)}
                        aria-pressed={done}
                        style={{ ...btn(), background: done ? h.color : "hsl(var(--card))", color: done ? "#000" : "hsl(var(--foreground))", textTransform: "none", fontSize: 13 }}
                      >
                        {h.emoji} {h.name} {done ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {showWrap && (
              <Card title="🌙 Wrap up the day" testId="wrap-up">
                <div style={{ fontSize: 13, display: "grid", gap: 10 }}>
                  <div>
                    <strong>Done today ({doneToday.length})</strong>
                    {doneToday.length ? (
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {doneToday.slice(0, 12).map((t) => (
                          <li key={t.id}>{t.title}</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ opacity: 0.7 }}>Nothing ticked off yet — that's fine; tomorrow's another day.</div>
                    )}
                  </div>
                  {planned.length > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>
                        {planned.length} planned task{planned.length > 1 ? "s" : ""} still open.
                      </span>
                      <button style={btn()} onClick={moveRestToTomorrow}>
                        Move to tomorrow
                      </button>
                    </div>
                  )}
                  <label style={{ display: "grid", gap: 4 }}>
                    <strong>How did today go? (tomorrow's brief reads this)</strong>
                    <textarea
                      value={reflectionDraft}
                      onChange={(e) => setReflectionDraft(e.target.value)}
                      onBlur={() => reflectionDraft.trim() !== (record?.reflection ?? "") && saveDay({ reflection: reflectionDraft.trim() })}
                      rows={3}
                      maxLength={900}
                      placeholder="What went well? What got in the way? What's first tomorrow?"
                      aria-label="Reflection on today"
                      style={{ border: "var(--nb-border)", padding: 8, fontFamily: "inherit", fontSize: 13, background: "hsl(var(--background))", color: "inherit", resize: "vertical" }}
                    />
                  </label>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// White on a dark red: readable in light and dark mode (WCAG AA at this size).
const BADGE_RED: CSSProperties = { fontSize: 10, fontWeight: 900, color: "#fff", background: "#C62828", padding: "0 4px" };
const timeInput: CSSProperties = { border: "var(--nb-border)", padding: "2px 4px", fontFamily: "inherit", background: "hsl(var(--background))", color: "inherit" };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div role="status" style={{ border: "var(--nb-border)", padding: "6px 10px", fontSize: 12, fontWeight: 600, margin: "0 0 10px", background: tone === "warn" ? "#FFF3CD" : "#E3F2FD", color: "#000" }}>
      {children}
    </div>
  );
}

function BriefView({ brief, onAddPriority, plannedTitles }: { brief: DailyBrief; onAddPriority: (title: string) => void; plannedTitles: Set<string> }) {
  const sub: CSSProperties = { ...label, fontSize: 10, margin: "14px 0 6px", opacity: 0.75 };
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55 }}>
      <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.01em" }}>{brief.headline}</div>
      <p style={{ margin: "6px 0 0" }}>{brief.summary}</p>

      {brief.priorities.length > 0 && (
        <>
          <div style={sub}>Top priorities</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            {brief.priorities.map((p, i) => (
              <li key={i}>
                <strong>{p.title}</strong> <span style={{ opacity: 0.75 }}>— {p.reason}</span>
                {!plannedTitles.has(p.title.trim().toLowerCase()) && (
                  <button onClick={() => onAddPriority(p.title)} style={{ ...btn(), padding: "1px 6px", fontSize: 10, marginLeft: 6 }} title="Add to today's plan">
                    ☀️ Plan
                  </button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {brief.schedule.length > 0 && (
        <>
          <div style={sub}>Suggested schedule</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 3 }}>
            {brief.schedule.map((b, i) => (
              <li key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, minWidth: 96 }}>
                  {b.start}–{b.end}
                </span>
                <span style={{ width: 8, height: 8, background: KIND_COLORS[b.kind], display: "inline-block", flexShrink: 0 }} aria-hidden />
                <span>{b.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {brief.watchouts.length > 0 && (
        <>
          <div style={sub}>Watch out</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {brief.watchouts.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}

      {brief.habits.length > 0 && (
        <>
          <div style={sub}>Habits</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {brief.habits.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}

      {brief.tip && <p style={{ margin: "12px 0 0", fontSize: 13, opacity: 0.85 }}>💡 {brief.tip}</p>}
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 8 }}>
        {brief.source === "ai" ? "Written by ProdLi AI" : "Basic brief (no AI)"} · {new Date(brief.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

function TaskList({ tasks, today, onToggle, onUpdate }: { tasks: Todo[]; today: string; onToggle: (t: Todo) => void; onUpdate: (id: string, patch: Partial<Todo>) => void }) {
  const sorted = useMemo(() => tasks, [tasks]);
  if (!sorted.length) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {sorted.map((t) => {
        const planned = !!t.plannedFor && t.plannedFor <= today;
        const overdue = !!t.dueDate && t.dueDate < today;
        return (
          <li key={t.id} className="today-task" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, border: "1px solid hsl(var(--border, 0 0% 80%))", padding: "6px 8px", background: "hsl(var(--background))" }}>
            <input type="checkbox" checked={t.completed} onChange={() => onToggle(t)} aria-label={`Done: ${t.title}`} />
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
              {t.title}
              {t.priority === "high" && <span style={{ marginLeft: 6, ...BADGE_RED }}>HIGH</span>}
              {overdue && <span style={{ marginLeft: 6, ...BADGE_RED }}>OVERDUE</span>}
              {!overdue && t.dueDate === today && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 900 }}>DUE TODAY</span>}
              {t.block?.day === today && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 900, fontFamily: "Space Mono, monospace" }}>⏱ {t.block.start}</span>}
            </span>
            <select
              value={t.estimateMin ?? ""}
              onChange={(e) => onUpdate(t.id, { estimateMin: e.target.value ? Number(e.target.value) : undefined })}
              aria-label={`Time estimate for ${t.title}`}
              style={{ border: "var(--nb-border)", fontFamily: "inherit", fontSize: 12, background: "hsl(var(--card))", color: "inherit" }}
            >
              <option value="">⏱ —</option>
              {ESTIMATES.map((m) => (
                <option key={m} value={m}>
                  {fmtMin(m)}
                </option>
              ))}
            </select>
            <button
              onClick={() => onUpdate(t.id, { plannedFor: planned ? undefined : today })}
              aria-pressed={planned}
              title={planned ? "Remove from today" : "Add to today"}
              style={{ ...btn(planned ? "primary" : "plain"), padding: "2px 8px", fontSize: 13 }}
            >
              ☀️
            </button>
          </li>
        );
      })}
    </ul>
  );
}
