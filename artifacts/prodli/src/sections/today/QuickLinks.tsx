// Web search (default engine) and quick link tiles at the top of Today, with
// "Most visited" suggestions from the Time Tracker (pin with +, hide with ×).

import { useEffect, useState, type CSSProperties } from "react";
import { useSyncedList } from "../../lib/syncedList";
import { canSearch, defaultTitle, HIDDEN_SUGGESTIONS_KEY, MAX_LINKS, normalizeUrl, runSearch, suggestedSites, SUGGESTIONS_ON_KEY, tileColor } from "../../lib/quickLinks";
import { generateId, getDayKey } from "../../lib/utils";
import { storageGet, storageSet } from "../../lib/storage";
import { DomainSet } from "../../lib/domainSet";
import { loadRangeData } from "../tracker/data";
import type { QuickLink, TrackerSettings } from "../../types";

/** Sites you spent the most time on in the last two weeks (Time Tracker), not yet in your links. */
function useSuggestions(links: QuickLink[]) {
  const [on, setOn] = useState(true);
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [sites, setSites] = useState<{ domain: string; seconds: number }[]>([]);
  useEffect(() => {
    void storageGet<boolean>(SUGGESTIONS_ON_KEY, true).then(setOn);
    void storageGet<string[]>(HIDDEN_SUGGESTIONS_KEY, []).then(setHidden);
  }, []);
  useEffect(() => {
    if (!on || hidden === null) return setSites([]);
    let alive = true;
    const from = new Date();
    from.setDate(from.getDate() - 13);
    void Promise.all([loadRangeData(getDayKey(from), getDayKey()), storageGet<Partial<TrackerSettings>>("tt_settings", {})]).then(([days, settings]) => {
      if (alive) setSites(suggestedSites(days, { links, excluded: new DomainSet(settings.excludedDomains ?? []), hidden, max: Math.min(6, MAX_LINKS - links.length) }));
    });
    return () => {
      alive = false;
    };
  }, [links, hidden, on]);
  return {
    on,
    sites,
    setOn: (v: boolean) => {
      setOn(v);
      void storageSet(SUGGESTIONS_ON_KEY, v);
    },
    hide: (domain: string) => {
      const next = [...(hidden ?? []), domain];
      setHidden(next);
      void storageSet(HIDDEN_SUGGESTIONS_KEY, next.slice(-200));
    },
  };
}

const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "4px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.04em" };
const input: CSSProperties = { border: "var(--nb-border)", padding: "6px 8px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))", minWidth: 0 };

export function QuickLinks() {
  const { items: links, setItems: save } = useSyncedList<QuickLink>("quickLinks");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const suggest = useSuggestions(links);
  const pin = (domain: string) => {
    if (links.length >= MAX_LINKS) return;
    const u = `https://${domain}/`;
    save([...links, { id: generateId(), url: u, title: defaultTitle(u).slice(0, 40), createdAt: new Date().toISOString() }]);
  };

  const add = () => {
    const u = normalizeUrl(url);
    if (!u) return setError("Enter a web address, like github.com");
    if (links.length >= MAX_LINKS) return setError(`Up to ${MAX_LINKS} links.`);
    save([...links, { id: generateId(), url: u, title: (title.trim() || defaultTitle(u)).slice(0, 40), createdAt: new Date().toISOString() }]);
    setUrl("");
    setTitle("");
    setError("");
    setAdding(false);
  };
  const rename = (l: QuickLink) => {
    const t = window.prompt("Link name:", l.title)?.trim();
    if (t) save(links.map((x) => (x.id === l.id ? { ...x, title: t.slice(0, 40) } : x)));
  };

  return (
    <section data-testid="quick-links" aria-label="Search and quick links" style={{ display: "grid", gap: 10 }}>
      {canSearch() && (
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the web or type an address"
            aria-label="Search the web"
            style={{ ...input, flex: 1, padding: "10px 12px", fontSize: 15, boxShadow: "var(--nb-shadow-sm)" }}
          />
          <button type="submit" style={{ ...small, background: "#FFD700", color: "#000", padding: "0 16px", fontSize: 12 }}>Search</button>
        </form>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {links.map((l) => (
          <span key={l.id} style={{ position: "relative", display: "inline-flex" }}>
            <a
              href={l.url}
              data-testid="quick-link"
              title={l.url}
              onClick={(e) => {
                if (editing) {
                  e.preventDefault();
                  rename(l);
                }
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "5px 10px 5px 5px", fontSize: 13, fontWeight: 700, textDecoration: "none", maxWidth: 170 }}
            >
              <span aria-hidden="true" style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tileColor(l.title), color: "#000", fontWeight: 900, fontSize: 12, border: "2px solid #000", flexShrink: 0 }}>
                {l.title.charAt(0).toUpperCase()}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
            </a>
            {editing && (
              <button
                aria-label={`Remove link ${l.title}`}
                onClick={() => save(links.filter((x) => x.id !== l.id))}
                style={{ position: "absolute", top: -8, right: -8, width: 20, height: 20, border: "2px solid #000", background: "#C62828", color: "#fff", fontWeight: 900, fontSize: 11, cursor: "pointer", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!adding && links.length < MAX_LINKS && (
          <button onClick={() => setAdding(true)} style={small}>+ Link</button>
        )}
        {links.length > 0 && !adding && (
          <button onClick={() => setEditing((v) => !v)} aria-pressed={editing} style={{ ...small, background: editing ? "hsl(var(--foreground))" : "hsl(var(--card))", color: editing ? "hsl(var(--background))" : "hsl(var(--foreground))" }}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {editing && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Click a link to rename it, × to remove it.</div>}
      {suggest.on && suggest.sites.length > 0 && !adding && (
        <div data-testid="link-suggestions" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "hsl(var(--muted-foreground))" }}>Most visited</span>
          {suggest.sites.map((s) => (
            <span key={s.domain} data-testid="link-suggestion" style={{ display: "inline-flex", alignItems: "center", border: "2px dashed hsl(var(--foreground) / 0.45)", background: "hsl(var(--card))", fontSize: 12, fontWeight: 700, maxWidth: 220 }}>
              <a href={`https://${s.domain}/`} title={`Open ${s.domain} (${Math.round(s.seconds / 60)} min in the last 2 weeks)`} style={{ color: "hsl(var(--foreground))", textDecoration: "none", padding: "3px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.domain}
              </a>
              <button aria-label={`Add ${s.domain} to your links`} title="Add to your links" onClick={() => pin(s.domain)} disabled={links.length >= MAX_LINKS} style={{ border: "none", borderLeft: "2px dashed hsl(var(--foreground) / 0.45)", background: "#FFD700", color: "#000", fontWeight: 900, cursor: "pointer", padding: "3px 7px", fontFamily: "inherit" }}>
                +
              </button>
              <button aria-label={`Don't suggest ${s.domain}`} title="Don't suggest this site" onClick={() => suggest.hide(s.domain)} style={{ border: "none", background: "none", color: "hsl(var(--foreground))", cursor: "pointer", padding: "3px 6px", fontFamily: "inherit", fontWeight: 800 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {editing && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input type="checkbox" checked={suggest.on} onChange={(e) => suggest.setOn(e.target.checked)} data-testid="link-suggestions-toggle" />
          Suggest my most visited sites (from the Time Tracker)
        </label>
      )}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
        >
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Address, e.g. github.com" aria-label="Link address" style={{ ...input, flex: "2 1 200px" }} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name (optional)" aria-label="Link name" style={{ ...input, flex: "1 1 120px" }} />
          <button type="submit" style={{ ...small, background: "#FFD700", color: "#000" }}>Add</button>
          <button type="button" onClick={() => (setAdding(false), setError(""))} style={small}>Cancel</button>
          {error && <span role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", flexBasis: "100%" }}>{error}</span>}
        </form>
      )}
    </section>
  );
}
