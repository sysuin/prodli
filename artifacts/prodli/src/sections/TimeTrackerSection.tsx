import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [allData, setAllData] = useState<Record<string, TimeTrackingDay>>({});
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

  useEffect(() => {
    getAllTrackingData().then((data) => { setAllData(data); setLoading(false); });
  }, []);

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
      const earliest = Object.keys(allData).sort()[0] ?? today;
      setFromDate(earliest); setToDate(today);
    }
  }, [preset, allData]);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQuery(domainQuery); setPage(0); }, 280);
    return () => clearTimeout(id);
  }, [domainQuery]);

  const filtered = useMemo(() => {
    const result: Record<string, TimeTrackingDay> = {};
    for (const [date, data] of Object.entries(allData)) {
      if (date >= fromDate && date <= toDate) result[date] = data;
    }
    return result;
  }, [allData, fromDate, toDate]);

  const domainTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    const q = debouncedQuery.toLowerCase();
    for (const data of Object.values(filtered)) {
      for (const [domain, secs] of Object.entries(data)) {
        if (q && !domain.toLowerCase().includes(q)) continue;
        totals[domain] = (totals[domain] ?? 0) + secs;
      }
    }
    return totals;
  }, [filtered, debouncedQuery]);

  // Per-day totals respecting the domain filter — used for trend chart and stats
  const filteredDayTotals = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    const result: Record<string, number> = {};
    for (const [date, data] of Object.entries(filtered)) {
      let total = 0;
      for (const [domain, secs] of Object.entries(data)) {
        if (!q || domain.toLowerCase().includes(q)) total += secs;
      }
      if (total > 0) result[date] = total;
    }
    return result;
  }, [filtered, debouncedQuery]);

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
    const days = Object.entries(filteredDayTotals)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const span = getDaysBetween(fromDate, toDate);
    if (span > 60) {
      const weeks: Record<string, number> = {};
      for (const { date, total } of days) {
        const d = new Date(date + "T00:00:00");
        const ws = new Date(d);
        ws.setDate(d.getDate() - d.getDay());
        const wk = getDayKey(ws);
        weeks[wk] = (weeks[wk] ?? 0) + total;
      }
      return Object.entries(weeks).sort().map(([d, total]) => ({
        label: new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
        total,
      }));
    }
    return days.map(({ date, total }) => ({
      label: new Date(date + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
      total,
    }));
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
    for (const [date, domains] of Object.entries(filtered).sort()) {
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
