// Import from other apps: pick the app → choose the file → (CSV: pick the
// columns) → preview → import, with Undo in the toast. Parsing:
// lib/importers/*; saving and Undo: lib/importers/apply.ts.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { APP_FILES, APP_NAMES, readImportFile, summarize, type ImportApp, type ParsedImport } from "../lib/importers";
import { CSV_FIELD_LABELS, CSV_FIELDS, guessMapping, parseGenericRows, type CsvMapping, type CsvTable } from "../lib/importers/genericCsv";
import { applyImport, type ImportOutcome } from "../lib/importers/apply";
import { repeatLabel, timeLabel } from "../lib/recurrence";
import { storageGet } from "../lib/storage";
import { VOICE_TASKS_EVENT } from "../lib/voiceTasks";
import type { Todo } from "../types";

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

const APPS: { id: ImportApp; icon: string; sub: string }[] = [
  { id: "todoist", icon: "🔴", sub: "CSV or backup .zip" },
  { id: "ticktick", icon: "✔️", sub: "Backup CSV" },
  { id: "google", icon: "🟦", sub: "Takeout Tasks.json" },
  { id: "csv", icon: "📊", sub: "Any spreadsheet" },
  { id: "markdown", icon: "📝", sub: "Checklists, .md or .txt" },
];

type Step =
  | { kind: "pick" }
  | { kind: "file"; app: ImportApp; error?: string; reading?: boolean }
  | { kind: "map"; app: ImportApp; table: CsvTable; mapping: CsvMapping; fileName: string }
  | { kind: "preview"; app: ImportApp; parsed: ParsedImport; fileName: string; back: Step };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

export function ImportTasksModal({ onClose, onDone }: { onClose: () => void; onDone: (outcome: ImportOutcome) => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [existing, setExisting] = useState<Todo[]>([]);
  const [includeDone, setIncludeDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void storageGet<Todo[]>("todos", []).then(setExisting);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const readFile = async (app: ImportApp, file: File) => {
    setStep({ kind: "file", app, reading: true });
    try {
      const r = await readImportFile(app, file.name, new Uint8Array(await file.arrayBuffer()));
      if (r.kind === "table") setStep({ kind: "map", app, table: r.table, mapping: guessMapping(r.table.headers), fileName: file.name });
      else if (!r.parsed.tasks.length) setStep({ kind: "file", app, error: "No tasks found in this file." });
      else setStep({ kind: "preview", app, parsed: r.parsed, fileName: file.name, back: { kind: "file", app } });
    } catch (err) {
      setStep({ kind: "file", app, error: err instanceof Error ? err.message : "Couldn't read this file." });
    }
  };

  const doImport = async () => {
    if (step.kind !== "preview") return;
    setSaving(true);
    try {
      const out = await applyImport(step.parsed, includeDone);
      onDone(out);
      onClose();
    } catch {
      setSaving(false);
      setStep({ kind: "file", app: step.app, error: "Couldn't save the tasks. Try again." });
    }
  };

  const field: CSSProperties = { border: "var(--nb-border)", padding: "4px 6px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };

  let body: React.ReactNode = null;
  if (step.kind === "pick") {
    body = (
      <>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Where are your to-dos now?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {APPS.map((a) => (
            <button key={a.id} data-testid={`import-app-${a.id}`} onClick={() => setStep({ kind: "file", app: a.id })} style={{ ...btn(), textTransform: "none", textAlign: "left", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 900 }}>
                <span aria-hidden>{a.icon}</span> {APP_NAMES[a.id]}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>{a.sub}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 12 }}>
          Have a list you can copy (Apple Reminders, Things, notes)?{" "}
          <button
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent(VOICE_TASKS_EVENT));
            }}
            style={{ border: "none", background: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 700 }}
          >
            Paste it into 🎙 Speak tasks
          </button>
          .
        </div>
      </>
    );
  } else if (step.kind === "file") {
    const { app } = step;
    body = (
      <>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>{APP_NAMES[app]}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>{APP_FILES[app].hint}</div>
        <div
          data-testid="import-drop"
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
            const f = e.dataTransfer.files?.[0];
            if (f) void readFile(app, f);
          }}
          style={{ border: "3px dashed var(--nb-section-border)", background: dragging ? "#FFF3B0" : "hsl(var(--muted))", color: dragging ? "#000" : "inherit", padding: "22px 12px", textAlign: "center", fontSize: 13, fontWeight: 700 }}
        >
          {step.reading ? (
            <span role="status">Reading…</span>
          ) : (
            <>
              Drop the file here, or{" "}
              <button onClick={() => fileRef.current?.click()} style={{ ...btn(true), marginLeft: 4 }}>
                Choose file
              </button>
            </>
          )}
          <input
            ref={fileRef}
            data-testid="import-file"
            type="file"
            accept={APP_FILES[app].accept}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readFile(app, f);
            }}
          />
        </div>
        {step.error && (
          <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", marginTop: 8 }}>
            {step.error}
          </div>
        )}
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>The file is read on this device; it isn't uploaded.</div>
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
  } else if (step.kind === "map") {
    const { table, mapping } = step;
    const setField = (f: keyof CsvMapping, v: number) => setStep({ ...step, mapping: { ...mapping, [f]: v } });
    const sample = table.rows.slice(0, 3);
    body = (
      <>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Which column is which?</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
          {step.fileName} · {plural(table.rows.length, "row")}. Only the title is needed.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", alignItems: "center" }}>
          {CSV_FIELDS.map((f) => (
            <label key={f} style={{ display: "contents" }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>
                {CSV_FIELD_LABELS[f]}
                {f === "title" ? " *" : ""}
              </span>
              <select data-testid={`import-map-${f}`} value={mapping[f]} onChange={(e) => setField(f, +e.target.value)} style={field}>
                {f !== "title" && <option value={-1}>— not used —</option>}
                {table.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                    {sample[0]?.[i] ? ` (e.g. ${sample[0][i].slice(0, 30)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <button style={btn()} onClick={() => setStep({ kind: "file", app: step.app })}>
            Back
          </button>
          <button
            style={btn(true, mapping.title < 0)}
            disabled={mapping.title < 0}
            onClick={() => {
              const parsed = parseGenericRows(table, mapping);
              if (!parsed.tasks.length) return setStep({ kind: "file", app: step.app, error: "No rows had a title in that column." });
              setStep({ kind: "preview", app: step.app, parsed, fileName: step.fileName, back: step });
            }}
          >
            Preview
          </button>
        </div>
      </>
    );
  } else {
    const { parsed } = step;
    const s = summarize(parsed, existing, includeDone);
    const shown = parsed.tasks.filter((t) => includeDone || !t.completed);
    const listCount = s.lists.length + (parsed.tasks.some((t) => !t.list || t.list.trim().toLowerCase() === "inbox") ? 1 : 0);
    const headline = [
      `${plural(s.total, "task")} in ${plural(Math.max(1, listCount), "list")}`,
      ...(s.repeating ? [`${s.repeating} repeating`] : []),
      ...(s.done ? [`${s.done} done`] : []),
    ].join(", ");
    const notes = [
      ...(s.repeatNotes ? [`${plural(s.repeatNotes, "repeat rule")} ProdLi can't match: kept as a note on the task.`] : []),
      ...(s.dateNotes ? [`${plural(s.dateNotes, "date")} couldn't be read: kept as a note on the task.`] : []),
      ...(s.duplicates ? [`${plural(s.duplicates, "task was", "tasks were")} imported before and will be skipped.`] : []),
      ...parsed.info,
    ];
    body = (
      <>
        <div data-testid="import-summary" style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
          {headline}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          From {step.fileName}
          {s.lists.length ? ` · Lists: ${s.lists.slice(0, 6).join(", ")}${s.lists.length > 6 ? "…" : ""}` : ""}
        </div>
        {s.done > 0 && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" data-testid="import-include-done" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
            Import done tasks too ({s.done})
          </label>
        )}
        <ul data-testid="import-sample" style={{ listStyle: "none", margin: 0, padding: 0, border: "var(--nb-border)", maxHeight: 220, overflowY: "auto" }}>
          {shown.slice(0, 100).map((t, i) => (
            <li key={i} style={{ padding: "6px 8px", borderBottom: "1px solid var(--nb-section-border)", fontSize: 13 }}>
              <div style={{ fontWeight: 700, textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.6 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                {t.list && t.list.toLowerCase() !== "inbox" && <span style={chip}>📁 {t.list}</span>}
                {t.dueDate && (
                  <span style={chip}>
                    📅 {t.dueDate}
                    {t.dueTime ? ` ${timeLabel(t.dueTime)}` : ""}
                  </span>
                )}
                {t.repeat && <span style={chip}>🔁 {repeatLabel(t.repeat)}</span>}
                {t.repeatNote && <span style={chip}>🔁 note: {t.repeatNote}</span>}
                {t.priority && <span style={chip}>{PRIORITY_LABEL[t.priority]}</span>}
                {t.labels?.slice(0, 3).map((l) => (
                  <span key={l} style={chip}>
                    @{l}
                  </span>
                ))}
                {!!t.subtasks?.length && <span style={chip}>{plural(t.subtasks.length, "subtask")}</span>}
              </div>
            </li>
          ))}
          {shown.length > 100 && <li style={{ padding: "6px 8px", fontSize: 12, opacity: 0.7 }}>…and {shown.length - 100} more</li>}
          {shown.length === 0 && <li style={{ padding: "6px 8px", fontSize: 12, opacity: 0.7 }}>Only done tasks in this file. Tick “Import done tasks too”.</li>}
        </ul>
        {notes.length > 0 && (
          <ul style={{ fontSize: 12, margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {parsed.dropped.length > 0 && (
          <div data-testid="import-dropped" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5, opacity: 0.85 }}>
            <strong>Won't carry over:</strong> {parsed.dropped.join(" · ")}.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <button style={btn()} onClick={() => setStep(step.back)} disabled={saving}>
            Back
          </button>
          <button data-testid="import-confirm" style={btn(true, saving || s.toAdd === 0)} disabled={saving || s.toAdd === 0} onClick={() => void doImport()}>
            {saving ? "Importing…" : s.toAdd === 0 ? "Nothing new to import" : `Import ${plural(s.toAdd, "task")}`}
          </button>
        </div>
      </>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Import from other apps" onClick={() => !saving && onClose()} style={{ position: "fixed", inset: 0, zIndex: 2150, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px" }}>
      <div data-testid="import-tasks" onClick={(e) => e.stopPropagation()} style={{ width: "min(600px, 100%)", maxHeight: "84vh", overflowY: "auto", boxSizing: "border-box", background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "3px solid #000", boxShadow: "6px 6px 0 #FFD700", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>⇩ Import from other apps</div>
          <button onClick={onClose} disabled={saving} aria-label="Close" title="Close (Esc)" style={{ border: "none", background: "transparent", color: "inherit", fontSize: 20, fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
