// "🗂 Saved tabs" on Today: save this window's tabs (optionally closing them)
// and reopen them later. Logic: lib/tabSessions.ts.

import { useState, type CSSProperties } from "react";
import { useSyncedList } from "../../lib/syncedList";
import { captureWindow, defaultSessionName, isExtension, openSession, openTab, siteName } from "../../lib/tabSessions";
import type { TabSession } from "../../types";

const btn = (primary = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: "var(--nb-shadow-sm)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "4px 10px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const icon: CSSProperties = { border: "none", background: "none", cursor: "pointer", fontWeight: 900, fontSize: 13, padding: "0 4px", color: "hsl(var(--foreground))", fontFamily: "inherit" };

export function TabSessions() {
  const { items: sessions, setItems: save } = useSyncedList<TabSession>("tabSessions");
  const [closeAfter, setCloseAfter] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const ext = isExtension();

  const saveWindow = async () => {
    try {
      const r = await captureWindow(defaultSessionName(), closeAfter);
      if (!r) return setStatus("No web pages open in this window to save.");
      save([r.session, ...sessions]);
      setStatus(`Saved ${r.session.tabs.length} tab${r.session.tabs.length > 1 ? "s" : ""}${r.closed ? ` and closed ${r.closed}` : ""}.`);
    } catch {
      setStatus("Couldn't save the tabs. Try again.");
    }
  };
  const update = (id: string, patch: Partial<TabSession>) => save(sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const rename = (s: TabSession) => {
    const name = window.prompt("Rename saved tabs:", s.name)?.trim();
    if (name) update(s.id, { name: name.slice(0, 80) });
  };
  const remove = (s: TabSession) => {
    if (window.confirm(`Delete “${s.name}” (${s.tabs.length} tabs)?`)) save(sessions.filter((x) => x.id !== s.id));
  };
  const removeTab = (s: TabSession, url: string) => {
    const tabs = s.tabs.filter((t) => t.url !== url);
    if (tabs.length) update(s.id, { tabs });
    else save(sessions.filter((x) => x.id !== s.id));
  };

  return (
    <div data-testid="tab-sessions" style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {ext && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn(true)} onClick={() => void saveWindow()}>Save this window</button>
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, fontWeight: 600 }}>
            <input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} /> and close them
          </label>
        </div>
      )}
      {status && <div role="status" style={{ fontSize: 12, fontWeight: 700 }}>{status}</div>}
      {sessions.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.75 }}>{ext ? "Clear your tab bar now, pick up where you left off later." : "Tabs you save in the ProdLi extension show up here."}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {sessions.map((s) => {
            const expanded = open === s.id;
            return (
              <li key={s.id} data-testid="tab-session" style={{ border: "1px solid var(--nb-section-border)", padding: "6px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded} style={{ ...icon, flex: 1, textAlign: "left", fontWeight: 800, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {expanded ? "▾" : "▸"} {s.name} <span style={{ fontWeight: 600, opacity: 0.7 }}>· {s.tabs.length} tab{s.tabs.length > 1 ? "s" : ""}</span>
                  </button>
                  <button style={btn()} onClick={() => void openSession(s)} aria-label={`Open all tabs: ${s.name}`}>Open all</button>
                  <button style={icon} onClick={() => rename(s)} aria-label={`Rename ${s.name}`} title="Rename">✎</button>
                  <button style={{ ...icon, color: "var(--danger-text)" }} onClick={() => remove(s)} aria-label={`Delete ${s.name}`} title="Delete">×</button>
                </div>
                {expanded && (
                  <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 2 }}>
                    {s.tabs.map((t) => (
                      <li key={t.url} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => void openTab(t.url)} title={t.url} style={{ ...icon, flex: 1, textAlign: "left", fontWeight: 600, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "1px 0" }}>
                          <span style={{ fontWeight: 800, opacity: 0.7 }}>{siteName(t.url)}</span> {t.title}
                        </button>
                        <button style={{ ...icon, fontSize: 12, color: "var(--danger-text)" }} onClick={() => removeTab(s, t.url)} aria-label={`Remove ${t.title} from ${s.name}`}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
