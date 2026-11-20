// Meetings → "📊 Insights" (Pro): where your meeting time goes over the last
// 8 weeks — hours per week, this week against last, recurring meetings, call
// apps, and what came out of them. Worked out here from the saved meetings
// (lib/meetingInsights.ts); nothing is sent anywhere.

import { useMemo, useState, type CSSProperties } from "react";
import { hours, INSIGHT_WEEKS, meetingInsights, WEEKDAYS } from "../../lib/meetingInsights";
import { PLATFORM_LABEL } from "../../recorder/calls";
import type { Meeting } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const ACCENT = "#FF4FA3";
const tile: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 12px", display: "grid", gap: 2, minWidth: 0 };
const label: CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.8 };
const big: CSSProperties = { fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 };
const h3: CSSProperties = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" };
const weekLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

function change(now: number, before: number): string {
  if (!before) return now ? "none the week before" : "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "same as last week" : `${pct > 0 ? "+" : ""}${pct}% vs last week`;
}

export function MeetingInsights({ meetings, onOpenMeeting }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void }) {
  const access = useProAccess();
  const locked = !!access && !access.allowed;
  const data = useMemo(() => meetingInsights(meetings), [meetings]);
  const [hover, setHover] = useState<number | null>(null);
  const maxWeek = Math.max(1, ...data.weeks.map((w) => w.minutes));
  const maxPlatform = Math.max(1, ...data.byPlatform.map((p) => p.minutes));
  const shown = hover ?? data.weeks.length - 1;

  return (
    <div data-testid="meeting-insights" style={{ display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 900, fontSize: 16 }}>
          Where your meeting time goes
          <ProBadge />
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>From the meetings you recorded in the last {INSIGHT_WEEKS} weeks. Worked out on this device.</div>
        <ProNote access={access} what="Meeting insights" />
      </div>

      {locked ? null : data.total.count === 0 ? (
        <div style={{ border: "var(--nb-border)", padding: 20, textAlign: "center", fontSize: 14, fontWeight: 700 }}>No meetings recorded in the last {INSIGHT_WEEKS} weeks yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile} data-testid="insight-this-week">
              <span style={label}>This week</span>
              <span style={big}>{hours(data.thisWeek.minutes)}</span>
              <span style={{ fontSize: 12 }}>
                {data.thisWeek.count} meeting{data.thisWeek.count === 1 ? "" : "s"}
                {change(data.thisWeek.minutes, data.lastWeek.minutes) && ` · ${change(data.thisWeek.minutes, data.lastWeek.minutes)}`}
              </span>
            </div>
            <div style={tile}>
              <span style={label}>Average meeting</span>
              <span style={big}>{hours(data.avgMinutes)}</span>
              <span style={{ fontSize: 12 }}>{data.total.count} meetings, {hours(data.total.minutes)} in all</span>
            </div>
            <div style={tile}>
              <span style={label}>Busiest day</span>
              <span style={big}>{data.busiestDay === null ? "—" : WEEKDAYS[data.busiestDay]}</span>
              <span style={{ fontSize: 12 }}>most meeting time</span>
            </div>
            <div style={tile} data-testid="insight-outcomes">
              <span style={label}>What came out</span>
              <span style={big}>{data.decisions} decision{data.decisions === 1 ? "" : "s"}</span>
              <span style={{ fontSize: 12 }}>
                {data.actionItems} action item{data.actionItems === 1 ? "" : "s"}, {data.actionItemsDone} done
              </span>
            </div>
            {data.talkShare !== null && (
              <div style={tile}>
                <span style={label}>You talked</span>
                <span style={big}>{data.talkShare}%</span>
                <span style={{ fontSize: 12 }}>of the time, on average</span>
              </div>
            )}
          </div>

          <section aria-labelledby="mi-weeks">
            <h3 id="mi-weeks" style={h3}>Meeting time per week</h3>
            <div style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 12px" }}>
              <div aria-live="polite" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
                Week of {weekLabel(data.weeks[shown].weekStart)}: {hours(data.weeks[shown].minutes)}, {data.weeks[shown].count} meeting{data.weeks[shown].count === 1 ? "" : "s"}
              </div>
              <div role="list" aria-label="Meeting time per week" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, borderBottom: "1px solid hsl(var(--foreground) / 0.35)" }}>
                {data.weeks.map((w, i) => (
                  <div
                    key={w.weekStart}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`Week of ${weekLabel(w.weekStart)}: ${hours(w.minutes)}, ${w.count} meetings`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", cursor: "default", outlineOffset: 2 }}
                  >
                    <div
                      style={{
                        width: "60%",
                        maxWidth: 36,
                        height: w.minutes ? `${Math.max(3, (w.minutes / maxWeek) * 100)}%` : 0,
                        background: i === shown ? ACCENT : "hsl(var(--foreground) / 0.25)",
                        border: w.minutes ? "1.5px solid hsl(var(--foreground))" : "none",
                        borderBottom: "none",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div aria-hidden style={{ display: "flex", gap: 2, marginTop: 4 }}>
                {data.weeks.map((w, i) => (
                  <span key={w.weekStart} style={{ flex: 1, textAlign: "center", fontSize: 10, opacity: i === data.weeks.length - 1 || i === 0 ? 0.85 : 0, whiteSpace: "nowrap" }}>
                    {i === data.weeks.length - 1 ? "This week" : weekLabel(w.weekStart)}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <section aria-labelledby="mi-series" data-testid="insight-series">
              <h3 id="mi-series" style={h3}>Recurring meetings</h3>
              {data.series.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.8 }}>No meeting happened more than once yet.</div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {data.series.map((s) => (
                    <li key={s.latestId} style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "6px 10px", display: "flex", gap: 8, alignItems: "baseline" }}>
                      <button onClick={() => onOpenMeeting(s.latestId)} title="Open the latest one" style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: "inherit", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.title}
                      </button>
                      <span style={{ fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {s.count}× · {hours(s.minutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="mi-apps" data-testid="insight-apps">
              <h3 id="mi-apps" style={h3}>By call app</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {data.byPlatform.map((p) => (
                  <li key={p.platform} style={{ display: "grid", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, fontWeight: 700 }}>
                      <span>{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {hours(p.minutes)} · {p.count}
                      </span>
                    </div>
                    <div aria-hidden style={{ height: 8, background: "hsl(var(--foreground) / 0.12)" }}>
                      <div style={{ width: `${Math.max(2, (p.minutes / maxPlatform) * 100)}%`, height: "100%", background: "hsl(var(--foreground) / 0.75)", borderRadius: "0 4px 4px 0" }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
