import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { DomainSet } from "../../lib/domainSet";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, LineChart, Line } from "recharts";
import { getDayKey, getDaysBetween } from "../../lib/utils";
import type { TimeTrackingDay } from "../../types";
import {
  ACCENT,
  ACCENT_B,
  COLORS,
  fmtSecs,
  fmtDelta,
  computePreviousPeriod,
  buildDomainTotals,
  buildDayTotals,
  buildTrendPoints,
  getAllTrackingData,
  loadRangeData,
  invalidateRangeCache,
  type Preset,
} from "./data";

export function AllTimeTab({ excludedDomains }: { excludedDomains: string[] }) {
  const [allDates, setAllDates] = useState<string[]>([]);
  const [filteredData, setFilteredData] = useState<Record<string, TimeTrackingDay>>({});
  const excludedSet = useMemo(
    () => new DomainSet(excludedDomains),
    [excludedDomains],
  );
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

  // ── Compare mode ──────────────────────────────────────────────────────────
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [fromDateB, setFromDateB] = useState<string>("");
  const [toDateB, setToDateB] = useState<string>("");
  // Tracks whether the user has manually edited Period B — when true, Period A
  // changes do NOT auto-reset B to the previous period.
  const [userEditedB, setUserEditedB] = useState(false);
  const [filteredDataB, setFilteredDataB] = useState<Record<string, TimeTrackingDay>>({});

  // Initial mount: load all date keys (for "all" preset) + load initial range via loadRangeData
  useEffect(() => {
    // Bust the cache for the initial range so each tab activation sees fresh data
    invalidateRangeCache();
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

  // When compare is toggled on, initialize period B to "previous period"
  useEffect(() => {
    if (!compareEnabled) return;
    const { fromB, toB } = computePreviousPeriod(fromDate, toDate);
    setFromDateB(fromB);
    setToDateB(toB);
    setUserEditedB(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareEnabled]);

  // When period A changes while compare is active, re-sync period B to the new
  // previous period — but only if the user hasn't manually edited period B yet.
  useEffect(() => {
    if (!compareEnabled || userEditedB) return;
    const { fromB, toB } = computePreviousPeriod(fromDate, toDate);
    setFromDateB(fromB);
    setToDateB(toB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  // Load period B data when its dates change
  useEffect(() => {
    if (!compareEnabled || !fromDateB || !toDateB) return;
    loadRangeData(fromDateB, toDateB).then(setFilteredDataB);
  }, [compareEnabled, fromDateB, toDateB]);

  // ── Period A memos ──────────────────────────────────────────────────────
  const domainTotals = useMemo(
    () => buildDomainTotals(filteredData, debouncedQuery, excludedSet),
    [filteredData, debouncedQuery, excludedSet],
  );

  const filteredDayTotals = useMemo(
    () => buildDayTotals(filteredData, debouncedQuery, excludedSet),
    [filteredData, debouncedQuery, excludedSet],
  );

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

  // ── Period B memos ──────────────────────────────────────────────────────
  const domainTotalsB = useMemo(
    () => compareEnabled ? buildDomainTotals(filteredDataB, debouncedQuery, excludedSet) : {},
    [filteredDataB, debouncedQuery, excludedSet, compareEnabled],
  );

  const filteredDayTotalsB = useMemo(
    () => compareEnabled ? buildDayTotals(filteredDataB, debouncedQuery, excludedSet) : {},
    [filteredDataB, debouncedQuery, excludedSet, compareEnabled],
  );

  const statsB = useMemo(() => {
    const totalSecs = Object.values(domainTotalsB).reduce((s, v) => s + v, 0);
    const daysWithData = Object.keys(filteredDayTotalsB).length;
    return { totalSecs, daysWithData };
  }, [domainTotalsB, filteredDayTotalsB]);

  // ── Trend data ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const pointsA = buildTrendPoints(fromDate, toDate, filteredDayTotals);
    if (!compareEnabled) return pointsA.map((p) => ({ label: p.label, totalA: p.total }));

    const pointsB = buildTrendPoints(fromDateB || fromDate, toDateB || toDate, filteredDayTotalsB);
    const len = Math.max(pointsA.length, pointsB.length);
    return Array.from({ length: len }, (_, i) => ({
      label: `Day ${i + 1}`,
      totalA: pointsA[i]?.total ?? 0,
      totalB: pointsB[i]?.total ?? 0,
    }));
  }, [filteredDayTotals, filteredDayTotalsB, fromDate, toDate, fromDateB, toDateB, compareEnabled]);

  // ── Top sites ───────────────────────────────────────────────────────────
  const topSites = useMemo(() => {
    if (!compareEnabled) {
      return Object.entries(domainTotals)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([domain, secs], i) => ({
          domain: domain.length > 17 ? domain.slice(0, 15) + "…" : domain,
          secs, color: COLORS[i % COLORS.length],
        }));
    }
    // Merge top 10 from A + B, ranked by combined total (A + B) descending
    const allDomains = new Set([
      ...Object.keys(domainTotals),
      ...Object.keys(domainTotalsB),
    ]);
    return Array.from(allDomains)
      .map((d) => ({ domain: d, secsA: domainTotals[d] ?? 0, secsB: domainTotalsB[d] ?? 0 }))
      .sort((a, b) => (b.secsA + b.secsB) - (a.secsA + a.secsB))
      .slice(0, 10)
      .map(({ domain, secsA, secsB }) => ({
        domain: domain.length > 14 ? domain.slice(0, 12) + "…" : domain,
        secsA, secsB,
      }));
  }, [domainTotals, domainTotalsB, compareEnabled]);

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
  const pillBtn = (active: boolean, accentColor = ACCENT): React.CSSProperties => ({
    border: `2px solid ${active ? accentColor : "hsl(var(--border))"}`,
    background: active ? accentColor : "transparent",
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
  const spanB = fromDateB && toDateB ? getDaysBetween(fromDateB, toDateB) : 0;
  const totalDelta = fmtDelta(stats.totalSecs, statsB.totalSecs);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => { setCompareEnabled((v) => !v); if (compareEnabled) { setFromDateB(""); setToDateB(""); setFilteredDataB({}); } }}
            style={{ ...pillBtn(compareEnabled, ACCENT_B), whiteSpace: "nowrap" }}
          >
            {compareEnabled ? "✕ Compare" : "Compare"}
          </button>
          <button onClick={exportScoped} style={pillBtn(false)}>Export CSV</button>
        </div>

        {/* Period B date pickers */}
        {compareEnabled && (
          <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "center", paddingTop: 4, borderTop: "1px solid hsl(var(--border))", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT_B, flexShrink: 0 }}>
              Period B
            </span>
            <input type="date" value={fromDateB} max={toDateB || toDate}
              onChange={(e) => { setFromDateB(e.target.value); setUserEditedB(true); }}
              style={{ fontFamily: "Space Mono, monospace", fontSize: 11, border: `2px solid ${ACCENT_B}`, background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "3px 6px" }} />
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>→</span>
            <input type="date" value={toDateB} min={fromDateB}
              onChange={(e) => { setToDateB(e.target.value); setUserEditedB(true); }}
              style={{ fontFamily: "Space Mono, monospace", fontSize: 11, border: `2px solid ${ACCENT_B}`, background: "hsl(var(--background))", color: "hsl(var(--foreground))", padding: "3px 6px" }} />
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              {fromDateB && toDateB ? `${spanB + 1} days` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div style={{ ...card, display: "flex", gap: 28, flexWrap: "wrap" }}>
        {/* Total time with compare */}
        <div>
          <div style={lbl}>Total time{compareEnabled ? " · Period A" : ""}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: ACCENT }}>
              {fmtSecs(stats.totalSecs)}
            </div>
            {compareEnabled && (
              <>
                <div style={{ fontFamily: "Space Mono, monospace", fontSize: 15, fontWeight: 700, color: ACCENT_B }}>
                  vs {fmtSecs(statsB.totalSecs)}
                </div>
                {!totalDelta.zero && (
                  <div style={{
                    fontFamily: "Space Mono, monospace", fontSize: 12, fontWeight: 700,
                    color: totalDelta.positive ? "#22c55e" : "#ef4444",
                    border: `1px solid ${totalDelta.positive ? "#22c55e" : "#ef4444"}`,
                    padding: "1px 6px", flexShrink: 0,
                  }}>
                    {totalDelta.text} this period
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <div style={lbl}>Days tracked{compareEnabled ? " A / B" : ""}</div>
          <div style={{ fontFamily: "Space Mono, monospace", fontSize: 22, fontWeight: 700, color: "hsl(var(--foreground))" }}>
            {stats.daysWithData}{compareEnabled ? <span style={{ color: ACCENT_B, fontSize: 15 }}> / {statsB.daysWithData}</span> : null}
          </div>
        </div>

        {stats.topDomain && (
          <div>
            <div style={lbl}>Top site{compareEnabled ? " (Period A)" : ""}</div>
            <div style={{ fontWeight: 800, fontSize: 14, color: "hsl(var(--foreground))" }}>{stats.topDomain}</div>
            <div style={{ fontFamily: "Space Mono, monospace", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              {fmtSecs(domainTotals[stats.topDomain] ?? 0)} total
              {compareEnabled && domainTotalsB[stats.topDomain] !== undefined && (
                <span style={{ color: ACCENT_B }}> · {fmtSecs(domainTotalsB[stats.topDomain] ?? 0)} B</span>
              )}
            </div>
          </div>
        )}

        {!compareEnabled && stats.peakDay && (
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
          <div style={{ display: "grid", gridTemplateColumns: compareEnabled ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ ...lbl, marginBottom: compareEnabled ? 8 : 12 }}>
                Top 10 sites
              </div>
              {compareEnabled && (
                <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: ACCENT }} /> Period A
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: ACCENT_B }} /> Period B
                  </span>
                </div>
              )}
              <ResponsiveContainer width="100%" height={compareEnabled ? 280 : 220}>
                {compareEnabled ? (
                  <BarChart
                    data={topSites as Array<{ domain: string; secsA: number; secsB: number }>}
                    layout="vertical"
                    margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  >
                    <XAxis type="number" tickFormatter={(v: number) => fmtSecs(v)}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="domain" width={100}
                      tick={{ fontSize: 9, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v: number, name: string) => [fmtSecs(v), name === "secsA" ? "Period A" : "Period B"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                      cursor={{ fill: "hsl(var(--muted))" }}
                    />
                    <Bar dataKey="secsA" fill={ACCENT} radius={0} name="Period A" />
                    <Bar dataKey="secsB" fill={ACCENT_B} radius={0} name="Period B" />
                  </BarChart>
                ) : (
                  <BarChart
                    data={topSites as Array<{ domain: string; secs: number; color: string }>}
                    layout="vertical"
                    margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  >
                    <XAxis type="number" tickFormatter={(v: number) => fmtSecs(v)}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="domain" width={95}
                      tick={{ fontSize: 9, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number) => [fmtSecs(v), "Time"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                      cursor={{ fill: "hsl(var(--muted))" }} />
                    <Bar dataKey="secs" radius={0}>
                      {(topSites as Array<{ domain: string; secs: number; color: string }>).map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {!compareEnabled && (
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
            )}
          </div>

          {/* Daily / weekly trend chart */}
          <div style={card}>
            <div style={{ ...lbl, marginBottom: 4 }}>Browsing trend</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: compareEnabled ? 8 : 12 }}>
              {compareEnabled
                ? "Both periods aligned by relative day — Day 1 = first day of each period"
                : span > 60 ? "Aggregated by week — zoom in by narrowing the date range" : "One bar per day in the selected range"}
            </div>
            {compareEnabled && (
              <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
                  <span style={{ display: "inline-block", width: 10, height: 3, background: ACCENT }} /> Period A
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
                  <span style={{ display: "inline-block", width: 10, height: 3, background: ACCENT_B }} /> Period B
                </span>
              </div>
            )}
            <ResponsiveContainer width="100%" height={160}>
              {compareEnabled ? (
                <LineChart data={trendData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(trendData.length / 12) - 1)} />
                  <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false} width={58} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtSecs(v), name === "totalA" ? "Period A" : "Period B"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                    cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                  />
                  <Line type="monotone" dataKey="totalA" stroke={ACCENT} strokeWidth={2} dot={false} name="Period A" />
                  <Line type="monotone" dataKey="totalB" stroke={ACCENT_B} strokeWidth={2} dot={false} name="Period B" />
                </LineChart>
              ) : (
                <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(trendData.length / 12) - 1)} />
                  <YAxis tickFormatter={(v: number) => fmtSecs(v)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false} width={58} />
                  <Tooltip formatter={(v: number) => [fmtSecs(v), span > 60 ? "Week total" : "Day total"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--border))", borderRadius: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: 11 }}
                    cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="totalA" fill={ACCENT} radius={0} />
                </BarChart>
              )}
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
              const secsB = compareEnabled ? (domainTotalsB[domain] ?? 0) : 0;
              const pctB = compareEnabled && statsB.totalSecs > 0 ? (secsB / statsB.totalSecs) * 100 : 0;
              const delta = compareEnabled ? fmtDelta(secs, secsB) : null;
              return (
                <div key={domain} style={{ marginBottom: compareEnabled ? 12 : 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 200, fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {domain}
                    </div>
                    <div style={{ flex: 1, position: "relative" }}>
                      <div style={{ height: 6, background: "hsl(var(--muted))", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${pct}%`, background: ACCENT, transition: "width 0.3s" }} />
                      </div>
                      {compareEnabled && (
                        <div style={{ height: 4, background: "hsl(var(--muted))", position: "relative", overflow: "hidden", marginTop: 2 }}>
                          <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${pctB}%`, background: ACCENT_B, transition: "width 0.3s" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ width: compareEnabled ? 140 : 76, fontSize: 11, fontFamily: "Space Mono, monospace", color: "hsl(var(--muted-foreground))", textAlign: "right", flexShrink: 0 }}>
                      {fmtSecs(secs)}
                      {compareEnabled && (
                        <>
                          <span style={{ color: ACCENT_B }}> / {fmtSecs(secsB)}</span>
                          {delta && !delta.zero && (
                            <span style={{ color: delta.positive ? "#22c55e" : "#ef4444", marginLeft: 4 }}>{delta.text}</span>
                          )}
                        </>
                      )}
                    </div>
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

