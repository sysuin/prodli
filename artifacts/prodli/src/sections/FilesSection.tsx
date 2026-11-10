import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { storageGet, storageSet } from "../lib/storage";
import { generateId } from "../lib/utils";
import { FILE_ORIGINS, FILE_PERMISSIONS, localFileAccess, OPEN_LOCAL_FILES_KEY, type LocalFileAccess } from "../lib/localFiles";
import type { Note } from "../types";
import { addRecent, clearRecent, listRecent, MAX_RECENT, removeRecent, type RecentFile } from "../lib/recentFiles";
import {
  ACCEPT_ATTR,
  detectDelimiter,
  fileToNoteHtml,
  formatBytes,
  markdownToSafeHtml,
  MAX_NOTE_BYTES,
  parseDelimited,
  parseJson,
  parseJsonLines,
  PreviewError,
  readPreviewFile,
  type OpenedFile,
} from "../lib/filePreview";

const ACCENT = "#FF9800";
const MAX_TABLE_ROWS = 2000;
const MAX_ARRAY_ITEMS = 200;
const LINE_NUMBER_LIMIT = 50_000;

// ── UI helpers ────────────────────────────────────────────────────────────────

function btn(active = false, disabled = false): CSSProperties {
  return {
    border: "var(--nb-border)",
    boxShadow: disabled || active ? "none" : "var(--nb-shadow-sm)",
    background: active ? ACCENT : "hsl(var(--card))",
    color: active ? "#000" : "hsl(var(--foreground))",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
}

const card: CSSProperties = { border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))" };
const mono: CSSProperties = { fontFamily: "Space Mono, monospace", fontSize: 13 };

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { key: NoInfer<T>; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((o) => (
        <button key={o.key} style={btn(value === o.key)} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: "var(--nb-border)", background: "#FFCDD2", color: "#000", padding: "10px 14px", fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
      {children}
    </div>
  );
}

// ── Viewers ───────────────────────────────────────────────────────────────────

/** Highlighted HTML for code (highlight.js loads only when a code file is shown). */
function useHighlighted(text: string, language: string | null | undefined): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null);
    if (!language) return;
    let cancelled = false;
    void import("../lib/highlight").then((m) => {
      if (!cancelled) setHtml(m.highlightCode(text, language));
    });
    return () => {
      cancelled = true;
    };
  }, [text, language]);
  return html;
}

function TextView({ text, wrap, language }: { text: string; wrap: boolean; language?: string | null }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const showNumbers = lines.length <= LINE_NUMBER_LIMIT;
  const highlighted = useHighlighted(text, language);
  return (
    <div style={{ ...card, overflow: "auto", display: "flex" }}>
      {showNumbers && (
        <pre aria-hidden style={{ ...mono, margin: 0, padding: "12px 10px", textAlign: "right", opacity: 0.45, userSelect: "none", borderRight: "var(--nb-border)" }}>
          {lines.map((_, i) => i + 1).join("\n")}
        </pre>
      )}
      <pre className="code-preview" data-language={language ?? undefined} style={{ ...mono, margin: 0, padding: 12, whiteSpace: wrap ? "pre-wrap" : "pre", wordBreak: wrap ? "break-word" : "normal", flex: 1 }}>
        {/* highlight.js output is escaped text wrapped in <span class="hljs-…"> */}
        {highlighted ? <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /> : text}
      </pre>
    </div>
  );
}

function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => markdownToSafeHtml(text), [text]);
  return (
    <div style={{ ...card, padding: "20px 28px" }}>
      {/* html is sanitized with DOMPurify in markdownToSafeHtml */}
      <div className="tiptap md-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function CsvView({ text, ext }: { text: string; ext: string }) {
  const [header, setHeader] = useState(true);
  const delimiter = useMemo(() => detectDelimiter(text, ext), [text, ext]);
  const rows = useMemo(() => parseDelimited(text, delimiter).filter((r) => !(r.length === 1 && r[0] === "")), [text, delimiter]);
  const columns = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const head = header ? rows[0] ?? [] : null;
  const body = header ? rows.slice(1) : rows;
  const shown = body.slice(0, MAX_TABLE_ROWS);
  const delimiterName = delimiter === "\t" ? "tab" : delimiter === "," ? "comma" : delimiter === ";" ? "semicolon" : "pipe";
  const cell: CSSProperties = { border: "1px solid var(--nb-section-border)", padding: "4px 8px", whiteSpace: "pre-wrap", verticalAlign: "top", fontSize: 13 };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={header} onChange={() => setHeader((h) => !h)} /> First row is a header
        </label>
        <span style={{ opacity: 0.7 }}>
          {body.length.toLocaleString()} rows · {columns} columns · {delimiterName}-separated
        </span>
      </div>
      <div style={{ ...card, overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          {head && (
            <thead>
              <tr>
                <th style={{ ...cell, position: "sticky", top: 0, background: ACCENT, color: "#000", width: "1%" }}>#</th>
                {Array.from({ length: columns }, (_, i) => (
                  <th key={i} style={{ ...cell, position: "sticky", top: 0, background: ACCENT, color: "#000", textAlign: "left", fontWeight: 800 }}>
                    {head[i] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {shown.map((r, ri) => (
              <tr key={ri}>
                <td style={{ ...cell, opacity: 0.5, ...mono, fontSize: 11, width: "1%", textAlign: "right" }}>{ri + 1}</td>
                {Array.from({ length: columns }, (_, ci) => (
                  <td key={ci} style={cell}>
                    {r[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > MAX_TABLE_ROWS && (
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8, opacity: 0.7 }}>
          Showing the first {MAX_TABLE_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows. Switch to Source to see everything.
        </div>
      )}
    </div>
  );
}

// JSON tree ------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Paths (and their ancestors) whose key or value matches the search. */
function findMatches(value: Json, query: string): Set<string> {
  const q = query.toLowerCase();
  const hits = new Set<string>();
  const walk = (v: Json, path: string, key: string): boolean => {
    let matched = key.toLowerCase().includes(q);
    if (v !== null && typeof v === "object") {
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
      for (const [k, child] of entries) if (walk(child, `${path}/${k}`, Array.isArray(v) ? "" : k)) matched = true;
    } else if (String(v).toLowerCase().includes(q)) {
      matched = true;
    }
    if (matched) hits.add(path);
    return matched;
  };
  walk(value, "$", "");
  return hits;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: "#FFD700", color: "#000" }}>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function JsonValue({ value, query }: { value: Json; query: string }) {
  if (value === null) return <span style={{ color: "#8B5CF6" }}>null</span>;
  if (typeof value === "string") return <span style={{ color: "#2E7D32" }}>"<Highlight text={value} query={query} />"</span>;
  if (typeof value === "number") return <span style={{ color: "#1565C0" }}><Highlight text={String(value)} query={query} /></span>;
  return <span style={{ color: "#C62828" }}>{String(value)}</span>;
}

function JsonNode({ name, value, path, depth, query, matches }: { name: string | null; value: Json; path: string; depth: number; query: string; matches: Set<string> | null }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(MAX_ARRAY_ITEMS);
  if (matches && !matches.has(path)) return null;
  const expanded = matches ? true : open;
  const label =
    name === null ? null : (
      <span style={{ fontWeight: 700 }}>
        <Highlight text={name} query={query} />
        <span style={{ opacity: 0.5 }}>: </span>
      </span>
    );

  if (!isObj) {
    return (
      <div style={{ paddingLeft: 18 }}>
        {label}
        <JsonValue value={value} query={query} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, Json][] = isArray ? (value as Json[]).map((v, i) => [String(i), v]) : Object.entries(value as Record<string, Json>);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  const visible = entries.slice(0, limit);

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 18 }}>
      <button
        onClick={() => setOpen(!expanded)}
        style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, font: "inherit" }}
        aria-expanded={expanded}
      >
        <span style={{ display: "inline-block", width: 14, opacity: 0.6 }}>{expanded ? "▾" : "▸"}</span>
        {label}
        <span style={{ opacity: 0.55 }}>{summary}</span>
      </button>
      {expanded && (
        <div style={{ borderLeft: "1px dashed var(--nb-section-border)", marginLeft: 6 }}>
          {visible.map(([k, v]) => (
            <JsonNode key={k} name={isArray ? `[${k}]` : k} value={v} path={`${path}/${k}`} depth={depth + 1} query={query} matches={matches} />
          ))}
          {entries.length > limit && !matches && (
            <button style={{ ...btn(), margin: "4px 0 4px 18px" }} onClick={() => setLimit((l) => l + MAX_ARRAY_ITEMS)}>
              Show {Math.min(MAX_ARRAY_ITEMS, entries.length - limit)} more of {entries.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JsonView({ text, lines }: { text: string; lines: boolean }) {
  const [mode, setMode] = useState<"tree" | "pretty" | "raw">("tree");
  const [query, setQuery] = useState("");
  const parsed = useMemo(() => (lines ? parseJsonLines(text) : parseJson(text)), [text, lines]);
  const pretty = useMemo(() => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : ""), [parsed]);
  const matches = useMemo(() => (parsed.ok && query.trim() ? findMatches(parsed.value as Json, query.trim()) : null), [parsed, query]);

  if (!parsed.ok) {
    return (
      <div>
        <ErrorBox>
          This isn't valid JSON{parsed.line ? ` — problem near line ${parsed.line}${parsed.column ? `, column ${parsed.column}` : ""}` : ""}. <span style={{ opacity: 0.8 }}>({parsed.error})</span>
        </ErrorBox>
        <TextView text={text} wrap={false} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <Tabs<"tree" | "pretty" | "raw">
          value={mode}
          onChange={setMode}
          options={[
            { key: "tree", label: "Tree" },
            { key: "pretty", label: "Formatted" },
            { key: "raw", label: "Raw" },
          ]}
        />
        {mode === "tree" && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keys and values…"
            style={{ border: "var(--nb-border)", padding: "6px 10px", fontFamily: "inherit", fontSize: 13, minWidth: 240, background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
          />
        )}
        {matches && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>{matches.size === 0 ? "No matches" : "Showing matches"}</span>}
      </div>
      {mode === "tree" && (
        <div style={{ ...card, ...mono, padding: 12, overflow: "auto", lineHeight: 1.6 }}>
          {matches && matches.size === 0 ? <div style={{ opacity: 0.6 }}>Nothing matches “{query}”.</div> : <JsonNode name={null} value={parsed.value as Json} path="$" depth={0} query={query.trim()} matches={matches} />}
        </div>
      )}
      {mode === "pretty" && <TextView text={pretty} wrap={false} language="json" />}
      {mode === "raw" && <TextView text={text} wrap />}
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

const KIND_LABEL: Record<OpenedFile["kind"], string> = {
  markdown: "Markdown",
  json: "JSON",
  jsonl: "JSON Lines",
  csv: "Table",
  text: "Text",
};

/**
 * Extension only: set up "open local files in ProdLi" (needs a permission and
 * Chrome's "Allow access to file URLs" switch for ProdLi).
 */
function OpenAnywhereCard() {
  const [access, setAccess] = useState<LocalFileAccess | null>(null);
  const [enabled, setEnabled] = useState(true);
  const refresh = () => void localFileAccess().then(setAccess);
  useEffect(() => {
    refresh();
    void storageGet<boolean>(OPEN_LOCAL_FILES_KEY, true).then(setEnabled);
    window.addEventListener("focus", refresh); // back from chrome://extensions
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (!access) return null;
  const on = access.permission && access.fileUrls && enabled;
  const turnOn = async () => {
    await storageSet(OPEN_LOCAL_FILES_KEY, true);
    setEnabled(true);
    if (!access.permission) await chrome.permissions.request({ origins: FILE_ORIGINS, permissions: FILE_PERMISSIONS });
    refresh();
  };
  return (
    <div data-testid="open-anywhere" style={{ ...card, marginTop: 20, display: "grid", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
      <strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Open files from anywhere in Chrome</strong>
      {on ? (
        <>
          <span>✓ On. Drop a Markdown, CSV, JSON, text or code file on Chrome’s tab bar (or open it from the address bar) and it opens here.</span>
          <div>
            <button style={{ ...btn(), padding: "4px 10px", fontSize: 11 }} onClick={() => void storageSet(OPEN_LOCAL_FILES_KEY, false).then(() => setEnabled(false))}>Turn off</button>
          </div>
        </>
      ) : !access.permission || !enabled ? (
        <>
          <span>Drop a Markdown, CSV or JSON file on Chrome’s tab bar and ProdLi opens it here, instead of Chrome’s plain-text page. Files stay on your computer.</span>
          <div>
            <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12 }} onClick={() => void turnOn()}>Turn on</button>
          </div>
        </>
      ) : (
        <>
          <span>
            <strong>One more step:</strong> Chrome needs your OK for ProdLi to read local files. On ProdLi’s settings page, switch on <strong>“Allow access to file URLs”</strong>, then come back here.
          </span>
          <div>
            <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12 }} onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
              Open ProdLi’s settings
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const isExtensionPage = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.permissions;

export function FilesSection({ incomingFile, onIncomingHandled, incomingError }: { incomingFile: File | null; onIncomingHandled: () => void; incomingError?: string | null }) {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const refreshRecent = () => listRecent().then(setRecent).catch(() => setRecent([]));
  useEffect(() => {
    void refreshRecent();
  }, []);
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [error, setError] = useState<string | null>(incomingError ?? null);
  useEffect(() => {
    if (incomingError) setError(incomingError);
  }, [incomingError]);
  const [mdMode, setMdMode] = useState<"preview" | "source">("preview");
  const [csvMode, setCsvMode] = useState<"table" | "source">("table");
  const [wrap, setWrap] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const open = async (f: File) => {
    setError(null);
    try {
      const opened = await readPreviewFile(f);
      setFile(opened);
      void addRecent(opened).then(refreshRecent).catch(() => {});
      setMdMode("preview");
      setCsvMode("table");
    } catch (err) {
      setError(err instanceof PreviewError ? err.message : `Couldn't open ${f.name}.`);
    }
  };

  // Files dropped anywhere in ProdLi arrive here from App.
  useEffect(() => {
    if (!incomingFile) return;
    void open(incomingFile);
    onIncomingHandled();
  }, [incomingFile, onIncomingHandled]);

  const saveToNotes = async () => {
    if (!file) return;
    const content = fileToNoteHtml(file);
    if (content.length > MAX_NOTE_BYTES) {
      flash(`Too large for a note (max ${formatBytes(MAX_NOTE_BYTES)})`);
      return;
    }
    const notes = await storageGet<Note[]>("notes", []);
    const now = new Date().toISOString();
    const note: Note = { id: generateId(), title: file.name.replace(/\.[^.]+$/, ""), content, createdAt: now, updatedAt: now };
    await storageSet("notes", [note, ...notes]);
    await storageSet("activeNoteId", note.id);
    flash("Saved to Editor");
  };

  const copy = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.text);
    flash("Copied to clipboard");
  };

  const lineCount = useMemo(() => (file ? file.text.split(/\r?\n/).length : 0), [file]);
  const [language, setLanguage] = useState<string | null>(null);
  useEffect(() => {
    setLanguage(null);
    if (file?.kind !== "text" || !file.ext) return;
    void import("../lib/highlight").then((m) => setLanguage(m.languageForExt(file.ext)));
  }, [file]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))", display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
          Files
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, background: "#000", color: ACCENT, padding: "2px 8px", verticalAlign: "middle" }}>
            Preview .md · .json · .csv · .txt
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {file && (
            <>
              <button style={btn()} onClick={() => void saveToNotes()}>Save to Notes</button>
              <button style={btn()} onClick={() => void copy()}>Copy</button>
              <button style={btn()} onClick={() => { setFile(null); setError(null); }}>Close</button>
            </>
          )}
          <button style={{ ...btn(true), boxShadow: "var(--nb-shadow-sm)" }} onClick={() => inputRef.current?.click()}>
            Open file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {error && <ErrorBox>{error}</ErrorBox>}

        {!file ? (
          <>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              width: "100%",
              border: "3px dashed var(--nb-section-border)",
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
              padding: "56px 24px",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40 }}>📄</div>
            <div style={{ fontWeight: 900, fontSize: 18, marginTop: 8, textTransform: "uppercase" }}>Drop a file anywhere in ProdLi</div>
            <div style={{ fontSize: 14, marginTop: 6, opacity: 0.8 }}>or click to choose one — Markdown, JSON, JSON Lines, CSV/TSV, text, logs and code files up to 10 MB</div>
            <div style={{ fontSize: 12, marginTop: 14, fontWeight: 700, opacity: 0.7 }}>🔒 Files are read on your device and never uploaded.</div>
          </button>
          {isExtensionPage() && <OpenAnywhereCard />}
          {recent.length > 0 && (
            <div style={{ marginTop: 20 }} aria-label="Recent files">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))" }}>Recent files</span>
                <button style={{ ...btn(), padding: "3px 8px", fontSize: 10 }} onClick={() => void clearRecent().then(refreshRecent)}>
                  Clear
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {recent.map((r) => (
                  <div key={r.id} style={{ ...card, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
                    <button
                      onClick={() => {
                        setError(null);
                        setFile(r);
                        void addRecent(r).then(refreshRecent).catch(() => {});
                      }}
                      style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                        {KIND_LABEL[r.kind]} · {formatBytes(r.size)} · opened {new Date(r.openedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </button>
                    <button aria-label={`Remove ${r.name} from recent files`} title="Remove from recent" style={{ ...btn(), padding: "2px 8px" }} onClick={() => void removeRecent(r.id).then(refreshRecent)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 6 }}>The last {MAX_RECENT} files (up to 1 MB each) are kept on this device only.</div>
            </div>
          )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, wordBreak: "break-all" }}>{file.name}</div>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                  {file.kind === "text" && language ? `Code · ${language}` : KIND_LABEL[file.kind]} · {formatBytes(file.size)} · {lineCount.toLocaleString()} lines · modified {new Date(file.lastModified).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              {file.kind === "markdown" && (
                <Tabs<"preview" | "source"> value={mdMode} onChange={setMdMode} options={[{ key: "preview", label: "Preview" }, { key: "source", label: "Source" }]} />
              )}
              {file.kind === "csv" && (
                <Tabs<"table" | "source"> value={csvMode} onChange={setCsvMode} options={[{ key: "table", label: "Table" }, { key: "source", label: "Source" }]} />
              )}
              {file.kind === "text" && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={wrap} onChange={() => setWrap((w) => !w)} /> Wrap long lines
                </label>
              )}
            </div>

            {file.kind === "markdown" && (mdMode === "preview" ? <MarkdownView text={file.text} /> : <TextView text={file.text} wrap language="markdown" />)}
            {(file.kind === "json" || file.kind === "jsonl") && <JsonView key={file.name + file.lastModified} text={file.text} lines={file.kind === "jsonl"} />}
            {file.kind === "csv" && (csvMode === "table" ? <CsvView text={file.text} ext={file.ext} /> : <TextView text={file.text} wrap={false} />)}
            {file.kind === "text" && <TextView text={file.text} wrap={wrap} language={language} />}
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: "absolute", right: 24, bottom: 24, ...card, background: "#000", color: "#FFD700", fontWeight: 800, fontSize: 13, padding: "10px 14px" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
