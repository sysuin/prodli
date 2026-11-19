// Weekly review: the week in numbers (tasks, focus, habits, meetings,
// browsing), what slipped (move it to next week in one click), your own notes,
// and a short write-up with next week's priorities — by ProdLi's AI when
// signed in, or a basic one built on this device.

import { CATEGORY } from "../lib/siteCategories";
import { KIND_COLOR } from "./tracker/FocusScore";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useSyncedList } from "../lib/syncedList";
import { accountsEnabled, getAiUsage, getProdliAccount, onProdliAccountChange, type AiUsage, type ProdliUser } from "../lib/prodliAccount";
import { DAYS_KEY, dayKey } from "../lib/today";
import { addDays, defaultReviewWeek, loadWeekStats, weekLabel, weekStart, writeReview, type WeekStats } from "../lib/review";
import type { DayRecord, Todo, WeeklyReview } from "../types";
import { toggleTodo as toggleCompletion } from "../lib/recurrence";

const ACCENT = "#14B8A6";
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
const smallBtn: CSSProperties = { ...btn(), padding: "3px 8px", fontSize: 11, boxShadow: "none" };
const hours = (min: number) => (min < 60 ? `${min} min` : `${Math.round((min / 60) * 10) / 10} h`);
const weekday = (key: string, style: "short" | "long" = "short") => new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: style });
const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

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

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div style={{ fontSize: 12, fontWeight: 600, padding: "8px 10px", marginBottom: 10, border: "2px solid", borderColor: tone === "warn" ? "#F59E0B" : "hsl(var(--border))", background: tone === "warn" ? "rgba(245,158,11,0.12)" : "transparent" }}>{children}</div>;
}

function Stat({ value, caption, testId }: { value: string; caption: string; testId?: string }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }} data-testid={testId}>
      <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7 }}>{caption}</div>
    </div>
  );
}

export function ReviewSection({ onAsk }: { onAsk?: (question?: string) => void } = {}) {
  const today = dayKey();
  const thisWeek = weekStart();
  const [week, setWeek] = useState(() => defaultReviewWeek());
  const { items: todos, setItems: setTodos } = useSyncedList<Todo>("todos");
  const { items: days, setItems: setDays } = useSyncedList<DayRecord>(DAYS_KEY);
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [user, setUser] = useState<ProdliUser | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [writing, setWriting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const record = days.find((d) => d.id === week);
  const review = record?.review;
  // Where "move to next week" puts things: the Monday after the reviewed week, or today if that's past.
  const nextMonday = addDays(week, 7) < today ? today : addDays(week, 7);

  useEffect(() => {
    void getProdliAccount().then(setUser);
    return onProdliAccountChange(setUser);
  }, []);
  useEffect(() => {
    if (user) getAiUsage().then(setUsage, () => setUsage(null));
    else setUsage(null);
  }, [user]);

  // Recompute when the week or the underlying data changes.
  useEffect(() => {
    let live = true;
    void loadWeekStats(week, today).then((s) => live && setStats(s));
    return () => {
      live = false;
    };
  }, [week, today, todos, days]);

  useEffect(() => setNoteDraft(record?.reviewNote ?? ""), [record?.reviewNote, week]);

  const saveWeek = useCallback(
    (patch: Partial<DayRecord>) =>
      setDays((list) => {
        const existing = list.find((d) => d.id === week);
        const next: DayRecord = { ...(existing ?? { id: week, createdAt: new Date().toISOString() }), ...patch };
        return existing ? list.map((d) => (d.id === week ? next : d)) : [next, ...list].slice(0, 400);
      }),
    [setDays, week],
  );

  const write = async () => {
    if (!stats) return;
    setWriting(true);
    setProblem(null);
    try {
      const r = await writeReview(stats, noteDraft);
      saveWeek({ review: r.review, reviewNote: noteDraft.trim() || undefined });
      if (r.usage) setUsage((u) => (u ? { ...u, briefs: r.usage } : u));
      if (r.fallbackReason && r.fallbackReason !== "signed_out") setProblem(r.fallbackReason);
    } finally {
      setWriting(false);
    }
  };

  const updateTodo = (id: string, patch: Partial<Todo>) => setTodos((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const planForNextWeek = (title: string) => {
    const existing = todos.find((t) => !t.completed && t.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (existing) return updateTodo(existing.id, { plannedFor: nextMonday });
    setTodos((list) => [{ id: `t-${Date.now().toString(36)}`, title, completed: false, plannedFor: nextMonday, createdAt: new Date().toISOString() }, ...list]);
  };
  const plannedNext = useMemo(() => new Set(todos.filter((t) => !t.completed && t.plannedFor === nextMonday).map((t) => t.title.trim().toLowerCase())), [todos, nextMonday]);

  const habitRate = stats?.habits.length ? Math.round((stats.habits.reduce((n, h) => n + h.done, 0) / Math.max(1, stats.habits.reduce((n, h) => n + h.of, 0))) * 100) : null;
  const maxDone = Math.max(1, ...(stats?.perDay.map((d) => d.done) ?? [1]));
  const maxFocus = Math.max(25, ...(stats?.perDay.map((d) => d.focusMin) ?? [25]));
  const reviewsLeft = usage?.briefs ? Math.max(0, usage.briefs.limit - usage.briefs.used) : null;

  return (
    <div style={{ height: "100%", overflow: "auto", background: "hsl(var(--background))" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 24px 40px", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.7 }}>{week === thisWeek ? "This week" : week === addDays(thisWeek, -7) ? "Last week" : "Week of"}</div>
            <h1 style={{ margin: "2px 0 0", fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }} data-testid="review-week">
              {weekLabel(week)}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn()} onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
              ‹ Previous
            </button>
            <button style={btn("plain", week >= thisWeek)} disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
              Next ›
            </button>
          </div>
        </header>

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Stat value={String(stats.done.length)} caption="Tasks done" testId="stat-done" />
            <Stat value={hours(stats.focus.minutes)} caption={`Focus · ${stats.focus.sessions} sessions`} />
            <Stat value={habitRate === null ? "—" : `${habitRate}%`} caption="Habits kept" />
            <Stat value={String(stats.meetings.count)} caption="Meetings" />
            <Stat value={stats.browsing.minutes ? hours(stats.browsing.minutes) : "—"} caption="Browsing" />
            {stats.browsing.focusScore !== null && <Stat value={String(stats.browsing.focusScore)} caption="Focus score" />}
          </div>
        )}

        <div className="today-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <Card
              title={review?.source === "ai" ? "✨ Your weekly review" : "📊 Your weekly review"}
              testId="weekly-review"
              right={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {reviewsLeft !== null && <span style={{ fontSize: 11, opacity: 0.7 }}>{reviewsLeft} AI briefs & reviews left this month</span>}
                  <button style={btn("primary", writing || !stats)} disabled={writing || !stats} onClick={() => void write()}>
                    {writing ? "Writing…" : review ? "Rewrite" : "Write my review"}
                  </button>
                </div>
              }
            >
              {problem && <Note tone="warn">{problem}</Note>}
              {!review ? (
                <p style={{ fontSize: 14, margin: 0, opacity: 0.8 }}>{writing ? "Looking at your week…" : "Get a short look back at the week — wins, what slipped, patterns — and three priorities for next week."}</p>
              ) : (
                <ReviewView review={review} onPlan={planForNextWeek} planned={plannedNext} nextMonday={nextMonday} />
              )}
              {review?.source !== "ai" && accountsEnabled() && !user && <Note>Sign in (👤 at the top) for an AI-written review with patterns and next week's priorities — free.</Note>}
              {review && onAsk && (
                <button style={{ ...smallBtn, marginTop: 10 }} onClick={() => onAsk(`Looking at my week (${weekLabel(week)}), what should I change next week?`)}>
                  ✨ Ask about my week
                </button>
              )}
            </Card>

            <Card title="✍️ Your notes on the week" testId="review-notes">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={() => noteDraft.trim() !== (record?.reviewNote ?? "") && saveWeek({ reviewNote: noteDraft.trim() || undefined })}
                placeholder="What went well? What got in the way? (The AI review takes this into account.)"
                aria-label="Your notes on the week"
                rows={4}
                maxLength={1500}
                style={{ width: "100%", boxSizing: "border-box", border: "var(--nb-border)", padding: 10, fontFamily: "inherit", fontSize: 14, background: "hsl(var(--background))", color: "inherit", resize: "vertical" }}
              />
              {review?.question && <p style={{ fontSize: 13, fontWeight: 700, margin: "8px 0 0" }}>💭 {review.question}</p>}
            </Card>

            {stats && stats.slipped.length > 0 && (
              <Card title={`⏭ Slipped (${stats.slipped.length})`} testId="review-slipped">
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {stats.slipped.slice(0, 25).map((t) => (
                    <li key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: 160, fontWeight: 600 }}>
                        {t.priority === "high" && <span title="High priority">🔴 </span>}
                        {t.title}
                        <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>{t.due ? `due ${shortDate(t.due)}` : t.planned ? `planned ${shortDate(t.planned)}` : ""}</span>
                      </span>
                      {todos.find((x) => x.id === t.id)?.plannedFor === nextMonday ? (
                        <span style={{ fontSize: 11, fontWeight: 800 }}>✓ {shortDate(nextMonday)}</span>
                      ) : (
                        <button style={smallBtn} onClick={() => updateTodo(t.id, { plannedFor: nextMonday })}>
                          Plan for {weekday(nextMonday)}
                        </button>
                      )}
                      <button style={smallBtn} onClick={() => setTodos((list) => (list.find((x) => x.id === t.id)?.completed ? list : toggleCompletion(list, t.id)))}>
                        Done
                      </button>
                    </li>
                  ))}
                </ul>
                {stats.slipped.length > 1 && (
                  <button
                    style={{ ...btn(), marginTop: 10 }}
                    onClick={() => {
                      const ids = new Set(stats.slipped.map((t) => t.id));
                      setTodos((list) => list.map((t) => (ids.has(t.id) ? { ...t, plannedFor: nextMonday } : t)));
                    }}
                  >
                    Plan all for {shortDate(nextMonday)}
                  </button>
                )}
              </Card>
            )}
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {stats && (
              <Card title="📈 Day by day" testId="review-days">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, alignItems: "end", height: 120 }} role="img" aria-label={stats.perDay.map((d) => `${weekday(d.day, "long")}: ${d.done} tasks, ${d.focusMin} focus minutes`).join("; ")}>
                  {stats.perDay.map((d) => (
                    <div key={d.day} style={{ display: "flex", gap: 2, alignItems: "end", justifyContent: "center", height: "100%", opacity: d.day > today ? 0.3 : 1 }}>
                      <div title={`${d.done} tasks`} style={{ width: 10, height: `${(d.done / maxDone) * 100}%`, minHeight: d.done ? 4 : 1, background: "#00BCD4", border: d.done ? "1px solid #000" : "none" }} />
                      <div title={`${d.focusMin} focus minutes`} style={{ width: 10, height: `${(d.focusMin / maxFocus) * 100}%`, minHeight: d.focusMin ? 4 : 1, background: "#FF6B6B", border: d.focusMin ? "1px solid #000" : "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 4 }}>
                  {stats.perDay.map((d) => (
                    <div key={d.day} style={{ textAlign: "center", fontSize: 11, fontWeight: d.day === today ? 900 : 700, opacity: 0.8 }}>
                      {weekday(d.day)}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, fontWeight: 700, marginTop: 8, opacity: 0.8 }}>
                  <span>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: "#00BCD4", border: "1px solid #000", marginRight: 4 }} />
                    Tasks done
                  </span>
                  <span>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: "#FF6B6B", border: "1px solid #000", marginRight: 4 }} />
                    Focus time
                  </span>
                </div>
              </Card>
            )}

            {stats && stats.habits.length > 0 && (
              <Card title="🎯 Habits" testId="review-habits">
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {stats.habits.map((h) => (
                    <li key={h.id} style={{ fontSize: 13, fontWeight: 600 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>
                          {h.emoji} {h.name}
                        </span>
                        <span style={{ fontWeight: 800 }}>
                          {h.done}/{h.of}
                        </span>
                      </div>
                      <div style={{ height: 6, background: "hsl(var(--muted))", marginTop: 3 }}>
                        <div style={{ height: "100%", width: `${(h.done / h.of) * 100}%`, background: "#66BB6A" }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {stats && (stats.browsing.topSites.length > 0 || stats.meetings.count > 0) && (
              <Card title="⏱ Where the time went">
                {stats.browsing.categories.length > 0 && (
                  <div data-testid="review-categories" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {stats.browsing.categories.map((c) => (
                      <span key={c.id} style={{ border: "1px solid var(--nb-section-border)", borderLeft: `4px solid ${KIND_COLOR[CATEGORY[c.id].kind]}`, padding: "1px 6px", fontSize: 12, fontWeight: 700 }}>
                        {CATEGORY[c.id].emoji} {c.label} <span style={{ fontWeight: 400 }}>{hours(c.minutes)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {stats.browsing.topSites.length > 0 && (
                  <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "grid", gap: 4, fontSize: 13 }}>
                    {stats.browsing.topSites.map((s) => (
                      <li key={s.site} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.site}</span>
                        <span style={{ fontWeight: 800, flexShrink: 0 }}>{hours(s.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {stats.meetings.count > 0 && (
                  <p style={{ fontSize: 13, margin: 0 }}>
                    🎙️ {stats.meetings.count} meeting{stats.meetings.count > 1 ? "s" : ""}
                    {stats.meetings.minutes ? ` · ${hours(stats.meetings.minutes)}` : ""}
                    {stats.meetings.openActions.length ? ` · ${stats.meetings.openActions.length} action item${stats.meetings.openActions.length > 1 ? "s" : ""} not on your to-dos` : ""}
                  </p>
                )}
              </Card>
            )}

            {stats && stats.done.length > 0 && (
              <Card title={`✅ Done (${stats.done.length})`}>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800 }}>Show everything you finished</summary>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, display: "grid", gap: 3 }}>
                    {stats.done.map((t) => (
                      <li key={t.id}>
                        {t.title} <span style={{ fontSize: 11, opacity: 0.6 }}>{weekday(t.day)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewView({ review, onPlan, planned, nextMonday }: { review: WeeklyReview; onPlan: (title: string) => void; planned: Set<string>; nextMonday: string }) {
  const list = (title: string, items: ReactNode[], testId?: string) =>
    items.length > 0 && (
      <div style={{ marginTop: 12 }} data-testid={testId}>
        <h3 style={{ ...label, margin: "0 0 6px", opacity: 0.8 }}>{title}</h3>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 14 }}>{items}</ul>
      </div>
    );
  return (
    <div>
      <p style={{ fontSize: 18, fontWeight: 900, margin: "0 0 4px" }}>{review.headline}</p>
      <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>{review.summary}</p>
      {list("🏆 Wins", review.wins.map((w, i) => <li key={i}>{w}</li>))}
      {list("🔍 Patterns", review.patterns.map((p, i) => <li key={i}>{p}</li>))}
      {list(
        "⏭ What slipped",
        review.slipped.map((s, i) => (
          <li key={i}>
            <strong>{s.title}</strong> — {s.suggestion}
          </li>
        )),
      )}
      {review.nextWeek.length > 0 && (
        <div style={{ marginTop: 12, borderLeft: `4px solid ${ACCENT}`, paddingLeft: 10 }} data-testid="review-next-week">
          <h3 style={{ ...label, margin: "0 0 6px" }}>🎯 Next week's priorities</h3>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 14 }}>
            {review.nextWeek.map((p, i) => (
              <li key={i}>
                <strong>{p.title}</strong> <span style={{ opacity: 0.8 }}>— {p.reason}</span>{" "}
                {planned.has(p.title.trim().toLowerCase()) ? (
                  <span style={{ fontSize: 11, fontWeight: 800 }}>✓ planned for {shortDate(nextMonday)}</span>
                ) : (
                  <button style={smallBtn} onClick={() => onPlan(p.title)}>
                    Plan for {shortDate(nextMonday)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {review.habitTip && <p style={{ fontSize: 13, margin: "12px 0 0" }}>🎯 {review.habitTip}</p>}
    </div>
  );
}
