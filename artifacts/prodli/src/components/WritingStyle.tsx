// Settings → "Writing style" (Pro): how you like to write. ✨ Improve in Notes
// (all options except "Fix spelling", which keeps your exact wording) and
// follow-up emails from meetings follow it. Server: write.ts styleText.

import { useEffect, useId, useState } from "react";
import { storageGet, storageSet } from "../lib/storage";
import { MAX_STYLE_CHARS, WRITING_STYLE_KEY } from "../lib/write";
import { ProBadge, ProNote, useProAccess } from "./Pro";

const EXAMPLES = ["British English. Friendly but brief. Short sentences, no exclamation marks.", "Formal and precise. Use bullet points for lists. Avoid jargon.", "Warm and direct, like talking to a colleague. Sign off with “Thanks,”."];

export function WritingStyleSection() {
  const id = useId();
  const access = useProAccess();
  const [style, setStyle] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void storageGet<string>(WRITING_STYLE_KEY, "").then(setStyle);
  }, []);
  const save = (v: string) => {
    void storageSet(WRITING_STYLE_KEY, v.trim().slice(0, MAX_STYLE_CHARS));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div data-testid="writing-style" style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <label htmlFor={`${id}-style`} style={{ fontWeight: 800 }}>
        Your writing style
        <ProBadge />
      </label>
      <div style={{ fontSize: 12, opacity: 0.85 }}>✨ Improve in Notes (except Fix spelling, which keeps your wording) and ✉️ follow-up emails will write this way.</div>
      <textarea
        id={`${id}-style`}
        value={style}
        maxLength={MAX_STYLE_CHARS}
        rows={4}
        onChange={(e) => setStyle(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        placeholder={EXAMPLES[0]}
        style={{ border: "var(--nb-border)", padding: "8px 10px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11 }}>
        <span style={{ opacity: 0.75 }}>
          {style.length}/{MAX_STYLE_CHARS}
          {saved ? " · Saved" : ""}
        </span>
        <span style={{ opacity: 0.75, marginLeft: 8 }}>Try:</span>
        {EXAMPLES.slice(1).map((ex) => (
          <button key={ex} onClick={() => (setStyle(ex), save(ex))} style={{ border: "1px solid var(--nb-section-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 11, padding: "1px 6px", cursor: "pointer" }}>
            {ex.split(".")[0]}
          </button>
        ))}
        {style && (
          <button onClick={() => (setStyle(""), save(""))} style={{ border: "none", background: "none", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: "inherit" }}>
            Clear
          </button>
        )}
      </div>
      <ProNote access={access} what="Your writing style" />
    </div>
  );
}
