// The pause page a blocked site is sent to (index.html#blocked?u=…&r=…).
// Closing the tab is the big, easy choice; continuing takes a 10-second wait
// and then allows the site for 5 minutes (studies of One Sec found a pause
// with an easy way out cuts visits the most).

import { useEffect, useState, type CSSProperties } from "react";
import { activeSchedule, DEFAULT_FOCUS_BLOCK, FOCUS_BLOCK_KEY, FOCUS_PASSES_KEY, FOCUS_STATS_KEY, PASS_MINUTES, WAIT_SECONDS, type BlockReason, type FocusBlockSettings } from "../lib/focusBlock";
import { TIMER_KEY, type TimerState } from "../lib/pomodoroCore";
import { storageGet } from "../lib/storage";
import { getDayKey } from "../lib/utils";
import type { Todo, TrackerSettings } from "../types";

const btn = (primary: boolean): CSSProperties => ({
  border: "3px solid #000",
  boxShadow: primary ? "5px 5px 0 #000" : "3px 3px 0 #000",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: primary ? "14px 28px" : "9px 16px",
  fontWeight: 900,
  fontSize: primary ? 18 : 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  fontFamily: "inherit",
});

async function closeThisTab(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) return void (await chrome.tabs.remove(tab.id));
  } catch {
    // fall through
  }
  window.close();
}

export function PausePage({ url, domain, reason }: { url: string; domain: string; reason: BlockReason }) {
  const [why, setWhy] = useState<string>("");
  const [count, setCount] = useState(0);
  const [tasks, setTasks] = useState<string[]>([]);
  const [wait, setWait] = useState<number | null>(null);

  useEffect(() => {
    document.title = `Paused: ${domain}`;
    void (async () => {
      const today = getDayKey();
      if (reason === "pomodoro") {
        const t = await storageGet<TimerState | null>(TIMER_KEY, null);
        const left = t?.endsAt ? Math.max(1, Math.round((t.endsAt - Date.now()) / 60_000)) : null;
        setWhy(left ? `You're in a focus session: ${left} min to go.` : "You're in a focus session.");
      } else if (reason === "schedule") {
        const s = { ...DEFAULT_FOCUS_BLOCK, ...(await storageGet<Partial<FocusBlockSettings>>(FOCUS_BLOCK_KEY, {})) };
        const on = activeSchedule(s.schedules);
        setWhy(on ? `These are your focus hours, until ${on.end}.` : "These are your focus hours.");
      } else {
        const tt = await storageGet<TrackerSettings | null>("tt_settings", null);
        const rule = tt?.focusList?.find((r) => domain === r.domain || domain.endsWith(`.${r.domain}`));
        setWhy(rule ? `You've used today's ${rule.limitMinutes} minutes on ${rule.domain}.` : "You've used today's time on this site.");
      }
      const stats = await storageGet<Record<string, Record<string, number>>>(FOCUS_STATS_KEY, {});
      setCount(Object.values(stats[today] ?? {}).reduce((a, b) => a + b, 0));
      const todos = await storageGet<Todo[]>("todos", []);
      setTasks(
        todos
          .filter((t) => !t.completed && ((t.plannedFor && t.plannedFor <= today) || (t.dueDate && t.dueDate <= today)))
          .slice(0, 3)
          .map((t) => t.title),
      );
    })();
  }, [domain, reason]);

  useEffect(() => {
    if (wait === null || wait <= 0) return;
    const id = setTimeout(() => setWait((w) => (w === null ? null : w - 1)), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const openAnyway = async () => {
    try {
      const r = await chrome.storage.session.get(FOCUS_PASSES_KEY);
      const passes = { ...((r[FOCUS_PASSES_KEY] as Record<string, number> | undefined) ?? {}), [domain]: Date.now() + PASS_MINUTES * 60_000 };
      await chrome.storage.session.set({ [FOCUS_PASSES_KEY]: passes });
    } catch {
      // without session storage the site would be paused again; still try
    }
    location.replace(url);
  };

  return (
    <main data-testid="pause-page" style={{ minHeight: "100vh", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "Space Grotesk, Inter, sans-serif" }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 56 }} aria-hidden="true">🧘</div>
        <h1 style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.02em", margin: "8px 0 6px" }}>Pause. Is {domain} worth it now?</h1>
        <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>{why}</p>
        {count > 1 && <p style={{ fontSize: 14, margin: "0 0 4px" }}>You've paused {count} times today. Nice.</p>}
        {tasks.length > 0 && (
          <div style={{ margin: "18px auto 0", textAlign: "left", maxWidth: 420, border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Planned for today</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, fontWeight: 600, lineHeight: 1.6, listStyle: "disc" }}>
              {tasks.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 26 }}>
          <button autoFocus style={btn(true)} onClick={() => void closeThisTab()}>✕ Close tab</button>
          <button style={btn(false)} onClick={() => location.replace(chrome.runtime.getURL("index.html"))}>Go to ProdLi</button>
        </div>
        <div style={{ marginTop: 22, fontSize: 13 }}>
          {wait === null ? (
            <button onClick={() => setWait(WAIT_SECONDS)} style={{ border: "none", background: "none", color: "hsl(var(--muted-foreground))", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
              Continue anyway
            </button>
          ) : wait > 0 ? (
            <span role="status" aria-live="polite" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>Take a breath… {wait}</span>
          ) : (
            <button onClick={() => void openAnyway()} style={btn(false)}>Open {domain} for {PASS_MINUTES} minutes</button>
          )}
        </div>
      </div>
    </main>
  );
}
