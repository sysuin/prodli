import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { storageGet, storageSet } from "../lib/storage";
import { getDayKey } from "../lib/utils";
import type { TrackerSettings, TimeTrackingDay } from "../types";

const ACCENT = "#8B5CF6";
const DEFAULT_SETTINGS: TrackerSettings = {
  idleThreshold: 60,
  notifyEnabled: true,
  notifyTime: "20:00",
};
const COLORS = ["#8B5CF6", "#FFD700", "#FF6B6B", "#00BCD4", "#66BB6A", "#FF8C94", "#4ECDC4", "#F59E0B"];

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function isExtension(): boolean {
  return typeof chrome !== "undefined" && !!(chrome as { storage?: unknown }).storage;
}

async function getAllTrackingData(): Promise<Record<string, TimeTrackingDay>> {
  if (isExtension()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        const out: Record<string, TimeTrackingDay> = {};
        for (const [k, v] of Object.entries(all)) {
          if (/^tt_\d{4}-\d{2}-\d{2}$/.test(k)) {
            out[k.slice(3)] = v as TimeTrackingDay;
          }
        }
        resolve(out);
      });
    });
  }
  // localStorage fallback
  const out: Record<string, TimeTrackingDay> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && /^prodli_tt_\d{4}-\d{2}-\d{2}$/.test(key)) {
      try {
        out[key.slice("prodli_tt_".length)] = JSON.parse(localStorage.getItem(key)!);
      } catch { /* skip */ }
    }
  }
  return out;
}

async function clearAllTrackingData(): Promise<void> {
  if (isExtension()) {
    const all: Record<string, unknown> = await new Promise((resolve) =>
      chrome.storage.local.get(null, resolve)
    );
    const keys = Object.keys(all).filter((k) => /^tt_/.test(k));
    if (keys.length) await new Promise<void>((resolve) => chrome.storage.local.remove(keys, resolve));
    return;
  }
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && /^prodli_tt_/.test(k)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

type Tab = "today" | "history" | "settings";

interface DaySummary {
  date: string;
  label: string;
  total: number;
  data: TimeTrackingDay;
}

export function TimeTrackerSection() {
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [todayData, setTodayData] = useState<TimeTrackingDay>({});
  const [weekData, setWeekData] = useState<DaySummary[]>([]);
  const [settings, setSettings] = useState<TrackerSettings>(DEFAULT_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const loadData = useCallback(async () => {
    const today = await storageGet<TimeTrackingDay>(`tt_${getDayKey()}`, {});
    setTodayData(today);

    const week: DaySummary[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getDayKey(d);
      const data = await storageGet<TimeTrackingDay>(`tt_${dateStr}`, {});
      const total = Object.values(data).reduce((s, v) => s + v, 0);
      const label = i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" });
      week.push({ date: dateStr, label, total, data });
    }
    setWeekData(week);

    const s = await storageGet<TrackerSettings>("tt_settings", DEFAULT_SETTINGS);
    setSettings(s);
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 5000);
    return () => clearInterval(id);
  }, [loadData]);

  const saveSettings = async (next: TrackerSettings) => {
    setSettings(next);
    await storageSet("tt_settings", next);
    setSettingsDirty(false);
  };

  const exportCSV = async () => {
    const all = await getAllTrackingData();
    const rows = ["Date,Domain,Seconds,Minutes"];
    for (const [date, domains] of Object.entries(all).sort()) {
      for (const [domain, secs] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
        rows.push(`${date},${domain},${secs},${Math.round(secs / 60)}`);
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prodli-time-tracking-${getDayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearData = async () => {
    if (!confirm("Clear all time tracking data? This cannot be undone.")) return;
    await clearAllTrackingData();
    setTodayData({});
    setWeekData((w) => w.map((d) => ({ ...d, total: 0, data: {} })));
  };

  const todayEntries = Object.entries(todayData).sort((a, b) => b[1] - a[1]);
  const todayTotal = todayEntries.reduce((s, [, v]) => s + v, 0);
  const top5 = todayEntries.slice(0, 8).map(([domain, secs], i) => ({
    domain: domain.length > 20 ? domain.slice(0, 18) + "…" : domain,
    secs,
    color: COLORS[i % COLORS.length],
  }));

  const sectionStyle: React.CSSProperties = {
    height: "100%",
    overflowY: "auto",
    padding: "24px 28px",
    background: "hsl(var(--background))",
    fontFamily: "Space Grotesk, Inter, sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    border: "2px solid hsl(var(--border))",
    background: "hsl(var(--card))",
    padding: "16px 20px",
    marginBottom: 16,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    border: "none",
    borderBottom: active ? `3px solid ${ACCENT}` : "3px solid transparent",
    background: "transparent",
    color: active ? ACCENT : "hsl(var(--muted-foreground))",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    padding: "8px 16px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  });

  const label: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "hsl(var(--muted-foreground))",
    marginBottom: 4,
  };

  return (
    <div style={sectionStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--foreground))" }}>
            ⏱ Time Tracker
          </div>
          {!isExtension() && (
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
              Web preview — install the extension to start tracking
            </div>
          )}
        </div>
        <button
          onClick={exportCSV}
          style={{
            background: ACCENT,
            color: "#fff",
            border: `2px solid ${ACCENT}`,
            fontWeight: 800,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "6px 14px",
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "3px 3px 0 #000",
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid hsl(var(--border))", marginBottom: 20 }}>
        {(["today", "history", "settings"] as Tab[]).map((t) => (
          <button key={t} style={tabStyle(activeTab === t)} onClick={() => setActiveTab(t)}>
            {t === "today" ? "Today" : t === "history" ? "7-Day History" : "⚙ Settings"}
          </button>
        ))}
      </div>

      {/* ── TODAY ──────────────────────────────────────────────────────────── */}
      {activeTab === "today" && (
        <>
          {/* Summary card */}
          <div style={{ ...cardStyle, display: "flex", gap: 32, alignItems: "center" }}>
            <div>
              <div style={label}>Total today</div>
              <div style={{ fontFamily: "Space Mono, monospace", fontSize: 28, fontWeight: 700, color: ACCENT }}>
                {fmtSecs(todayTotal)}
              </div>
            </div>
            <div>
              <div style={label}>Sites visited</div>
              <div style={{ fontFamily: "Space Mono, monospace", fontSize: 28, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                {todayEntries.length}
              </div>
            </div>
            {todayEntries[0] && (
              <div>
                <div style={label}>Top site</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "hsl(var(--foreground))" }}>
                  {todayEntries[0][0]}
                </div>
                <div style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  {fmtSecs(todayEntries[0][1])}
                </div>
              </div>
            )}
          </div>

          {todayEntries.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px", color: "hsl(var(--muted-foreground))" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No tracking data for today</div>
              <div style={{ fontSize: 12 }}>
                {isExtension()
                  ? "Browse some websites and come back — data updates every 5 seconds."
                  : "Install the ProdLi extension and it will track time automatically."}
              </div>
            </div>
          ) : (
            <>
              {/* Domain table */}
              <div style={cardStyle}>
                <div style={{ ...label, marginBottom: 12 }}>Time per site</div>
                {todayEntries.map(([domain, secs]) => {
                  const pct = todayTotal > 0 ? (secs / todayTotal) * 100 : 0;
                  return (
                    <div key={domain} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 180, fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {domain}
                      </div>
                      <div style={{ flex: 1, height: 8, background: "hsl(var(--muted))", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: ACCENT, transition: "width 0.4s ease" }} />
                      </div>
                      <div style={{ width: 70, fontSize: 12, fontFamily: "Space Mono, monospace", color: "hsl(var(--muted-foreground))", textAlign: "right", flexShrink: 0 }}>
                        {fmtSecs(secs)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bar chart — top sites */}
              {top5.length > 0 && (
                <div style={cardStyle}>
                  <div style={{ ...label, marginBottom: 12 }}>Top sites chart</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={top5} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis dataKey="domain" tick={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip
                        formatter={(v: number) => [fmtSecs(v), "Time"]}
                        contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 12 }}
                        cursor={{ fill: "hsl(var(--muted))" }}
                      />
                      <Bar dataKey="secs" radius={0}>
                        {top5.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── HISTORY ────────────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <>
          <div style={cardStyle}>
            <div style={{ ...label, marginBottom: 12 }}>Daily totals — last 7 days</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} />
                <Tooltip
                  formatter={(v: number) => [fmtSecs(v), "Total"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 12 }}
                  cursor={{ fill: "hsl(var(--muted))" }}
                />
                <Bar dataKey="total" fill={ACCENT} radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={cardStyle}>
            <div style={{ ...label, marginBottom: 12 }}>Day breakdown</div>
            {weekData.length === 0 || weekData.every((d) => d.total === 0) ? (
              <div style={{ textAlign: "center", padding: "24px", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                No data yet for the past 7 days
              </div>
            ) : (
              weekData
                .filter((d) => d.total > 0)
                .reverse()
                .map((day) => (
                  <div key={day.date} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 12, color: "hsl(var(--foreground))" }}>
                        {day.label} <span style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>({day.date})</span>
                      </span>
                      <span style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: ACCENT }}>
                        {fmtSecs(day.total)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(day.data)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([domain, secs]) => (
                          <span key={domain} style={{ background: "hsl(var(--muted))", fontSize: 10, fontWeight: 700, padding: "2px 7px", color: "hsl(var(--muted-foreground))" }}>
                            {domain} · {fmtSecs(secs)}
                          </span>
                        ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </>
      )}

      {/* ── SETTINGS ───────────────────────────────────────────────────────── */}
      {activeTab === "settings" && (
        <div style={cardStyle}>
          {/* Idle threshold */}
          <div style={{ marginBottom: 24 }}>
            <div style={label}>Idle threshold</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
              Pause tracking after this many seconds of inactivity.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input
                type="range"
                min={15}
                max={300}
                step={15}
                value={settings.idleThreshold}
                onChange={(e) => { setSettings((s) => ({ ...s, idleThreshold: +e.target.value })); setSettingsDirty(true); }}
                style={{ flex: 1, accentColor: ACCENT }}
              />
              <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 13, width: 50, textAlign: "right", color: "hsl(var(--foreground))" }}>
                {settings.idleThreshold}s
              </span>
            </div>
          </div>

          {/* Daily notification */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div style={label}>Daily summary notification</div>
                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  Get a Chrome notification with your top sites.
                </div>
              </div>
              <button
                onClick={() => { setSettings((s) => ({ ...s, notifyEnabled: !s.notifyEnabled })); setSettingsDirty(true); }}
                style={{
                  border: "2px solid hsl(var(--border))",
                  background: settings.notifyEnabled ? ACCENT : "hsl(var(--muted))",
                  color: settings.notifyEnabled ? "#fff" : "hsl(var(--muted-foreground))",
                  fontWeight: 800,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "5px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {settings.notifyEnabled ? "On" : "Off"}
              </button>
            </div>
            {settings.notifyEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Notify at</span>
                <input
                  type="time"
                  value={settings.notifyTime}
                  onChange={(e) => { setSettings((s) => ({ ...s, notifyTime: e.target.value })); setSettingsDirty(true); }}
                  style={{
                    fontFamily: "Space Mono, monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    border: "2px solid hsl(var(--border))",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    padding: "4px 8px",
                    outline: "none",
                  }}
                />
              </div>
            )}
          </div>

          {/* Save button */}
          {settingsDirty && (
            <button
              onClick={() => saveSettings(settings)}
              style={{
                background: ACCENT,
                color: "#fff",
                border: `2px solid ${ACCENT}`,
                fontWeight: 800,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "8px 18px",
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "3px 3px 0 #000",
                marginBottom: 24,
              }}
            >
              Save settings
            </button>
          )}

          {/* Danger zone */}
          <div style={{ borderTop: "2px solid hsl(var(--border))", paddingTop: 20 }}>
            <div style={{ ...label, color: "#ef4444", marginBottom: 8 }}>Danger zone</div>
            <button
              onClick={clearData}
              style={{
                background: "transparent",
                color: "#ef4444",
                border: "2px solid #ef4444",
                fontWeight: 800,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "6px 14px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear all tracking data
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
