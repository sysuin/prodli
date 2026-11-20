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

/** Ready-made templates to start from (copied into your list, then yours to edit). */
export const TEMPLATE_GALLERY: Omit<CustomMeetingTemplate, "id">[] = [
  { name: "Sales discovery", instructions: "A first call with a prospect. Focus on their problem and its cost, budget, who decides and how, their timeline and what they use today. Note competitors mentioned.", sections: ["Pain points", "Budget", "Decision process", "Timeline", "Current tools", "Next steps"] },
  { name: "Customer check-in", instructions: "A call with an existing customer. Focus on how they use the product, what's working, problems and risks to the account, and requests.", sections: ["Health", "Wins", "Issues", "Feature requests", "Renewal and expansion"] },
  { name: "User interview", instructions: "Research with a user. Capture their goals, how they work today, pain points and quotes in their words. Don't add solutions they didn't mention.", sections: ["Background", "Goals", "Current workflow", "Pain points", "Quotes", "Ideas to test"] },
  { name: "Retrospective", instructions: "A team retro. Group what went well, what didn't and what to change, with owners for each change.", sections: ["Went well", "Didn't go well", "Changes to try"] },
  { name: "Hiring debrief", instructions: "Interviewers discussing a candidate. Capture each interviewer's signal and the evidence behind it, and the decision. Only what was said; no judgement beyond the transcript.", sections: ["Strengths", "Concerns", "Interviewer signals", "Decision"] },
  { name: "Board or investor update", instructions: "An update to a board or investors. Capture metrics with numbers, progress, risks and what was asked of the team.", sections: ["Metrics", "Progress", "Risks", "Asks", "Board feedback"] },
  { name: "Design review", instructions: "Feedback on a design. Capture what was reviewed, feedback by theme, open questions and what will change.", sections: ["What was reviewed", "Feedback", "Changes agreed", "Open questions"] },
  { name: "1:1 coaching", instructions: "A manager and report 1:1 focused on growth. Capture how they're doing, goals, feedback both ways and commitments.", sections: ["Check-in", "Goals", "Feedback", "Commitments"] },
];

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
      {!editing && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, fontWeight: 700, marginTop: 6 }}>
          Start from
          <select
            value=""
            aria-label="Add a ready-made template"
            onChange={(e) => {
              const g = TEMPLATE_GALLERY.find((t) => t.name === e.target.value);
              if (!g) return;
              const name = templates.some((t) => t.name === g.name) ? `${g.name} (2)` : g.name;
              save([...templates, { ...g, name, id: generateId() }]);
            }}
            style={{ ...field, width: "auto", fontSize: 11, padding: "2px 4px" }}
          >
            <option value="">a ready-made template…</option>
            {TEMPLATE_GALLERY.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
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
