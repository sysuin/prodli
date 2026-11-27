// Settings → Writing check (extension): spelling, grammar and clearer writing
// in any text box on the web. On demand needs no permission (right-click →
// Check writing with ProdLi); "Check on every site" asks for the optional
// all-sites permission. Chrome's on-device model is used when it's there.
// Logic: src/writing/ (background.ts registers the checker, checker.ts runs in pages).

import { useEffect, useState, type CSSProperties } from "react";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import { accountsEnabled, getAiUsage, getProdliAccount, onProdliAccountChange } from "../lib/prodliAccount";
import { DEFAULT_WRITING_SETTINGS, MAX_DICTIONARY, WRITING_SETTINGS_KEY } from "../writing/settings";
import type { CheckLevel, EnglishVariant, WritingSettings } from "../writing/types";

const card: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", padding: "12px 14px", display: "grid", gap: 8 };
const h: CSSProperties = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 };
const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 13, padding: "6px 8px", boxSizing: "border-box", minWidth: 0 };
const btn = (primary = false): CSSProperties => ({ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: primary ? "#FFD700" : "hsl(var(--card))", color: primary ? "#000" : "hsl(var(--foreground))", padding: "6px 12px", fontFamily: "inherit", fontWeight: 800, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });
const muted: CSSProperties = { fontSize: 12, opacity: 0.85, margin: 0 };
const chip: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--nb-section-border)", padding: "2px 4px 2px 8px", fontSize: 12, fontWeight: 700 };

const ALL_SITES = { origins: ["<all_urls>"] };
const VARIANTS: { value: EnglishVariant | ""; label: string }[] = [
  { value: "", label: "Automatic" },
  { value: "en-US", label: "American (US)" },
  { value: "en-GB", label: "British (UK)" },
  { value: "en-IN", label: "Indian" },
  { value: "en-AU", label: "Australian" },
  { value: "en-CA", label: "Canadian" },
];

type ModelState = "unavailable" | "downloadable" | "downloading" | "available" | "checking";
interface LanguageModelApi {
  availability(o?: object): Promise<Exclude<ModelState, "checking">>;
  create(o?: object): Promise<{ destroy(): void }>;
}
const LANG = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
const lm = () => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;

export function WritingCheckSettings() {
  const [s, setS] = useState<WritingSettings>(DEFAULT_WRITING_SETTINGS);
  const [granted, setGranted] = useState(false);
  const [model, setModel] = useState<ModelState>("checking");
  const [progress, setProgress] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [word, setWord] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const load = () => void storageGet<Partial<WritingSettings>>(WRITING_SETTINGS_KEY, {}).then((v) => setS({ ...DEFAULT_WRITING_SETTINGS, ...v }));
    load();
    void chrome.permissions?.contains(ALL_SITES).then(setGranted, () => setGranted(false));
    void (lm()?.availability(LANG).then(setModel, () => setModel("unavailable")) ?? Promise.resolve(setModel("unavailable")));
    const check = () =>
      void getProdliAccount().then((u) => {
        setSignedIn(!!u);
        if (u) getAiUsage().then((r) => setUsage(r.checks ?? null), () => setUsage(null));
      });
    if (accountsEnabled()) check();
    const off = accountsEnabled() ? onProdliAccountChange(check) : () => {};
    const offStore = onStorageChange<Partial<WritingSettings>>(WRITING_SETTINGS_KEY, (v) => setS({ ...DEFAULT_WRITING_SETTINGS, ...(v ?? {}) }));
    return () => {
      off();
      offStore();
    };
  }, []);

  const save = (patch: Partial<WritingSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void storageSet(WRITING_SETTINGS_KEY, next);
  };

  const toggleEverywhere = async (on: boolean) => {
    setNote(null);
    if (!on) {
      save({ everywhere: false });
      return;
    }
    // Asked from this click, so Chrome shows its prompt.
    const ok = await chrome.permissions.request(ALL_SITES).catch(() => false);
    setGranted(ok);
    if (ok) save({ everywhere: true });
    else setNote("Chrome didn't give ProdLi access, so the check stays on demand (right-click a text box).");
  };

  const download = async () => {
    const api = lm();
    if (!api) return;
    setModel("downloading");
    setProgress(0);
    try {
      const session = await api.create({ ...LANG, monitor: (m: EventTarget) => m.addEventListener("downloadprogress", (e) => setProgress(Math.round(((e as unknown as { loaded: number }).loaded ?? 0) * 100))) });
      session.destroy();
      setModel("available");
    } catch {
      setModel((await api.availability(LANG).catch(() => "unavailable")) as ModelState);
    } finally {
      setProgress(null);
    }
  };

  const addWord = () => {
    const w = word.trim();
    if (!w || s.dictionary.some((d) => d.toLowerCase() === w.toLowerCase())) return setWord("");
    save({ dictionary: [...s.dictionary, w].slice(-MAX_DICTIONARY) });
    setWord("");
  };

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="writing-check-settings">
      <div>
        <div style={{ fontSize: 20, fontWeight: 900 }}>Writing check</div>
        <p style={muted}>Spelling, grammar and clearer wording in any text box: Gmail, LinkedIn, Slack on the web, forms. Click an underline to fix it; the badge in the corner fixes everything at once or rewrites the text shorter, clearer, more formal or friendlier.</p>
      </div>

      <section style={card}>
        <h3 style={h}>Where it checks</h3>
        <p style={muted}>
          <strong>On demand (no permission needed):</strong> right-click in a text box → <em>Check writing with ProdLi</em>. It keeps checking that page as you type. You can also give it a shortcut in{" "}
          <button style={{ ...btn(), padding: "1px 6px", boxShadow: "none" }} onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
            Chrome's shortcuts
          </button>
          .
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <input type="checkbox" data-testid="writing-everywhere" checked={s.everywhere && granted} onChange={(e) => void toggleEverywhere(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Check on every site automatically
            <span style={{ display: "block", fontWeight: 400, fontSize: 12, opacity: 0.85 }}>Chrome will ask to let ProdLi read and change text on websites. ProdLi only reads the text box you're typing in, never passwords or card fields, and doesn't keep what you write.</span>
          </span>
        </label>
        {note && <p style={{ ...muted, fontWeight: 700 }} role="status">{note}</p>}
        {s.offSites.length > 0 && (
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800 }}>Turned off on</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {s.offSites.map((site) => (
                <span key={site} style={chip}>
                  {site}
                  <button aria-label={`Turn back on for ${site}`} title="Turn back on" onClick={() => save({ offSites: s.offSites.filter((x) => x !== site) })} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 900 }}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section style={card}>
        <h3 style={h}>What it points out</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="What it points out">
          {(
            [
              ["polish", "Mistakes and clearer writing"],
              ["correct", "Only mistakes"],
            ] as [CheckLevel, string][]
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={s.level === v} data-testid={`writing-level-${v}`} onClick={() => save({ level: v })} style={{ ...btn(s.level === v), boxShadow: s.level === v ? "none" : "var(--nb-shadow-sm)" }}>
              {label}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
          English spelling
          <select value={s.variant ?? ""} onChange={(e) => save({ variant: (e.target.value || undefined) as EnglishVariant | undefined })} style={field} data-testid="writing-variant">
            {VARIANTS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <p style={muted}>Other languages, including Hindi and Hinglish, are checked in their own language.</p>
      </section>

      <section style={card}>
        <h3 style={h}>On this computer, or ProdLi AI</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <input type="checkbox" checked={s.onDevice} onChange={(e) => save({ onDevice: e.target.checked })} data-testid="writing-on-device" />
          Use Chrome's built-in AI when this computer has it
        </label>
        <p style={muted} data-testid="writing-model-state">
          {model === "checking"
            ? "Checking this computer…"
            : model === "available"
              ? "Ready: English is checked on this computer, free and without limits. The text never leaves your computer."
              : model === "downloading"
                ? `Downloading Chrome's model${progress !== null ? ` (${progress}%)` : ""}. It's large; you can keep working.`
                : model === "downloadable"
                  ? "This computer can run Chrome's built-in model. Download it once (several GB) to check English on this computer for free."
                  : "This computer or Chrome version can't run Chrome's built-in model, so ProdLi's AI checks your writing."}
        </p>
        {model === "downloadable" && s.onDevice && (
          <div>
            <button style={btn(true)} onClick={() => void download()}>
              Download Chrome's model
            </button>
          </div>
        )}
        {accountsEnabled() && (
          <p style={muted}>
            {signedIn ? (usage ? `ProdLi AI: ${usage.used} of ${usage.limit} checks used this month (checks on this computer don't count).` : "ProdLi AI checks count toward your monthly allowance.") : "ProdLi AI needs a free ProdLi account: sign in (👤) to use it."}
          </p>
        )}
      </section>

      <section style={card}>
        <h3 style={h}>Your dictionary</h3>
        <p style={muted}>Names and words that are never marked as spelling mistakes. “Add to dictionary” on an underline adds them here.</p>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} placeholder="Add a word" aria-label="Add a word to your dictionary" style={{ ...field, flex: 1 }} maxLength={60} />
          <button style={btn()} onClick={addWord}>
            Add
          </button>
        </div>
        {s.dictionary.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {s.dictionary.map((d) => (
              <span key={d} style={chip}>
                {d}
                <button aria-label={`Remove ${d}`} onClick={() => save({ dictionary: s.dictionary.filter((x) => x !== d) })} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 900 }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <p style={muted}>
        Privacy: text checked on this computer stays on it. Text checked by ProdLi's AI is sent to our AI provider to find the suggestions and isn't stored or used for training. Google Docs isn't supported yet (it draws its text in a way extensions can't read).
      </p>
    </div>
  );
}
