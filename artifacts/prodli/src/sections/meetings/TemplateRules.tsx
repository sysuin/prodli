// Setup → Meeting notes → "Pick the type from the meeting's name" (Pro): rules
// like "interview, screening → Interview". Logic: lib/templateRules.ts.

import { useEffect, useState, type CSSProperties } from "react";
import { onStorageChange, storageGet, storageSet } from "../../lib/storage";
import { generateId } from "../../lib/utils";
import { MAX_RULES, ruleWords, TEMPLATE_RULES_STORAGE_KEY, type TemplateRule } from "../../lib/templateRules";
import { MEETING_TEMPLATES, type CustomTemplateRef, type MeetingTemplate } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";
import { useCustomTemplates } from "./CustomTemplates";

const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 12, padding: "5px 6px", boxSizing: "border-box", minWidth: 0 };
const small: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "4px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

export function TemplateRules() {
  const access = useProAccess();
  const customs = useCustomTemplates();
  const [rules, setRules] = useState<TemplateRule[]>([]);
  const [match, setMatch] = useState("");
  const [template, setTemplate] = useState<MeetingTemplate | CustomTemplateRef>("interview");
  const locked = !!access && !access.allowed;

  useEffect(() => {
    void storageGet<TemplateRule[]>(TEMPLATE_RULES_STORAGE_KEY, []).then(setRules);
    return onStorageChange<TemplateRule[]>(TEMPLATE_RULES_STORAGE_KEY, (v) => setRules(v ?? []));
  }, []);

  const save = (next: TemplateRule[]) => {
    setRules(next);
    void storageSet(TEMPLATE_RULES_STORAGE_KEY, next);
  };
  const label = (t: TemplateRule["template"]) => MEETING_TEMPLATES.find((x) => x.id === t)?.label ?? customs.find((c) => `custom:${c.id}` === t)?.name ?? "(deleted template)";
  const add = () => {
    if (!ruleWords(match).length || rules.length >= MAX_RULES) return;
    save([...rules, { id: generateId(), match: ruleWords(match).join(", "), template }]);
    setMatch("");
  };

  return (
    <div data-testid="template-rules" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>
        Pick the type from the meeting's name
        <ProBadge />
      </div>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>When a meeting has no type of its own, the first rule whose words are in its name decides (e.g. “interview, screening” → Interview).</div>
      <ProNote access={access} what="Meeting type rules" />
      {rules.length > 0 && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
          {rules.map((r, i) => (
            <li key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, border: "var(--nb-border)", padding: "4px 6px", background: "hsl(var(--card))" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{i + 1}.</strong> Name has <strong>{r.match}</strong> → {label(r.template)}
              </span>
              <button style={{ ...small, padding: "1px 6px" }} aria-label={`Remove the rule for ${r.match}`} onClick={() => save(rules.filter((x) => x.id !== r.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!locked && rules.length < MAX_RULES && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Words in the name, e.g. interview, screening"
            aria-label="Words in the meeting's name"
            style={{ ...field, flex: "1 1 180px" }}
          />
          <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateRule["template"])} aria-label="Meeting type for this rule" style={field}>
            {MEETING_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            {customs.map((t) => (
              <option key={t.id} value={`custom:${t.id}`}>
                {t.name} (yours)
              </option>
            ))}
          </select>
          <button style={small} disabled={!ruleWords(match).length} onClick={add}>
            + Add rule
          </button>
        </div>
      )}
    </div>
  );
}
