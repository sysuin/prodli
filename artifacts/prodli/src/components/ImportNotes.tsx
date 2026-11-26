// Import notes from other apps: pick the app → choose the export → preview →
// import, with Undo in the toast. Reading: lib/noteImporters/*; saving and
// Undo: lib/noteImporters/apply.ts. Files are read on this device.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NOTE_APP_FILES, NOTE_APP_NAMES, readNoteFiles, summarizeNotes, type NoteApp, type ParsedNotes } from "../lib/noteImporters";
import { applyNotesImport, type NotesImportOutcome } from "../lib/noteImporters/apply";
import { imageFileToDataUrl } from "../lib/noteImages";
import { storageGet } from "../lib/storage";
import type { Note } from "../types";

const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "8px 14px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
});
const chip: CSSProperties = { border: "1px solid var(--nb-section-border)", padding: "0 5px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };

const APPS: { id: NoteApp; icon: string; sub: string }[] = [
  { id: "notion", icon: "⬛", sub: "Markdown & CSV export .zip" },
  { id: "evernote", icon: "🐘", sub: ".enex files" },
  { id: "keep", icon: "💡", sub: "Takeout .zip" },
  { id: "markdown", icon: "📝", sub: "Obsidian, Bear, .md folders" },
];

type Step = { kind: "pick" } | { kind: "file"; app: NoteApp; error?: string; reading?: boolean } | { kind: "preview"; app: NoteApp; parsed: ParsedNotes; fileName: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ImportNotesModal({ onClose, onDone }: { onClose: () => void; onDone: (outcome: NotesImportOutcome) => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [existing, setExisting] = useState<Note[]>([]);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void storageGet<Note[]>("notes", []).then(setExisting);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const readFiles = async (app: NoteApp, files: File[]) => {
    setStep({ kind: "file", app, reading: true });
    try {
      const picked = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const parsed = await readNoteFiles(app, picked);
      setStep({ kind: "preview", app, parsed, fileName: files.length === 1 ? files[0].name : plural(files.length, "file") });
    } catch (err) {
      setStep({ kind: "file", app, error: err instanceof Error ? err.message : "Couldn't read these files." });
    }
  };

  const doImport = async () => {
    if (step.kind !== "preview") return;
    setSaving(true);
    try {
      const out = await applyNotesImport(step.parsed, {
        includeArchived,
        toDataUrl: (img) => imageFileToDataUrl(new Blob([img.bytes as BlobPart], { type: img.mime })),
      });
      onDone(out);
      onClose();
    } catch {
      setSaving(false);
      setStep({ kind: "file", app: step.app, error: "Couldn't save the notes. Try again." });
    }
  };

  let body: React.ReactNode = null;
  if (step.kind === "pick") {
    body = (
      <>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Where are your notes now?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {APPS.map((a) => (
            <button key={a.id} data-testid={`import-notes-app-${a.id}`} onClick={() => setStep({ kind: "file", app: a.id })} style={{ ...btn(), textTransform: "none", textAlign: "left", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 900 }}>
                <span aria-hidden>{a.icon}</span> {NOTE_APP_NAMES[a.id]}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>{a.sub}</span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (step.kind === "file") {
    const { app } = step;
    body = (
      <>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>{NOTE_APP_NAMES[app]}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>{NOTE_APP_FILES[app].hint}</div>
        <div
          data-testid="import-notes-drop"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) void readFiles(app, files);
          }}
          style={{ border: "3px dashed var(--nb-section-border)", background: dragging ? "#FFF3B0" : "hsl(var(--muted))", color: dragging ? "#000" : "inherit", padding: "22px 12px", textAlign: "center", fontSize: 13, fontWeight: 700 }}
        >
          {step.reading ? (
            <span role="status">Reading…</span>
          ) : (
            <>
              Drop the export here, or{" "}
              <button onClick={() => fileRef.current?.click()} style={{ ...btn(true), marginLeft: 4 }}>
                Choose files
              </button>
            </>
          )}
          <input
            ref={fileRef}
            data-testid="import-notes-file"
            type="file"
            multiple
            accept={NOTE_APP_FILES[app].accept}
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void readFiles(app, files);
            }}
          />
        </div>
        {step.error && (
          <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", marginTop: 8 }}>
            {step.error}
          </div>
        )}
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>The files are read on this device; they aren't uploaded.</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <button style={btn()} onClick={() => setStep({ kind: "pick" })}>
            Back
          </button>
          <button style={btn()} onClick={onClose}>
            Cancel
          </button>
        </div>
      </>
    );
  } else {
    const { parsed } = step;
    const s = summarizeNotes(parsed, existing, includeArchived);
    const shown = parsed.notes.filter((n) => includeArchived || !n.archived);
    const lines = [
      ...(s.pictures ? [`${plural(s.pictures, "picture")} will be made smaller to fit in the notes.`] : []),
      ...(s.duplicates ? [`${plural(s.duplicates, "note was", "notes were")} imported before and will be skipped.`] : []),
      ...(s.tooLarge.length ? [`Too large to import (over 1 MB of text): ${s.tooLarge.slice(0, 3).join(", ")}${s.tooLarge.length > 3 ? "…" : ""}.`] : []),
      ...parsed.info,
    ];
    body = (
      <>
        <div data-testid="import-notes-summary" style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
          {plural(s.total, "note")}
          {s.archived ? `, ${s.archived} archived` : ""}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>From {step.fileName}</div>
        {s.archived > 0 && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" data-testid="import-notes-archived" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Import archived notes too ({s.archived})
          </label>
        )}
        <ul data-testid="import-notes-sample" style={{ listStyle: "none", margin: 0, padding: 0, border: "var(--nb-border)", maxHeight: 220, overflowY: "auto" }}>
          {shown.slice(0, 100).map((n) => {
            const pics = (n.html.match(/data-import-src=/g) ?? []).length;
            const words = n.html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
            return (
              <li key={n.key} style={{ padding: "6px 8px", borderBottom: "1px solid var(--nb-section-border)", fontSize: 13 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.icon ? `${n.icon} ` : ""}
                  {n.title}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  <span style={chip}>{plural(words, "word")}</span>
                  {n.pinned && <span style={chip}>📌 Pinned</span>}
                  {n.archived && <span style={chip}>Archived</span>}
                  {pics > 0 && <span style={chip}>🖼 {pics}</span>}
                  {n.html.includes("data-import-note=") && <span style={chip}>↗ Links</span>}
                  {n.html.includes('data-type="taskList"') && <span style={chip}>☑ Checklist</span>}
                  {n.html.includes("<table") && <span style={chip}>▦ Table</span>}
                </div>
              </li>
            );
          })}
          {shown.length > 100 && <li style={{ padding: "6px 8px", fontSize: 12, opacity: 0.7 }}>…and {shown.length - 100} more</li>}
        </ul>
        {lines.length > 0 && (
          <ul style={{ fontSize: 12, margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
            {lines.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {parsed.dropped.length > 0 && (
          <div data-testid="import-notes-dropped" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5, opacity: 0.85 }}>
            <strong>Won't carry over:</strong> {parsed.dropped.join(" · ")}.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <button style={btn()} onClick={() => setStep({ kind: "file", app: step.app })} disabled={saving}>
            Back
          </button>
          <button data-testid="import-notes-confirm" style={btn(true, saving || s.toAdd === 0)} disabled={saving || s.toAdd === 0} onClick={() => void doImport()}>
            {saving ? "Importing…" : s.toAdd === 0 ? "Nothing new to import" : `Import ${plural(s.toAdd, "note")}`}
          </button>
        </div>
      </>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Import notes from other apps" onClick={() => !saving && onClose()} style={{ position: "fixed", inset: 0, zIndex: 2150, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px" }}>
      <div data-testid="import-notes" onClick={(e) => e.stopPropagation()} style={{ width: "min(600px, 100%)", maxHeight: "84vh", overflowY: "auto", boxSizing: "border-box", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>⇩ Import notes</div>
          <button onClick={onClose} disabled={saving} aria-label="Close" title="Close (Esc)" style={{ border: "none", background: "transparent", color: "inherit", fontSize: 20, fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
