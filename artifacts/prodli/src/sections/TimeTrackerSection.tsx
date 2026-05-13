import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { storageGet, storageSet } from "../lib/storage";
import { getDayKey, getDaysBetween } from "../lib/utils";
import type { TrackerSettings, TimeTrackingDay, FocusRule } from "../types";

const ACCENT = "#8B5CF6";
const DEFAULT_SETTINGS: TrackerSettings = {
  idleThreshold: 60,
  notifyEnabled: true,
  notifyTime: "20:00",
  focusList: [],
};
const COLORS = ["#8B5CF6", "#FFD700", "#FF6B6B", "#00BCD4", "#66BB6A", "#FF8C94", "#4ECDC4", "#F59E0B"];

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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

// Range loader: fetches all storage data, slices to [fromDate, toDate], caches by key
const _rangeCache = new Map<string, Record<string, TimeTrackingDay>>();
async function loadRangeData(fromDate: string, toDate: string): Promise<Record<string, TimeTrackingDay>> {
  const cacheKey = `${fromDate}|${toDate}`;
  if (_rangeCache.has(cacheKey)) return _rangeCache.get(cacheKey)!;
  const all = await getAllTrackingData();
  const result: Record<string, TimeTrackingDay> = {};
  for (const [date, data] of Object.entries(all)) {
    if (date >= fromDate && date <= toDate) result[date] = data;
  }
  _rangeCache.set(cacheKey, result);
  return result;
}

async function clearAllTrackingData(): Promise<void> {
  _rangeCache.clear();
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

type Tab = "today" | "history" | "alltime" | "settings";

interface DaySummary {
  date: string;
  label: string;
  total: number;
  data: TimeTrackingDay;
}

// ── All Time Tab ──────────────────────────────────────────────────────────────

type Preset = "30d" | "90d" | "ytd" | "all" | "custom";

function AllTimeTab() {
  const [allDates, setAllDates] = useState<string[]>([]);
  const [filteredData, setFilteredData] = useState<Record<string, TimeTrackingDay>>({});
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<Preset>("30d");
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 29); return getDayKey(d);
  });
  const [toDate, setToDate] = useState<string>(() => getDayKey());
  const [domainQuery, setDomainQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortCol, setSortCol] = useState<"time" | "name">("time");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  // Initial mount: load all date keys (for "all" preset) + load initial range via loadRangeData
  useEffect(() => {
    Promise.all([
      loadRangeData(fromDate, toDate),
      getAllTrackingData(),
    ]).then(([rangeData, allData]) => {
      setFilteredData(rangeData);
      setAllDates(Object.keys(allData).sort());
      setLoading(false);
    });
    // Intentionally empty deps — runs once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload range data via loadRangeData (cache-backed) when dates change after initial load
  useEffect(() => {
    if (loading) return;
    loadRangeData(fromDate, toDate).then(setFilteredData);
  }, [fromDate, toDate, loading]);

  useEffect(() => {
    if (preset === "custom") return;
    const today = getDayKey();
    const now = new Date();
    if (preset === "30d") {
      const f = new Date(); f.setDate(f.getDate() - 29); setFromDate(getDayKey(f)); setToDate(today);
    } else if (preset === "90d") {
      const f = new Date(); f.setDate(f.getDate() - 89); setFromDate(getDayKey(f)); setToDate(today);
    } else if (preset === "ytd") {
      setFromDate(`${now.getFullYear()}-01-01`); setToDate(today);
    } else if (preset === "all") {
      const earliest = allDates[0] ?? today;
      setFromDate(earliest); setToDate(today);
    }
  }, [preset, allDates]);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQuery(domainQuery); setPage(0); }, 280);
    return () => clearTimeout(id);
  }, [domainQuery]);

  const domainTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    const q = debouncedQuery.toLowerCase();
    for (const data of Object.values(filteredData)) {
      for (const [domain, secs] of Object.entries(data)) {
        if (q && !domain.toLowerCase().includes(q)) continue;
        totals[domain] = (totals[domain] ?? 0) + secs;
      }
    }
    return totals;
  }, [filteredData, debouncedQuery]);

  // Per-day totals respecting the domain filter — used for trend chart and stats
  const filteredDayTotals = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    const result: Record<string, number> = {};
    for (const [date, data] of Object.entries(filteredData)) {
      let total = 0;
      for (const [domain, secs] of Object.entries(data)) {
        if (!q || domain.toLowerCase().includes(q)) total += secs;
      }
      if (total > 0) result[date] = total;
    }
    return result;
  }, [filteredData, debouncedQuery]);

  const stats = useMemo(() => {
    const totalSecs = Object.values(domainTotals).reduce((s, v) => s + v, 0);
    const daysWithData = Object.keys(filteredDayTotals).length;
    const topDomain = Object.entries(domainTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    let peakDay = "", peakSecs = 0;
    for (const [date, total] of Object.entries(filteredDayTotals)) {
      if (total > peakSecs) { peakSecs = total; peakDay = date; }
    }
    return { totalSecs, daysWithData, topDomain, peakDay, peakSecs };
  }, [domainTotals, filteredDayTotals]);

  const trendData = useMemo(() => {
    const span = Math.max(0, getDaysBetween(fromDate, toDate));
    if (span > 60) {
      // Weekly aggregation — enumerate every day in range so empty weeks appear
      const weeks: Record<string, number> = {};
      for (let i = 0; i <= span; i++) {
        const d = new Date(fromDate + "T00:00:00");
        d.setDate(d.getDate() + i);
        const date = getDayKey(d);
        const ws = new Date(d);
        ws.setDate(d.getDate() - d.getDay());
        const wk = getDayKey(ws);
        weeks[wk] = (weeks[wk] ?? 0) + (filteredDayTotals[date] ?? 0);
      }
      return Object.entries(weeks).sort().map(([d, total]) => ({
        label: new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
        total,
      }));
    }
    // Daily — one entry per calendar day including zero-activity days
    const days = [];
    for (let i = 0; i <= span; i++) {
      const d = new Date(fromDate + "T00:00:00");
      d.setDate(d.getDate() + i);
      const date = getDayKey(d);
      days.push({
        label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
        total: filteredDayTotals[date] ?? 0,
      });
    }
    return days;
  }, [filteredDayTotals, fromDate, toDate]);

  const topSites = useMemo(() =>
    Object.entries(domainTotals)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([domain, secs], i) => ({
        domain: domain.length > 17 ? domain.slice(0, 15) + "…" : domain,
        secs, color: COLORS[i % COLORS.length],
      })),
    [domainTotals]);

  const pieData = useMemo(() => {
    const sorted = Object.entries(domainTotals).sort((a, b) => b[1] - a[1]);
    const grandTotal = sorted.reduce((s, [, v]) => s + v, 0);
    const top8 = sorted.slice(0, 8).map(([domain, secs], i) => ({
      name: domain.length > 15 ? domain.slice(0, 13) + "…" : domain,
      value: secs,
      pct: grandTotal > 0 ? Math.round((secs / grandTotal) * 100) : 0,
      color: COLORS[i % COLORS.length],
    }));
    const otherSecs = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
    if (otherSecs > 0) top8.push({
      name: "Other", value: otherSecs,
      pct: grandTotal > 0 ? Math.round((otherSecs / grandTotal) * 100) : 0,
      color: "#888",
    });
    return top8;
  }, [domainTotals]);

  const PAGE_SIZE = 20;
  const tableRows = useMemo(() => {
    const entries = Object.entries(domainTotals);
    entries.sort((a, b) =>
      sortCol === "time"
        ? sortAsc ? a[1] - b[1] : b[1] - a[1]
        : sortAsc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])
    );
    return entries;
  }, [domainTotals, sortCol, sortAsc]);

  const pageCount = Math.ceil(tableRows.length / PAGE_SIZE);
  const curPage = Math.min(page, Math.max(0, pageCount - 1));
  const pagedRows = tableRows.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE);

  const exportScoped = () => {
    const rows = ["Date,Domain,Seconds,Minutes"];
    const q = debouncedQuery.toLowerCase();
    for (const [date, domains] of Object.entries(filteredData).sort()) {
      for (const [domain, secs] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
        if (q && !domain.toLowerCase().includes(q)) continue;
        rows.push(`${date},${domain},${secs},${Math.round(secs / 60)}`);
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prodli-history-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const card: React.CSSProperties = {
    border: "2px solid hsl(var(--border))",
    background: "hsl(var(--card))",
    padding: "16px 20px",
    marginBottom: 16,
  };
  const lbl: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.1em", color: "hsl(var(--muted-foreground))", marginBottom: 4,
  };
  const pillBtn = (active: boolean): React.CSSProperties => ({
    border: `2px solid ${active ? ACCENT : "hsl(var(--border))"}`,
    background: active ? ACCENT : "transparent",
    color: active ? "#fff" : "hsl(var(--muted-foreground))",
    fontWeight: 800, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
    padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s",
  });
  const sortBtn = (active: boolean): React.CSSProperties => ({
    ...pillBtn(active), fontSize: 9, padding: "3px 8px",
  });

  if (loading) return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(var(--muted-foreground))", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
      Loading history…
    </div>
  );

  const hasData = Object.keys(domainTotals).length > 0;
  const span = getDaysBetween(fromDate, toDate);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["30d", "90d", "ytd", "all", "custom"] as Preset[]).map((p) => (
            <button key={p} style={pillBtn(preset === p)} onClick={() => setPreset(p)}>
              {p === "30d" ? "30 days" : p === "90d" ? "90 days" : p === "ytd" ? "This year" : p === "all" ? "All time" : "Custom"}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" value={fromDate} max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ fontFamily: "Space Mono, monospace", fontSize: 11, border: "2px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "3px 6px" }} />
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>→</span>
            <input type="date" value={toDate} min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ fontFamily: "Space Mono, monospace", fontSize: 11, border: "2px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "3px 6px" }} />
          </div>
        )}
        <input
          type="text"
          placeholder="Filter by domain…"
          value={domainQuery}
          onChange={(e) => setDomainQuery(e.target.value)}
          style={{ flex: 1, minWidth: 140, fontFamily: "inherit", fontSize: 12, border: "2px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "5px 10px", outline: "none" }}
        />
        <button onClick={exportScoped} style={pillBtn(false)}>Export CSV</button>
      </div>

      {/* Stats bar */}
      <div style={{ ...card, display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div>
          <div style={lbl}>Total time</div>
          <div style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: ACCENT }}>
            {fmtSecs(stats.totalSecs)}
          </div>
        </div>
        <div>
          <div style={lbl}>Days tracked</div>
          <div style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: "hsl(var(--foreground))" }}>
            {stats.daysWithData}
          </div>
        </div>
        {stats.topDomain && (
          <div>
            <div style={lbl}>Top site</div>
            <div style={{ fontWeight: 800, fontSize: 14, color: "hsl(var(--foreground))" }}>{stats.topDomain}</div>
            <div style={{ fontFamily: "Space Mono, monospace", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              {fmtSecs(domainTotals[stats.topDomain] ?? 0)} total
            </div>
          </div>
        )}
        {stats.peakDay && (
          <div>
            <div style={lbl}>Busiest day</div>
            <div style={{ fontWeight: 800, fontSize: 13, color: "hsl(var(--foreground))" }}>
              {new Date(stats.peakDay + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ fontFamily: "Space Mono, monospace", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              {fmtSecs(stats.peakSecs)}
            </div>
          </div>
        )}
      </div>

      {!hasData ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px", color: "hsl(var(--muted-foreground))" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>No data in this range</div>
          <div style={{ fontSize: 12 }}>Try "All time" or widen the date range.</div>
        </div>
      ) : (
        <>
          {/* Charts row: top sites (horizontal bar) + pie */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ ...lbl, marginBottom: 12 }}>Top 10 sites</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topSites} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                  <XAxis type="number" tickFormatter={(v: number) => fmtSecs(v)}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="domain" width={95}
                    tick={{ fontSize: 9, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [fmtSecs(v), "Time"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                    cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="secs" radius={0}>
                    {topSites.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ ...lbl, marginBottom: 12 }}>Time share</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="44%"
                    outerRadius={72} innerRadius={32}>
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [fmtSecs(v), "Time"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }} />
                  <Legend iconSize={8} iconType="square"
                    formatter={(value: string) => {
                      const entry = pieData.find((e) => e.name === value);
                      return (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
                          {value}{entry ? ` ${entry.pct}%` : ""}
                        </span>
                      );
                    }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily / weekly trend chart */}
          <div style={card}>
            <div style={{ ...lbl, marginBottom: 4 }}>Browsing trend</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>
              {span > 60 ? "Aggregated by week — zoom in by narrowing the date range" : "One bar per day in the selected range"}
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false}
                  interval={Math.max(0, Math.floor(trendData.length / 12) - 1)} />
                <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false} width={58} />
                <Tooltip formatter={(v: number) => [fmtSecs(v), span > 60 ? "Week total" : "Day total"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                  cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="total" fill={ACCENT} radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sortable data table */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={lbl}>{tableRows.length} domains · page {curPage + 1}/{Math.max(1, pageCount)}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={sortBtn(sortCol === "name")}
                  onClick={() => { setSortCol("name"); setSortAsc(sortCol === "name" ? !sortAsc : true); setPage(0); }}>
                  Domain {sortCol === "name" ? (sortAsc ? "↑" : "↓") : ""}
                </button>
                <button style={sortBtn(sortCol === "time")}
                  onClick={() => { setSortCol("time"); setSortAsc(sortCol === "time" ? !sortAsc : false); setPage(0); }}>
                  Time {sortCol === "time" ? (sortAsc ? "↑" : "↓") : ""}
                </button>
              </div>
            </div>

            {pagedRows.map(([domain, secs]) => {
              const pct = stats.totalSecs > 0 ? (secs / stats.totalSecs) * 100 : 0;
              return (
                <div key={domain} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                  <div style={{ width: 200, fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {domain}
                  </div>
                  <div style={{ flex: 1, height: 6, background: "hsl(var(--muted))", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${pct}%`, background: ACCENT, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ width: 76, fontSize: 11, fontFamily: "Space Mono, monospace", color: "hsl(var(--muted-foreground))", textAlign: "right", flexShrink: 0 }}>
                    {fmtSecs(secs)}
                  </div>
                </div>
              );
            })}

            {pageCount > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 16 }}>
                <button disabled={curPage === 0} onClick={() => setPage((p) => p - 1)}
                  style={{ ...pillBtn(false), opacity: curPage === 0 ? 0.35 : 1 }}>← Prev</button>
                <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontFamily: "Space Mono, monospace" }}>
                  {curPage + 1} / {pageCount}
                </span>
                <button disabled={curPage >= pageCount - 1} onClick={() => setPage((p) => p + 1)}
                  style={{ ...pillBtn(false), opacity: curPage >= pageCount - 1 ? 0.35 : 1 }}>Next →</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main TimeTrackerSection ───────────────────────────────────────────────────

export function TimeTrackerSection() {
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [todayData, setTodayData] = useState<TimeTrackingDay>({});
  const [weekData, setWeekData] = useState<DaySummary[]>([]);
  const [settings, setSettings] = useState<TrackerSettings>(DEFAULT_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newLimit, setNewLimit] = useState(30);
  const [focusError, setFocusError] = useState("");
  const [redirectPermissionGranted, setRedirectPermissionGranted] = useState(false);
  const domainInputRef = useRef<HTMLInputElement>(null);

  const checkRedirectPermission = useCallback(async () => {
    if (!isExtension() || !chrome.permissions) return;
    const granted = await chrome.permissions.contains({ permissions: ["scripting"], origins: ["<all_urls>"] });
    setRedirectPermissionGranted(granted);
  }, []);

  const requestRedirectPermission = async (enableForRuleId?: string) => {
    if (!isExtension() || !chrome.permissions) return;
    try {
      const granted = await chrome.permissions.request({ permissions: ["scripting"], origins: ["<all_urls>"] });
      setRedirectPermissionGranted(granted);
      // If triggered from a specific rule row, auto-enable redirect for that rule
      if (granted && enableForRuleId) {
        const next: TrackerSettings = {
          ...settings,
          focusList: (settings.focusList ?? []).map((r) =>
            r.id === enableForRuleId ? { ...r, redirectEnabled: true } : r
          ),
        };
        await saveSettings(next);
      }
    } catch {
      setRedirectPermissionGranted(false);
    }
  };

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
    await checkRedirectPermission();
  }, [checkRedirectPermission]);

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

  const todayEntries = Object.entries(todayData).sort((a, b) => b[1] - a[1]);
  const todayTotal = todayEntries.reduce((s, [, v]) => s + v, 0);
  const top8 = todayEntries.slice(0, 8).map(([domain, secs], i) => ({
    domain: domain.length > 20 ? domain.slice(0, 18) + "…" : domain,
    secs,
    color: COLORS[i % COLORS.length],
  }));

  const weekAvgData = (() => {
    const totals: Record<string, number> = {};
    weekData.forEach((day) => {
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
  })();

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
        {activeTab !== "alltime" && (
          <button
            onClick={exportAllCSV}
            style={{
              background: ACCENT, color: "#fff", border: `2px solid ${ACCENT}`,
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
              <BarChart data={weekData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
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
      {activeTab === "alltime" && <AllTimeTab />}

      {/* ── SETTINGS ───────────────────────────────────────────────────────── */}
      {activeTab === "settings" && (
        <div style={cardStyle}>
          <div style={{ marginBottom: 24 }}>
            <div style={label}>Idle threshold</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
              Pause tracking after this many seconds of inactivity.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input type="range" min={15} max={300} step={15} value={settings.idleThreshold}
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
                <input type="time" value={settings.notifyTime}
                  onChange={(e) => { setSettings((s) => ({ ...s, notifyTime: e.target.value })); setSettingsDirty(true); }}
                  style={{ fontFamily: "Space Mono, monospace", fontSize: 13, fontWeight: 700, border: "2px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "4px 8px", outline: "none" }} />
              </div>
            )}
          </div>

          {settingsDirty && (
            <button onClick={() => saveSettings(settings)} style={{
              background: ACCENT, color: "#fff", border: `2px solid ${ACCENT}`,
              fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "8px 18px", cursor: "pointer", fontFamily: "inherit",
              boxShadow: "3px 3px 0 #000", marginBottom: 24,
            }}>
              Save settings
            </button>
          )}

          {/* Focus List */}
          <div style={{ borderTop: "2px solid hsl(var(--border))", paddingTop: 20, marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 4 }}>Focus list</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 14 }}>
              Set daily time limits per site. You'll get a notification when the limit is reached.
            </div>

            {/* Redirect permission banner */}
            {isExtension() && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                border: `2px solid ${redirectPermissionGranted ? "#22c55e" : "hsl(var(--border))"}`,
                background: redirectPermissionGranted ? "rgba(34,197,94,0.08)" : "hsl(var(--muted))",
                padding: "8px 12px",
                marginBottom: 14,
                flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: redirectPermissionGranted ? "#22c55e" : "hsl(var(--foreground))", marginBottom: 2 }}>
                    {redirectPermissionGranted ? "✓ Redirect permission granted" : "Auto-redirect (optional)"}
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    {redirectPermissionGranted
                      ? "When a limit is hit, the tab will redirect to your new tab page."
                      : "Grant permission to automatically redirect tabs when a limit is reached."}
                  </div>
                </div>
                {!redirectPermissionGranted && (
                  <button
                    onClick={() => requestRedirectPermission()}
                    style={{
                      background: ACCENT,
                      color: "#fff",
                      border: `2px solid ${ACCENT}`,
                      fontWeight: 800,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      padding: "5px 12px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      boxShadow: "2px 2px 0 #000",
                      flexShrink: 0,
                    }}
                  >
                    Grant Permission
                  </button>
                )}
              </div>
            )}

            {/* Add rule row */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", flex: "1 1 160px", minWidth: 140 }}>
                <input
                  ref={domainInputRef}
                  type="text"
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
                  color: "#fff",
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
                            onClick={() => redirectPermissionGranted ? toggleRedirect(rule.id) : requestRedirectPermission(rule.id)}
                            title={
                              !redirectPermissionGranted
                                ? "Grant redirect permission first (click to request)"
                                : rule.redirectEnabled
                                  ? "Click to disable auto-redirect"
                                  : "Click to enable auto-redirect to new tab"
                            }
                            style={{
                              border: `2px solid ${!redirectPermissionGranted ? "hsl(var(--border))" : rule.redirectEnabled ? ACCENT : "hsl(var(--border))"}`,
                              background: !redirectPermissionGranted ? "hsl(var(--muted))" : rule.redirectEnabled ? ACCENT : "hsl(var(--muted))",
                              color: !redirectPermissionGranted ? "hsl(var(--muted-foreground))" : rule.redirectEnabled ? "#fff" : "hsl(var(--muted-foreground))",
                              fontWeight: 800,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              padding: "3px 9px",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              transition: "all 0.15s",
                              opacity: !redirectPermissionGranted ? 0.5 : 1,
                            }}
                          >
                            {!redirectPermissionGranted ? "–" : rule.redirectEnabled ? "On" : "Off"}
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
      )}
    </div>
  );
}
