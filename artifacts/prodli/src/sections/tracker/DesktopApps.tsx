// Time Tracker › "Apps on this computer" (desktop app only, opt-in): time per
// app, counted by the desktop app (lib/appUsage.ts). Stays on this computer.

import { useEffect, useState, type CSSProperties } from "react";
import { APP_TRACKING_KEY, APPS_DAY, appsDayKey, sumDays, topApps } from "../../lib/appUsage";
import { onAnyStorageChange, onStorageChange, storageGet, storageGetAll, storageRemove, storageSet } from "../../lib/storage";
import { ACCENT, ON_ACCENT, fmtSecs } from "./data";

type Range = "today" | "week";

const btn = (primary = false): CSSProperties => ({
  background: primary ? ACCENT : "hsl(var(--card))",
  color: primary ? ON_ACCENT : "hsl(var(--foreground))",
  border: `2px solid ${primary ? ACCENT : "hsl(var(--border))"}`,
  fontWeight: 800,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
});

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(appsDayKey(d));
  }
  return out;
}

export function DesktopApps({ cardStyle, label }: { cardStyle: CSSProperties; label: CSSProperties }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [range, setRange] = useState<Range>("today");
  const [days, setDays] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    void storageGet<boolean>(APP_TRACKING_KEY, false).then(setOn);
    const offOn = onStorageChange<boolean>(APP_TRACKING_KEY, (v) => setOn(v === true));
    const load = () =>
      void storageGetAll().then((all) => {
        const next: Record<string, Record<string, number>> = {};
        for (const [k, v] of Object.entries(all)) if (APPS_DAY.test(k) && v && typeof v === "object") next[k] = v as Record<string, number>;
        setDays(next);
      });
    load();
    const offAny = onAnyStorageChange((keys) => keys.some((k) => APPS_DAY.test(k)) && load());
    return () => {
      offOn();
      offAny();
    };
  }, []);

  if (on === null) return null;
  if (!on) {
    return (
      <div style={{ ...cardStyle, display: "grid", gap: 10 }} data-testid="desktop-apps-off">
        <div style={label}>Apps on this computer</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          See how long you spend in each app — Slack, Zoom, Figma, your editor… The ProdLi app notes which app is in front every few seconds; idle time isn't counted. Only app names are recorded, never what's on screen, and it stays on this computer.
        </div>
        <div>
          <button style={btn(true)} onClick={() => void storageSet(APP_TRACKING_KEY, true)} data-testid="desktop-apps-turn-on">
            Track time in apps
          </button>
        </div>
      </div>
    );
  }

  const keys = range === "today" ? [appsDayKey()] : lastDays(7);
  const totals = sumDays(keys.map((k) => days[k]));
  const rows = topApps(totals, 15);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const max = rows[0]?.seconds ?? 1;

  return (
    <div style={{ ...cardStyle, display: "grid", gap: 12 }} data-testid="desktop-apps">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={label}>Apps on this computer · {range === "today" ? "today" : "last 7 days"}</div>
          <div style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: ACCENT }}>{fmtSecs(total)}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={btn(range === "today")} aria-pressed={range === "today"} onClick={() => setRange("today")}>
            Today
          </button>
          <button style={btn(range === "week")} aria-pressed={range === "week"} onClick={() => setRange("week")}>
            7 days
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Nothing yet — time shows up here as you use your apps.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.app} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr auto", gap: 10, alignItems: "center", fontSize: 13 }}>
              <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.app}>
                {r.app}
              </span>
              <div style={{ height: 10, background: "hsl(var(--muted))" }} role="presentation">
                <div style={{ height: "100%", width: `${Math.max(2, (r.seconds / max) * 100)}%`, background: ACCENT }} />
              </div>
              <span style={{ fontFamily: "Space Mono, monospace", fontSize: 12 }}>
                {fmtSecs(r.seconds)} <span style={{ opacity: 0.6 }}>{Math.round(r.share * 100)}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px dashed hsl(var(--border))", paddingTop: 10, fontSize: 12, alignItems: "center" }}>
        <span style={{ flex: 1, minWidth: 200, color: "hsl(var(--muted-foreground))" }}>Kept on this computer, not synced. Websites are tracked by the ProdLi Chrome extension.</span>
        <button style={btn()} onClick={() => void storageSet(APP_TRACKING_KEY, false)}>
          Turn off
        </button>
        <button
          style={btn()}
          onClick={() => {
            if (!confirm("Delete all app time on this computer?")) return;
            void storageGetAll().then((all) => Promise.all(Object.keys(all).filter((k) => APPS_DAY.test(k)).map((k) => storageRemove(k))));
          }}
        >
          Clear history
        </button>
      </div>
    </div>
  );
}
