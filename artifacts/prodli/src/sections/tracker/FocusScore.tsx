// Time Tracker → focus score: today's score, time per kind (productive /
// neutral / distracting) and per category, the last 7 days, and a picker to
// change a site's category. Logic: lib/siteCategories.ts.

import { useEffect, useState, type CSSProperties } from "react";
import { breakdown, CATEGORIES, CATEGORY, categoryOf, cleanDomain, focusScore, focusTrend, KIND_LABEL, scoreLabel, SITE_CATEGORIES_KEY, type CategoryId, type CategoryKind } from "../../lib/siteCategories";
import { onStorageChange, storageGet, storageSet } from "../../lib/storage";
import { fmtSecs, getAllTrackingData } from "./data";
import { getDayKey } from "../../lib/utils";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

export const KIND_COLOR: Record<CategoryKind, string> = { productive: "#16A34A", neutral: "#9CA3AF", distracting: "#DC2626" };

/** The user's site categories, kept up to date. */
export function useSiteCategories(): [Record<string, string>, (domain: string, id: CategoryId) => void] {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    void storageGet<Record<string, string>>(SITE_CATEGORIES_KEY, {}).then(setOverrides);
    return onStorageChange<Record<string, string>>(SITE_CATEGORIES_KEY, (v) => setOverrides(v ?? {}));
  }, []);
  const set = (domain: string, id: CategoryId) => {
    const next = { ...overrides, [cleanDomain(domain)]: id };
    setOverrides(next);
    void storageSet(SITE_CATEGORIES_KEY, next);
  };
  return [overrides, set];
}

/** A small category picker for one site. */
export function CategorySelect({ domain, overrides, onChange }: { domain: string; overrides: Record<string, string>; onChange: (domain: string, id: CategoryId) => void }) {
  const id = categoryOf(domain, overrides);
  return (
    <select
      value={id}
      onChange={(e) => onChange(domain, e.target.value as CategoryId)}
      aria-label={`Category for ${domain}`}
      title={KIND_LABEL[CATEGORY[id].kind]}
      style={{ width: 132, flexShrink: 0, fontSize: 11, fontWeight: 700, fontFamily: "inherit", border: "1px solid hsl(var(--border))", borderLeft: `4px solid ${KIND_COLOR[CATEGORY[id].kind]}`, background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "2px 4px" }}
    >
      {CATEGORIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.emoji} {c.label}
        </option>
      ))}
    </select>
  );
}

const label: CSSProperties = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--muted-foreground))" };

export function FocusScoreCard({ today, week, overrides, excluded, cardStyle }: { today: Record<string, number>; week: { date: string; label: string; data: Record<string, number> }[]; overrides: Record<string, string>; excluded: Set<string>; cardStyle: CSSProperties }) {
  const b = breakdown(today, overrides, excluded);
  const score = focusScore(b);
  const days = week.map((d) => ({ ...d, score: focusScore(breakdown(d.data, overrides, excluded)) }));
  if (!b.total) return null;
  return (
    <div style={cardStyle} data-testid="focus-score">
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={label}>Focus score</div>
          <div style={{ fontFamily: "Space Mono, monospace", fontSize: 32, fontWeight: 700, color: "hsl(var(--foreground))", lineHeight: 1.1 }}>
            {score === null ? "—" : score}
            {score !== null && <span style={{ fontSize: 13, marginLeft: 6, fontFamily: "Space Grotesk, sans-serif" }}>{scoreLabel(score)}</span>}
          </div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", maxWidth: 220 }}>
            {score === null ? "Shows after 10 minutes on productive or distracting sites." : "Productive time out of productive + distracting."}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div role="img" aria-label={(Object.keys(b.byKind) as CategoryKind[]).map((k) => `${KIND_LABEL[k]} ${fmtSecs(b.byKind[k])}`).join(", ")} style={{ display: "flex", height: 12, border: "1px solid hsl(var(--border))" }}>
            {(Object.keys(b.byKind) as CategoryKind[]).map((k) => (b.byKind[k] ? <div key={k} style={{ width: `${(b.byKind[k] / b.total) * 100}%`, background: KIND_COLOR[k] }} /> : null))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 700, color: "hsl(var(--foreground))" }}>
            {(Object.keys(b.byKind) as CategoryKind[]).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden style={{ width: 8, height: 8, background: KIND_COLOR[k], display: "inline-block" }} />
                {KIND_LABEL[k]} {fmtSecs(b.byKind[k])}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        {b.byCategory.map((c) => (
          <span key={c.id} style={{ border: "1px solid hsl(var(--border))", borderLeft: `4px solid ${KIND_COLOR[CATEGORY[c.id].kind]}`, padding: "2px 8px", fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))" }}>
            {CATEGORY[c.id].emoji} {CATEGORY[c.id].label} <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 400 }}>{fmtSecs(c.seconds)}</span>
          </span>
        ))}
      </div>
      {days.some((d) => d.score !== null) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 4 }}>Last 7 days</div>
          <ol aria-label="Focus score, last 7 days" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 6 }}>
            {days.map((d) => (
              <li key={d.date} style={{ flex: 1, minWidth: 0, textAlign: "center", border: "1px solid hsl(var(--border))", padding: "2px 0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>{d.label}</div>
                <div style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 13, color: "hsl(var(--foreground))" }}>{d.score ?? "—"}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 8 }}>Change a site's category in the list below. Categories stay on this device.</div>
    </div>
  );
}

/** Time Tracker → focus trends over 30 or 90 days (Pro). */
export function FocusTrends({ overrides, excluded, cardStyle }: { overrides: Record<string, string>; excluded: Set<string>; cardStyle: CSSProperties }) {
  const access = useProAccess();
  const [span, setSpan] = useState<30 | 90>(30);
  const [days, setDays] = useState<Record<string, Record<string, number>> | null>(null);
  useEffect(() => {
    void getAllTrackingData().then(setDays);
  }, []);
  if (!days) return null;
  const t = focusTrend(days, getDayKey(), span, overrides, excluded);
  if (t.average === null) return null;
  const locked = !!access && !access.allowed;
  const change = t.previousAverage !== null ? t.average - t.previousAverage : null;
  return (
    <div style={cardStyle} data-testid="focus-trends">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={label}>
          Focus trends
          <ProBadge />
        </div>
        <div role="group" aria-label="Period" style={{ display: "flex" }}>
          {([30, 90] as const).map((n, i) => (
            <button key={n} aria-pressed={span === n} onClick={() => setSpan(n)} style={{ border: "1px solid hsl(var(--border))", marginLeft: i ? -1 : 0, background: span === n ? "hsl(var(--foreground))" : "hsl(var(--card))", color: span === n ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, fontSize: 11, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>
              {n} days
            </button>
          ))}
        </div>
      </div>
      {locked ? (
        <ProNote access={access} what="Focus trends" />
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ fontFamily: "Space Mono, monospace", fontSize: 26, fontWeight: 700, color: "hsl(var(--foreground))" }}>{t.average}</div>
            <div style={{ fontSize: 12, color: "hsl(var(--foreground))", fontWeight: 700 }}>
              average over {span} days
              {change !== null && change !== 0 && <span style={{ color: change > 0 ? "#15803D" : "var(--danger-text)" }}> {change > 0 ? "▲" : "▼"} {Math.abs(change)} vs the {span} days before</span>}
            </div>
            {t.topDistraction && t.topDistraction.minutes > 0 && (
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                Biggest distraction: {CATEGORY[t.topDistraction.id].emoji} {CATEGORY[t.topDistraction.id].label} ({t.topDistraction.minutes >= 60 ? `${Math.round(t.topDistraction.minutes / 60)} h` : `${t.topDistraction.minutes} min`})
              </div>
            )}
          </div>
          <div role="img" aria-label={`Daily focus score for the last ${span} days, average ${t.average}`} style={{ display: "flex", alignItems: "flex-end", gap: span === 30 ? 3 : 1, height: 60, marginTop: 10 }}>
            {t.points.map((p) => (
              <div key={p.date} title={`${p.date}: ${p.score ?? "—"}`} style={{ flex: 1, height: p.score === null ? 2 : `${Math.max(4, p.score)}%`, background: p.score === null ? "hsl(var(--muted))" : p.score >= 75 ? KIND_COLOR.productive : p.score >= 50 ? "#D97706" : KIND_COLOR.distracting }} />
            ))}
          </div>
          {access?.earlyAccess && <ProNote access={access} what="Focus trends" />}
        </>
      )}
    </div>
  );
}
