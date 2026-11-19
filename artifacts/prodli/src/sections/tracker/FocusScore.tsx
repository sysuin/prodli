// Time Tracker → focus score: today's score, time per kind (productive /
// neutral / distracting) and per category, the last 7 days, and a picker to
// change a site's category. Logic: lib/siteCategories.ts.

import { useEffect, useState, type CSSProperties } from "react";
import { breakdown, CATEGORIES, CATEGORY, categoryOf, cleanDomain, focusScore, KIND_LABEL, scoreLabel, SITE_CATEGORIES_KEY, type CategoryId, type CategoryKind } from "../../lib/siteCategories";
import { onStorageChange, storageGet, storageSet } from "../../lib/storage";
import { fmtSecs } from "./data";

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
