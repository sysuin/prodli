// "📚 Read later" on Today: pages saved from the right-click menu, Quick add,
// or pasted here. Opening one marks it read.

import { useState, type CSSProperties } from "react";
import { useSyncedList } from "../../lib/syncedList";
import { normalizeUrl } from "../../lib/quickLinks";
import { generateId } from "../../lib/utils";
import { isExtension, siteName } from "../../lib/tabSessions";
import type { ReadLaterItem } from "../../types";

const icon: CSSProperties = { border: "none", background: "none", cursor: "pointer", fontWeight: 900, fontSize: 13, padding: "0 4px", color: "hsl(var(--foreground))", fontFamily: "inherit" };
const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "3px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase" };

export function ReadLater() {
  const { items, setItems: save } = useSyncedList<ReadLaterItem>("readLater");
  const [showRead, setShowRead] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const unread = items.filter((i) => !i.readAt);
  const read = items.filter((i) => i.readAt).sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""));
  const stamp = () => new Date().toISOString();
  const markRead = (id: string, value: boolean) => save(items.map((i) => (i.id === id ? { ...i, readAt: value ? stamp() : undefined } : i)));
  const open = (i: ReadLaterItem) => {
    markRead(i.id, true);
    if (isExtension()) void chrome.tabs.create({ url: i.url, active: true });
    else window.open(i.url, "_blank", "noopener,noreferrer");
  };
  const add = () => {
    const u = normalizeUrl(url);
    if (!u) return setError("Paste a web address");
    if (!items.some((i) => i.url === u && !i.readAt)) save([{ id: generateId(), url: u, title: siteName(u), createdAt: stamp() }, ...items]);
    setUrl("");
    setError("");
  };
  const row = (i: ReadLaterItem) => (
    <li key={i.id} data-testid="read-later-item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button onClick={() => open(i)} title={i.url} style={{ ...icon, flex: 1, minWidth: 0, textAlign: "left", fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: i.readAt ? 0.6 : 1 }}>
        <span style={{ fontWeight: 800, opacity: 0.7, fontSize: 11 }}>{siteName(i.url)}</span> {i.title}
      </button>
      <button style={icon} onClick={() => markRead(i.id, !i.readAt)} aria-label={`${i.readAt ? "Mark unread" : "Mark read"}: ${i.title}`} title={i.readAt ? "Mark unread" : "Mark read"}>{i.readAt ? "↺" : "✓"}</button>
      <button style={{ ...icon, color: "var(--danger-text)" }} onClick={() => save(items.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.title}`} title="Remove">×</button>
    </li>
  );
  return (
    <div data-testid="read-later" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, fontSize: 13 }}>
      {unread.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.75 }}>{isExtension() ? "Right-click any page or link → Read later in ProdLi, or paste a link below." : "Paste a link below to read it later."}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 3 }}>{unread.slice(0, 30).map(row)}</ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link to read later" aria-label="Link to read later" style={{ flex: 1, minWidth: 0, border: "var(--nb-border)", padding: "5px 8px", fontFamily: "inherit", fontSize: 12, background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
        <button type="submit" style={small}>Add</button>
      </form>
      {error && <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>{error}</div>}
      {read.length > 0 && (
        <div>
          <button onClick={() => setShowRead((v) => !v)} aria-expanded={showRead} style={{ ...icon, fontSize: 11, textTransform: "uppercase", padding: 0 }}>
            {showRead ? "▾" : "▸"} Read ({read.length})
          </button>
          {showRead && <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 3 }}>{read.slice(0, 30).map(row)}</ul>}
        </div>
      )}
    </div>
  );
}
