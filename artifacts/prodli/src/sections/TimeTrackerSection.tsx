import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, LineChart, Line } from "recharts";
import { storageGet, storageSet } from "../lib/storage";
import { getDayKey, getDaysBetween } from "../lib/utils";
import type { TrackerSettings, TimeTrackingDay, FocusRule } from "../types";
import { accountsEnabled } from "../lib/prodliAccount";
import { ACCENT, ON_ACCENT, COLORS, DEFAULT_SETTINGS, compareToUsual, fmtSecs, isExtension, getAllTrackingData, clearAllTrackingData, clearDomainHistory, type Tab, type DaySummary } from "./tracker/data";
import { CategorySelect, FocusScoreCard, useSiteCategories } from "./tracker/FocusScore";
import { AllTimeTab } from "./tracker/AllTimeTab";

/** `settingsOnly`: just the settings (Settings › Time Tracker). */
export function TimeTrackerSection({ settingsOnly = false }: { settingsOnly?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [todayData, setTodayData] = useState<TimeTrackingDay>({});
  const [weekData, setWeekData] = useState<DaySummary[]>([]);
  const [settings, setSettings] = useState<TrackerSettings>(DEFAULT_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newLimit, setNewLimit] = useState(30);
  const [focusError, setFocusError] = useState("");
  const domainInputRef = useRef<HTMLInputElement>(null);
  const [newExcludedDomain, setNewExcludedDomain] = useState("");
  const [excludeError, setExcludeError] = useState("");
  const excludedInputRef = useRef<HTMLInputElement>(null);
  const [domainToClear, setDomainToClear] = useState<string | null>(null);
  const [siteCategories, setSiteCategory] = useSiteCategories();

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

  const addFocusRule = async () => {
    setFocusError("");
    const raw = newDomain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
    if (!raw) { setFocusError("Enter a domain name."); return; }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) { setFocusError("Enter a valid domain (e.g. reddit.com)."); return; }
    if ((settings.focusList ?? []).some((r) => r.domain === raw)) { setFocusError("That domain is already in the list."); return; }
    const rule: FocusRule = { id: crypto.randomUUID(), domain: raw, limitMinutes: newLimit, redirectEnabled: false };
    const next: TrackerSettings = { ...settings, focusList: [...(settings.focusList ?? []), rule] };
    await saveSettings(next);
    setNewDomain("");
    setNewLimit(30);
    domainInputRef.current?.focus();
  };

  const removeFocusRule = async (id: string) => {
    const next: TrackerSettings = { ...settings, focusList: (settings.focusList ?? []).filter((r) => r.id !== id) };
    await saveSettings(next);
  };

  const toggleRedirect = async (id: string) => {
    const next: TrackerSettings = {
      ...settings,
      focusList: (settings.focusList ?? []).map((r) => r.id === id ? { ...r, redirectEnabled: !r.redirectEnabled } : r),
    };
    await saveSettings(next);
  };

  const updateLimit = async (id: string, limitMinutes: number) => {
    const next: TrackerSettings = {
      ...settings,
      focusList: (settings.focusList ?? []).map((r) => r.id === id ? { ...r, limitMinutes } : r),
    };
    await saveSettings(next);
  };

  const addExcludedDomain = async () => {
    setExcludeError("");
    const raw = newExcludedDomain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
    if (!raw) { setExcludeError("Enter a domain name."); return; }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) && raw !== "localhost") {
      setExcludeError("Enter a valid domain (e.g. example.com).");
      return;
    }
    const existing = settings.excludedDomains ?? [];
    if (existing.some((d) => d.toLowerCase() === raw)) {
      setExcludeError("That domain is already excluded.");
      return;
    }
    const next: TrackerSettings = { ...settings, excludedDomains: [...existing, raw] };
    await saveSettings(next);
    setNewExcludedDomain("");
    excludedInputRef.current?.focus();
  };

  const removeExcludedDomain = async (domain: string) => {
    const next: TrackerSettings = {
      ...settings,
      excludedDomains: (settings.excludedDomains ?? []).filter((d) => d !== domain),
    };
    await saveSettings(next);
  };

  const exportAllCSV = async () => {
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

  const excludedSet = useMemo(
    () => new Set((settings.excludedDomains ?? []).map((d) => d.toLowerCase())),
    [settings.excludedDomains],
  );

  const todayEntries = useMemo(
    () =>
      Object.entries(todayData)
        .filter(([domain]) => !excludedSet.has(domain.toLowerCase()))
        .sort((a, b) => b[1] - a[1]),
    [todayData, excludedSet],
  );
  const todayTotal = todayEntries.reduce((s, [, v]) => s + v, 0);
  const top8 = todayEntries.slice(0, 8).map(([domain, secs], i) => ({
    domain: domain.length > 20 ? domain.slice(0, 18) + "…" : domain,
    secs,
    color: COLORS[i % COLORS.length],
  }));

  const filteredWeekData = useMemo(
    () =>
      weekData.map((day) => {
        const data = Object.fromEntries(
          Object.entries(day.data).filter(([domain]) => !excludedSet.has(domain.toLowerCase())),
        );
        const total = Object.values(data).reduce((s, v) => s + v, 0);
        return { ...day, data, total };
      }),
    [weekData, excludedSet],
  );

  const weekAvgData = useMemo(() => {
    const totals: Record<string, number> = {};
    filteredWeekData.forEach((day) => {
      Object.entries(day.data).forEach(([domain, secs]) => {
        totals[domain] = (totals[domain] ?? 0) + secs;
      });
    });
    return Object.entries(totals)
      .map(([domain, total]) => ({
        domain: domain.length > 20 ? domain.slice(0, 18) + "…" : domain,
        avgSecs: Math.round(total / 7),
      }))
      .sort((a, b) => b.avgSecs - a.avgSecs)
      .slice(0, 8);
  }, [filteredWeekData]);

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

  const TAB_LABELS: Record<Tab, string> = {
    today: "Today",
    history: "7-Day History",
    alltime: "All Time",
    settings: "⚙ Settings",
  };

  const settingsPanel = (
        <div style={cardStyle}>
          <div style={{ marginBottom: 24 }}>
            <div style={label}>Idle threshold</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
              Pause tracking after this many seconds of inactivity.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input type="range" min={15} max={300} step={15} value={settings.idleThreshold} aria-label="Idle threshold in seconds"
                onChange={(e) => { setSettings((s) => ({ ...s, idleThreshold: +e.target.value })); setSettingsDirty(true); }}
                style={{ flex: 1, accentColor: ACCENT }} />
              <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: 13, width: 50, textAlign: "right", color: "hsl(var(--foreground))" }}>
                {settings.idleThreshold}s
              </span>
            </div>
          </div>

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
                  fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
                  padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                }}
              >
                {settings.notifyEnabled ? "On" : "Off"}
              </button>
            </div>
            {settings.notifyEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Notify at</span>
                <input type="time" value={settings.notifyTime} aria-label="Daily summary time"
                  onChange={(e) => { setSettings((s) => ({ ...s, notifyTime: e.target.value })); setSettingsDirty(true); }}
                  style={{ fontFamily: "Space Mono, monospace", fontSize: 13, fontWeight: 700, border: "2px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "4px 8px", outline: "none" }} />
              </div>
            )}
          </div>

          {settingsDirty && (
            <button onClick={() => saveSettings(settings)} style={{
              background: ACCENT, color: ON_ACCENT, border: `2px solid ${ACCENT}`,
              fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "8px 18px", cursor: "pointer", fontFamily: "inherit",
              boxShadow: "3px 3px 0 #000", marginBottom: 24,
            }}>
              Save settings
            </button>
          )}

          {/* Blocked Domains */}
          <div style={{ borderTop: "2px solid hsl(var(--border))", paddingTop: 20, marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 4 }}>Blocked domains</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 14 }}>
              Domains on this list are never tracked and are hidden from all views. Separate from the focus-limit list.
            </div>

            {/* Add row */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap" }}>
              <input
                ref={excludedInputRef}
                type="text"
                aria-label="Site not to track"
                placeholder="example.com"
                value={newExcludedDomain}
                onChange={(e) => { setNewExcludedDomain(e.target.value); setExcludeError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") addExcludedDomain(); }}
                style={{
                  flex: "1 1 180px",
                  minWidth: 140,
                  fontFamily: "Space Mono, monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  border: `2px solid ${excludeError ? "#ef4444" : "hsl(var(--border))"}`,
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                  padding: "6px 10px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={addExcludedDomain}
                style={{
                  background: ACCENT,
                  color: ON_ACCENT,
                  border: `2px solid ${ACCENT}`,
                  fontWeight: 800,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "2px 2px 0 #000",
                  flexShrink: 0,
                }}
              >
                Add
              </button>
            </div>
            {excludeError && (
              <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 10 }}>{excludeError}</div>
            )}

            {/* List */}
            {(settings.excludedDomains ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", padding: "12px 0", fontStyle: "italic" }}>
                No domains blocked yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {(settings.excludedDomains ?? []).map((domain) => (
                  <div
                    key={domain}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      border: "2px solid hsl(var(--border))",
                      background: "hsl(var(--background))",
                      padding: "8px 12px",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontFamily: "Space Mono, monospace", fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {domain}
                    </span>
                    <button
                      onClick={() => setDomainToClear(domain)}
                      aria-label="Clear history"
                      style={{
                        background: "transparent",
                        border: "2px solid hsl(var(--border))",
                        color: "hsl(var(--muted-foreground))",
                        cursor: "pointer",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        padding: "3px 8px",
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      Clear history
                    </button>
                    <button
                      onClick={() => removeExcludedDomain(domain)}
                      aria-label="Remove"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "hsl(var(--muted-foreground))",
                        cursor: "pointer",
                        fontSize: 16,
                        lineHeight: 1,
                        padding: "0 2px",
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Clear history confirmation dialog */}
            {domainToClear && (
              <div style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}>
                <div style={{
                  background: "hsl(var(--card))",
                  border: "3px solid hsl(var(--border))",
                  padding: "24px 28px",
                  maxWidth: 360,
                  width: "90%",
                  boxShadow: "6px 6px 0 #000",
                }}>
                  <div style={{ fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10, color: "hsl(var(--foreground))" }}>
                    Clear history?
                  </div>
                  <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 20, lineHeight: 1.5 }}>
                    This will permanently remove all stored tracking data for <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, color: "hsl(var(--foreground))" }}>{domainToClear}</span> across every recorded day. This cannot be undone.
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setDomainToClear(null)}
                      style={{
                        background: "transparent",
                        border: "2px solid hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                        fontWeight: 800,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        padding: "6px 14px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const domain = domainToClear;
                        setDomainToClear(null);
                        await clearDomainHistory(domain);
                      }}
                      style={{
                        background: "#ef4444",
                        border: "2px solid #ef4444",
                        color: "#fff",
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
                      Clear history
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Focus List */}
          <div style={{ borderTop: "2px solid hsl(var(--border))", paddingTop: 20, marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 4 }}>Focus list</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 14 }}>
              Set daily time limits per site. You'll get a notification when the limit is reached.
            </div>

            {isExtension() && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>
                Turn on <strong>Redirect</strong> for a site to show ProdLi's pause screen once its daily limit is used up (for the rest of the day).
              </div>
            )}

            {/* Add rule row */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", flex: "1 1 160px", minWidth: 140 }}>
                <input
                  ref={domainInputRef}
                  type="text"
                  aria-label="Site to limit"
                  placeholder="reddit.com"
                  value={newDomain}
                  onChange={(e) => { setNewDomain(e.target.value); setFocusError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") addFocusRule(); }}
                  style={{
                    fontFamily: "Space Mono, monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    border: `2px solid ${focusError ? "#ef4444" : "hsl(var(--border))"}`,
                    background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    padding: "6px 10px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <input
                  type="number"
                  aria-label="Daily limit in minutes"
                  min={1}
                  max={1440}
                  value={newLimit}
                  onChange={(e) => setNewLimit(Math.max(1, +e.target.value))}
                  style={{
                    fontFamily: "Space Mono, monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    border: "2px solid hsl(var(--border))",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    padding: "6px 8px",
                    width: 58,
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 700 }}>min</span>
              </div>
              <button
                onClick={addFocusRule}
                style={{
                  background: ACCENT,
                  color: ON_ACCENT,
                  border: `2px solid ${ACCENT}`,
                  fontWeight: 800,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "2px 2px 0 #000",
                  flexShrink: 0,
                }}
              >
                Add
              </button>
            </div>
            {focusError && (
              <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 10 }}>{focusError}</div>
            )}

            {/* Existing rules */}
            {(settings.focusList ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", padding: "12px 0", fontStyle: "italic" }}>
                No sites in your focus list yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {(settings.focusList ?? []).map((rule) => {
                  const todaySecs = todayData[rule.domain] ?? 0;
                  const limitSecs = rule.limitMinutes * 60;
                  const pct = Math.min(100, limitSecs > 0 ? (todaySecs / limitSecs) * 100 : 0);
                  const over = todaySecs >= limitSecs;
                  return (
                    <div
                      key={rule.id}
                      style={{
                        border: `2px solid ${over ? "#ef4444" : "hsl(var(--border))"}`,
                        background: "hsl(var(--background))",
                        padding: "10px 12px",
                      }}
                    >
                      {/* Domain row */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: over ? "#ef4444" : "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {rule.domain}
                          </span>
                          {over && (
                            <span style={{ fontSize: 10, fontWeight: 800, background: "#ef4444", color: "#fff", padding: "1px 6px", letterSpacing: "0.05em", flexShrink: 0 }}>
                              LIMIT HIT
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeFocusRule(rule.id)}
                          aria-label="Remove"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "hsl(var(--muted-foreground))",
                            cursor: "pointer",
                            fontSize: 16,
                            lineHeight: 1,
                            padding: "0 2px",
                            flexShrink: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div style={{ height: 6, background: "hsl(var(--muted))", marginBottom: 8, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: over ? "#ef4444" : ACCENT, transition: "width 0.4s ease" }} />
                      </div>

                      {/* Time + controls */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "Space Mono, monospace", fontSize: 11, color: over ? "#ef4444" : "hsl(var(--muted-foreground))" }}>
                            {fmtSecs(todaySecs)}
                          </span>
                          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>/</span>
                          <input
                            type="number"
                            aria-label={`Daily limit for ${rule.domain} in minutes`}
                            min={1}
                            max={1440}
                            value={rule.limitMinutes}
                            onChange={(e) => updateLimit(rule.id, Math.max(1, +e.target.value))}
                            style={{
                              fontFamily: "Space Mono, monospace",
                              fontSize: 11,
                              fontWeight: 700,
                              border: "2px solid hsl(var(--border))",
                              background: "hsl(var(--card))",
                              color: "hsl(var(--foreground))",
                              padding: "2px 6px",
                              width: 50,
                              outline: "none",
                            }}
                          />
                          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 700 }}>min</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Redirect
                          </span>
                          <button
                            onClick={() => toggleRedirect(rule.id)}
                            title={rule.redirectEnabled ? "Click to stop pausing this site when its limit is used up" : "Click to pause this site once its limit is used up"}
                            style={{
                              border: `2px solid ${rule.redirectEnabled ? ACCENT : "hsl(var(--border))"}`,
                              background: rule.redirectEnabled ? ACCENT : "hsl(var(--muted))",
                              color: rule.redirectEnabled ? "#fff" : "hsl(var(--muted-foreground))",
                              fontWeight: 800,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              padding: "3px 9px",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              transition: "all 0.15s",
                              opacity: 1,
                            }}
                          >
                            {rule.redirectEnabled ? "On" : "Off"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div style={{ borderTop: "2px solid hsl(var(--border))", paddingTop: 20 }}>
            <div style={{ ...label, color: "#ef4444", marginBottom: 8 }}>Danger zone</div>
            <button onClick={clearData} style={{
              background: "transparent", color: "#ef4444", border: "2px solid #ef4444",
              fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
            }}>
              Clear all tracking data
            </button>
          </div>
        </div>

  );
  if (settingsOnly) return settingsPanel;

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
              {accountsEnabled() ? "Time tracked by the ProdLi extension on your computers (synced)" : "Web preview — install the extension to start tracking"}
            </div>
          )}
        </div>
        {activeTab !== "alltime" && (
          <button
            onClick={exportAllCSV}
            style={{
              background: ACCENT, color: ON_ACCENT, border: `2px solid ${ACCENT}`,
              fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", boxShadow: "3px 3px 0 #000",
            }}
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid hsl(var(--border))", marginBottom: 20 }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button key={t} style={tabStyle(activeTab === t)} onClick={() => setActiveTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── TODAY ──────────────────────────────────────────────────────────── */}
      {activeTab === "today" && (
        <>
          <div style={{ ...cardStyle, display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
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
            {(() => {
              const usual = compareToUsual(todayTotal, weekData.slice(0, -1).map((d) => d.total));
              if (!usual) return null;
              const up = usual.percent > 0;
              return (
                <div data-testid="tracker-vs-usual">
                  <div style={label}>{todayTotal < 1800 ? "Your usual day" : "Vs. your usual day"}</div>
                  <div style={{ fontFamily: "Space Mono, monospace", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>
                    {todayTotal < 1800 ? fmtSecs(usual.average) : usual.percent === 0 ? "≈ same" : `${up ? "▲" : "▼"} ${Math.abs(usual.percent)}%`}
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{todayTotal < 1800 ? "average of the last 6 days" : `average ${fmtSecs(usual.average)} (last 6 days)`}</div>
                </div>
              );
            })()}
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

          <FocusScoreCard today={todayData} week={weekData} overrides={siteCategories} excluded={excludedSet} cardStyle={cardStyle} />

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
              <div style={cardStyle}>
                <div style={{ ...label, marginBottom: 12 }}>Time per site</div>
                {todayEntries.map(([domain, secs]) => {
                  const pct = todayTotal > 0 ? (secs / todayTotal) * 100 : 0;
                  return (
                    <div key={domain} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 180, fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", flexShrink: 1, minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {domain}
                      </div>
                      <CategorySelect domain={domain} overrides={siteCategories} onChange={setSiteCategory} />
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

              {top8.length > 0 && (
                <div style={cardStyle}>
                  <div style={{ ...label, marginBottom: 12 }}>Top sites chart</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={top8} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis dataKey="domain" tick={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} />
                      <Tooltip formatter={(v: number) => [fmtSecs(v), "Time"]}
                        contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 12 }}
                        cursor={{ fill: "hsl(var(--muted))" }} />
                      <Bar dataKey="secs" radius={0}>
                        {top8.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── 7-DAY HISTORY ──────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <>
          <div style={cardStyle}>
            <div style={{ ...label, marginBottom: 12 }}>Daily totals — last 7 days</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={filteredWeekData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} />
                <Tooltip formatter={(v: number) => [fmtSecs(v), "Total"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 12 }}
                  cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="total" fill={ACCENT} radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={cardStyle}>
            <div style={{ ...label, marginBottom: 4 }}>7-day averages per site</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>
              Average daily time per domain over the last 7 days
            </div>
            {weekAvgData.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                No data yet for the past 7 days
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={weekAvgData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="domain" tick={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip formatter={(v: number) => [fmtSecs(v), "Avg/day"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 12 }}
                      cursor={{ fill: "hsl(var(--muted))" }} />
                    <Bar dataKey="avgSecs" radius={0}>
                      {weekAvgData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                  {weekAvgData.map((entry, i) => (
                    <span key={entry.domain} style={{ background: "hsl(var(--muted))", fontSize: 10, fontWeight: 700, padding: "2px 8px", color: "hsl(var(--muted-foreground))", borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                      {entry.domain} · {fmtSecs(entry.avgSecs)}/day
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── ALL TIME ───────────────────────────────────────────────────────── */}
      {activeTab === "alltime" && <AllTimeTab excludedDomains={settings.excludedDomains ?? []} />}

      {/* ── SETTINGS ───────────────────────────────────────────────────────── */}
      {activeTab === "settings" && settingsPanel}
    </div>
  );
}
