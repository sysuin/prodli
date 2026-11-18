// "🚫 Block distracting sites" on the Pomodoro page (extension only): the block
// list, "while a focus session runs", and schedules. Blocking itself happens in
// the background (lib/focusBlockBackground.ts).

import { useEffect, useState, type CSSProperties } from "react";
import { blockingNow, DEFAULT_FOCUS_BLOCK, FOCUS_BLOCK_KEY, FOCUS_STATS_KEY, normalizeSite, scheduleLabel, SUGGESTED_SITES, type BlockSchedule, type FocusBlockSettings } from "../../lib/focusBlock";
import { onStorageChange, storageGet, storageSet } from "../../lib/storage";
import { generateId, getDayKey } from "../../lib/utils";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const field: CSSProperties = { border: "var(--nb-border)", padding: "0 8px", height: 30, boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };
const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "3px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };

export function FocusBlockPanel({ focusRunning }: { focusRunning: boolean }) {
  const [s, setS] = useState<FocusBlockSettings>(DEFAULT_FOCUS_BLOCK);
  const [site, setSite] = useState("");
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(0);

  useEffect(() => {
    const load = () => {
      void storageGet<Partial<FocusBlockSettings>>(FOCUS_BLOCK_KEY, {}).then((v) => setS({ ...DEFAULT_FOCUS_BLOCK, ...v }));
      void storageGet<Record<string, Record<string, number>>>(FOCUS_STATS_KEY, {}).then((st) => setPaused(Object.values(st[getDayKey()] ?? {}).reduce((a, b) => a + b, 0)));
    };
    load();
    const offA = onStorageChange(FOCUS_BLOCK_KEY, load);
    const offB = onStorageChange(FOCUS_STATS_KEY, load);
    return () => {
      offA();
      offB();
    };
  }, []);

  const save = (next: FocusBlockSettings) => {
    setS(next);
    void storageSet(FOCUS_BLOCK_KEY, next);
  };
  const addSite = (raw: string) => {
    const d = normalizeSite(raw);
    if (!d) return setError("Enter a site like youtube.com");
    setError("");
    setSite("");
    if (!s.sites.includes(d)) save({ ...s, enabled: true, sites: [...s.sites, d] });
  };
  const updateSchedule = (id: string, patch: Partial<BlockSchedule>) => save({ ...s, schedules: s.schedules.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const now = blockingNow(s, focusRunning);

  return (
    <section data-testid="focus-block" aria-label="Block distracting sites" style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", padding: 14, width: "min(520px, 100%)", boxSizing: "border-box", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>🚫 Block distracting sites</div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => save({ ...s, enabled: e.target.checked })} /> On
        </label>
      </div>
      <div role="status" style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: now ? "var(--danger-text)" : "hsl(var(--muted-foreground))" }}>
        {!s.enabled || !s.sites.length ? "Off. Add sites and turn it on." : now === "pomodoro" ? "Blocking now: focus session running." : now === "schedule" ? "Blocking now: focus hours." : "Not blocking right now."}
        {paused > 0 ? ` Paused ${paused} time${paused > 1 ? "s" : ""} today.` : ""}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {s.sites.map((d) => (
          <span key={d} style={{ border: "var(--nb-border)", padding: "2px 4px 2px 8px", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4, background: "hsl(var(--muted))" }}>
            {d}
            <button aria-label={`Unblock ${d}`} onClick={() => save({ ...s, sites: s.sites.filter((x) => x !== d) })} style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 900, color: "var(--danger-text)", fontSize: 13 }}>×</button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addSite(site);
        }}
        style={{ display: "flex", gap: 6, marginTop: 8 }}
      >
        <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Add a site, e.g. youtube.com" aria-label="Site to block" style={{ ...field, flex: 1 }} />
        <button type="submit" style={small}>Add</button>
      </form>
      {error && <div role="alert" style={{ fontSize: 11, color: "var(--danger-text)", fontWeight: 700, marginTop: 4 }}>{error}</div>}
      {SUGGESTED_SITES.some((d) => !s.sites.includes(d)) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 700 }}>Add:</span>
          {SUGGESTED_SITES.filter((d) => !s.sites.includes(d)).map((d) => (
            <button key={d} onClick={() => addSite(d)} style={{ ...small, fontWeight: 700, padding: "1px 6px" }}>+ {d}</button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={s.duringPomodoro} onChange={(e) => save({ ...s, duringPomodoro: e.target.checked })} /> While a focus session runs
        </label>
        <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>Focus hours</div>
        {s.schedules.length === 0 && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>None. Add one to block sites at set times.</div>}
        {s.schedules.map((sc) => (
          <div key={sc.id} data-testid="block-schedule" aria-label={scheduleLabel(sc)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span role="group" aria-label="Days" style={{ display: "inline-flex" }}>
              {DAY_LETTERS.map((l, d) => {
                const on = sc.days.includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    aria-label={DAY_NAMES[d]}
                    onClick={() => updateSchedule(sc.id, { days: on ? sc.days.filter((x) => x !== d) : [...sc.days, d].sort() })}
                    style={{ width: 24, height: 24, border: "var(--nb-border)", marginLeft: d ? -2 : 0, background: on ? "hsl(var(--foreground))" : "hsl(var(--card))", color: on ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {l}
                  </button>
                );
              })}
            </span>
            <input type="time" aria-label="From" value={sc.start} onChange={(e) => e.target.value && updateSchedule(sc.id, { start: e.target.value })} style={field} />
            <span style={{ fontSize: 12 }}>to</span>
            <input type="time" aria-label="To" value={sc.end} onChange={(e) => e.target.value && updateSchedule(sc.id, { end: e.target.value })} style={field} />
            <button aria-label={`Remove focus hours ${scheduleLabel(sc)}`} onClick={() => save({ ...s, schedules: s.schedules.filter((x) => x.id !== sc.id) })} style={{ ...small, color: "var(--danger-text)" }}>×</button>
          </div>
        ))}
        <div>
          <button onClick={() => save({ ...s, schedules: [...s.schedules, { id: generateId(), days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" }] })} style={small}>+ Add focus hours</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 10 }}>
        Blocked sites show a pause screen with “Close tab”. You can still continue after a short wait. ProdLi only checks the site name; it doesn't read pages.
      </div>
    </section>
  );
}
