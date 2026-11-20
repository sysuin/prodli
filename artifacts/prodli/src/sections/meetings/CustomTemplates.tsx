// Setup → Meeting notes → "Your meeting templates" (Pro): your own meeting
// types, with what to focus on and your own sections. Summaries for meetings of
// that type fill your sections in (server: ai.ts cleanCustomTemplate).

import { useEffect, useId, useState, type CSSProperties } from "react";
import { onStorageChange, storageGet, storageSet } from "../../lib/storage";
import { generateId } from "../../lib/utils";
import { CUSTOM_TEMPLATES_STORAGE_KEY, type CustomMeetingTemplate } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

export const MAX_INSTRUCTIONS = 1500;
export const MAX_SECTIONS = 8;

const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 12, padding: "5px 6px", width: "100%", boxSizing: "border-box" };
const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "3px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase" };

/** "Budget\nTimeline\n\nBudget" → ["Budget", "Timeline"] */
export function parseSections(text: string): string[] {
  return [...new Set(text.split("\n").map((s) => s.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_SECTIONS);
}

export function useCustomTemplates(): CustomMeetingTemplate[] {
  const [list, setList] = useState<CustomMeetingTemplate[]>([]);
  useEffect(() => {
    void storageGet<CustomMeetingTemplate[]>(CUSTOM_TEMPLATES_STORAGE_KEY, []).then(setList);
    return onStorageChange<CustomMeetingTemplate[]>(CUSTOM_TEMPLATES_STORAGE_KEY, (v) => setList(v ?? []));
  }, []);
  return list;
}

const EXAMPLE = { name: "Sales discovery", instructions: "Focus on the customer's problem, budget, who decides and their timeline. Note competitors they mention.", sections: "Budget\nDecision-makers\nNeed\nTimeline" };

export function CustomTemplates() {
  const id = useId();
  const templates = useCustomTemplates();
  const access = useProAccess();
  const [editing, setEditing] = useState<{ id: string | null; name: string; instructions: string; sections: string } | null>(null);
  const save = (next: CustomMeetingTemplate[]) => void storageSet(CUSTOM_TEMPLATES_STORAGE_KEY, next);

  const submit = () => {
    if (!editing) return;
    const name = editing.name.replace(/\s+/g, " ").trim().slice(0, 60);
    const sections = parseSections(editing.sections);
    const instructions = editing.instructions.trim().slice(0, MAX_INSTRUCTIONS);
    if (!name || (!instructions && !sections.length)) return;
    const t: CustomMeetingTemplate = { id: editing.id ?? generateId(), name, instructions, sections };
    save(editing.id ? templates.map((x) => (x.id === editing.id ? t : x)) : [...templates, t]);
    setEditing(null);
  };
  const ready = !!editing && !!editing.name.trim() && (!!editing.instructions.trim() || parseSections(editing.sections).length > 0);

  return (
    <div data-testid="custom-templates" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>
        Your meeting templates
        <ProBadge />
      </div>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>Your own meeting types: say what to focus on and list your own sections; summaries fill them in.</div>
      <ProNote access={access} what="Your own meeting templates" />
      {templates.length > 0 && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
          {templates.map((t) => (
            <li key={t.id} data-testid="custom-template" style={{ display: "flex", gap: 6, alignItems: "center", border: "1px solid var(--nb-section-border)", padding: "3px 6px", fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{t.name}</strong>
                {t.sections.length > 0 && <span style={{ opacity: 0.75 }}> · {t.sections.join(", ")}</span>}
              </span>
              <button style={small} onClick={() => setEditing({ id: t.id, name: t.name, instructions: t.instructions, sections: t.sections.join("\n") })} aria-label={`Edit ${t.name}`}>Edit</button>
              <button style={{ ...small, color: "var(--danger-text)" }} onClick={() => save(templates.filter((x) => x.id !== t.id))} aria-label={`Delete ${t.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <div style={{ border: "var(--nb-border)", padding: 8, marginTop: 6, display: "grid", gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 700 }} htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} placeholder={EXAMPLE.name} style={field} />
          <label style={{ fontSize: 11, fontWeight: 700 }} htmlFor={`${id}-instr`}>What to focus on</label>
          <textarea id={`${id}-instr`} value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} maxLength={MAX_INSTRUCTIONS} rows={3} placeholder={EXAMPLE.instructions} style={{ ...field, resize: "vertical" }} />
          <label style={{ fontSize: 11, fontWeight: 700 }} htmlFor={`${id}-sections`}>Your sections (one per line, up to {MAX_SECTIONS})</label>
          <textarea id={`${id}-sections`} value={editing.sections} onChange={(e) => setEditing({ ...editing, sections: e.target.value })} rows={4} placeholder={EXAMPLE.sections} style={{ ...field, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...small, background: ready ? "#FFD700" : "hsl(var(--card))", color: ready ? "#000" : "hsl(var(--foreground))", opacity: ready ? 1 : 0.6 }} disabled={!ready} onClick={submit}>
              {editing.id ? "Save template" : "Add template"}
            </button>
            <button style={small} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={{ ...small, marginTop: 6 }} onClick={() => setEditing({ id: null, name: "", instructions: "", sections: "" })}>
          + New template
        </button>
      )}
    </div>
  );
}
