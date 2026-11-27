// Settings → 🎙 Dictation (extension): voice dictation into any text box, the
// Wispr Flow way. Turn it on (microphone), the shortcut, AI polish and the
// style for each kind of website, Command Mode (Pro), your dictionary (shared
// with meeting notes), snippets, and a history with stats.

import { useEffect, useId, useState, type CSSProperties } from "react";
import { onStorageChange, storageGet, storageSet } from "../lib/storage";
import { generateId } from "../lib/utils";
import { accountsEnabled, getAiUsage, getProdliAccount, onProdliAccountChange } from "../lib/prodliAccount";
import { parseVocabulary, VOCABULARY_STORAGE_KEY } from "../recorder/types";
import {
  CATEGORY_LABELS,
  CLEANUP_LABELS,
  cleanupLevel,
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_DAYS_KEY,
  DICTATION_HISTORY_KEY,
  DICTATION_SETTINGS_KEY,
  dictationStats,
  MAX_SNIPPETS,
  SNIPPETS_KEY,
  STYLE_LABELS,
  streakDays,
  type CleanupLevel,
  type DictationEntry,
  type DictationSettings as Settings,
  type DictationStyle,
  type SiteCategory,
  type Snippet,
} from "../dictation/core";
import { ProBadge, ProNote, useProAccess } from "./Pro";
import { LanguageSettings } from "./LanguageSettings";

const card: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", padding: "12px 14px", display: "grid", gap: 8 };
const h: CSSProperties = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 };
const field: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontFamily: "inherit", fontSize: 13, padding: "6px 8px", boxSizing: "border-box", minWidth: 0 };
const btn = (primary = false): CSSProperties => ({ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: primary ? "#FF4FA3" : "hsl(var(--card))", color: primary ? "#000" : "hsl(var(--foreground))", padding: "6px 12px", fontFamily: "inherit", fontWeight: 800, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });
const muted: CSSProperties = { fontSize: 12, opacity: 0.85, margin: 0 };

type MicState = "granted" | "prompt" | "denied" | "unknown";

async function micState(): Promise<MicState> {
  try {
    const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return p.state as MicState;
  } catch {
    return "unknown";
  }
}

export function DictationSettings() {
  const id = useId();
  const access = useProAccess();
  const [settings, setSettings] = useState<Settings>(DEFAULT_DICTATION_SETTINGS);
  const [offscreen, setOffscreen] = useState<boolean | null>(null);
  const [mic, setMic] = useState<MicState>("unknown");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [shortcut, setShortcut] = useState("Alt+Shift+D");
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const [words, setWords] = useState("");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [history, setHistory] = useState<DictationEntry[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [cue, setCue] = useState("");
  const [snipText, setSnipText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void storageGet<Partial<Settings>>(DICTATION_SETTINGS_KEY, {}).then((s) => setSettings({ ...DEFAULT_DICTATION_SETTINGS, ...s, styles: { ...DEFAULT_DICTATION_SETTINGS.styles, ...(s.styles ?? {}) } }));
    void storageGet<string[]>(VOCABULARY_STORAGE_KEY, []).then((w) => setWords(w.join(", ")));
    void storageGet<Snippet[]>(SNIPPETS_KEY, []).then(setSnippets);
    void storageGet<DictationEntry[]>(DICTATION_HISTORY_KEY, []).then(setHistory);
    void storageGet<string[]>(DICTATION_DAYS_KEY, []).then(setDays);
    void chrome.permissions?.contains({ permissions: ["offscreen"] }).then(setOffscreen, () => setOffscreen(false));
    void micState().then(setMic);
    void chrome.commands?.getAll().then((all) => setShortcut(all.find((c) => c.name === "dictate")?.shortcut || ""), () => {});
    const loadAccount = () =>
      void getProdliAccount().then((a) => {
        setSignedIn(!!a);
        if (a) void getAiUsage().then((u) => setUsage((u as { dictations?: { used: number; limit: number } }).dictations ?? null), () => {});
      });
    loadAccount();
    const offH = onStorageChange<DictationEntry[]>(DICTATION_HISTORY_KEY, (v) => setHistory(v ?? []));
    const offD = onStorageChange<string[]>(DICTATION_DAYS_KEY, (v) => setDays(v ?? []));
    // Words learned from your corrections show up in the dictionary right away.
    const offW = onStorageChange<string[]>(VOCABULARY_STORAGE_KEY, (v) => setWords((v ?? []).join(", ")));
    const offA = onProdliAccountChange(loadAccount);
    return () => {
      offH();
      offD();
      offW();
      offA();
    };
  }, []);

  const save = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void storageSet(DICTATION_SETTINGS_KEY, next);
  };
  const ready = offscreen === true && mic === "granted";

  const turnOn = async () => {
    setError("");
    // Both need this click: the permission to record in the background, and the microphone itself.
    const granted = await chrome.permissions.request({ permissions: ["offscreen"] }).catch(() => false);
    setOffscreen(granted);
    if (!granted) return setError("Chrome didn't allow ProdLi to record in the background. Try again.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMic("granted");
    } catch {
      setMic(await micState());
      setError("The microphone was blocked. Click the camera/microphone icon in the address bar (or chrome://settings/content/microphone) and allow it for ProdLi.");
    }
  };

  const saveWords = () => {
    const list = parseVocabulary(words);
    setWords(list.join(", "));
    void storageSet(VOCABULARY_STORAGE_KEY, list);
  };
  const saveSnippets = (next: Snippet[]) => {
    setSnippets(next);
    void storageSet(SNIPPETS_KEY, next);
  };
  const addSnippet = () => {
    if (!cue.trim() || !snipText.trim() || snippets.length >= MAX_SNIPPETS) return;
    saveSnippets([...snippets, { id: generateId(), cue: cue.trim().slice(0, 60), text: snipText.slice(0, 2000) }]);
    setCue("");
    setSnipText("");
  };
  const stats = dictationStats(history);
  const streak = streakDays(days);
  const level = cleanupLevel(settings);
  const shown = history.filter((e) => e.text);

  return (
    <div data-testid="dictation-settings" style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900 }}>🎙 Dictation</div>
        <p style={muted}>Talk instead of typing, in any text box on any website. ProdLi writes what you say, cleans it up (no “um”s, punctuation, lists, your corrections applied) and types it where your cursor is.</p>
      </div>

      <section style={card} aria-labelledby={`${id}-setup`}>
        <h3 id={`${id}-setup`} style={h}>1 · Set up</h3>
        {!accountsEnabled() && <p style={{ ...muted, fontWeight: 700 }}>Dictation needs ProdLi's servers, which aren't set up in this copy of ProdLi.</p>}
        {accountsEnabled() && signedIn === false && <p style={{ ...muted, fontWeight: 700 }}>Sign in to your ProdLi account (👤, free) — dictation uses it to turn speech into text.</p>}
        {ready ? (
          <p data-testid="dictation-ready" style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>✓ Dictation is on.</p>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={() => void turnOn()}>
              Turn on dictation
            </button>
            <span style={muted}>Chrome asks to let ProdLi record in the background and to use your microphone.</span>
          </div>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span>
            Shortcut: <kbd style={{ border: "var(--nb-border)", padding: "1px 6px", fontWeight: 800, background: "hsl(var(--background))" }}>{shortcut || "not set"}</kbd>
          </span>
          <button style={btn()} onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
            Change shortcut
          </button>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={settings.holdToTalk} onChange={(e) => save({ holdToTalk: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            Hold the shortcut to talk, release to finish
            <span style={{ display: "block", fontWeight: 400, opacity: 0.8 }}>A quick tap still works: tap to start, tap again (or ✓) to finish. Esc cancels.</span>
          </span>
        </label>
        <TryIt ready={ready && signedIn !== false} />
      </section>

      <section style={card} aria-labelledby={`${id}-polish`}>
        <h3 id={`${id}-polish`} style={h}>2 · Language, clean-up and style</h3>
        <LanguageSettings compact />
        <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 4 }} data-testid="dictation-cleanup">
          <legend style={{ fontSize: 13, fontWeight: 800, padding: 0, marginBottom: 4 }}>
            Clean-up{usage && level !== "none" ? <span style={{ fontWeight: 400, opacity: 0.8 }}> · {Math.max(0, usage.limit - usage.used)} of {usage.limit} AI clean-ups left this month</span> : null}
          </legend>
          {(Object.keys(CLEANUP_LABELS) as CleanupLevel[]).map((l) => (
            <label key={l} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600 }}>
              <input type="radio" name={`${id}-cleanup`} value={l} checked={level === l} onChange={() => save({ cleanup: l, polish: l !== "none" })} style={{ marginTop: 3 }} />
              <span>
                {CLEANUP_LABELS[l].label}
                <span style={{ display: "block", fontWeight: 400, opacity: 0.8 }}>{CLEANUP_LABELS[l].detail}</span>
              </span>
            </label>
          ))}
          <p style={muted}>The AI clean-up reads what's already in the box just before your cursor, so it continues your sentence and matches its capitals and punctuation.</p>
        </fieldset>
        <div style={{ display: "grid", gap: 6 }}>
          {(Object.keys(CATEGORY_LABELS) as SiteCategory[]).map((c) => (
            <label key={c} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span>
                <strong>{CATEGORY_LABELS[c].label}</strong>
                <span style={{ display: "block", fontSize: 11, opacity: 0.8 }}>{CATEGORY_LABELS[c].examples}</span>
              </span>
              <select value={settings.styles[c]} onChange={(e) => save({ styles: { ...settings.styles, [c]: e.target.value as DictationStyle } })} style={field} aria-label={`Style for ${CATEGORY_LABELS[c].label}`}>
                {(Object.keys(STYLE_LABELS) as DictationStyle[]).map((s) => (
                  <option key={s} value={s}>
                    {STYLE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section style={card} aria-labelledby={`${id}-command`}>
        <h3 id={`${id}-command`} style={h}>
          3 · Command Mode <ProBadge />
        </h3>
        <p style={muted}>Select text in any box, press the shortcut and say what to do with it: “make this more formal”, “turn this into bullet points”, “translate to Spanish”, “shorter”. ProdLi replaces the selection.</p>
        <ProNote access={access} what="Command Mode" />
      </section>

      <section style={card} aria-labelledby={`${id}-words`}>
        <h3 id={`${id}-words`} style={h}>4 · Dictionary</h3>
        <p style={muted}>Names and terms to spell exactly (shared with meeting notes).</p>
        <textarea value={words} onChange={(e) => setWords(e.target.value)} onBlur={saveWords} rows={2} placeholder="e.g. ProdLi, Priya Shah, Kubernetes, OKRs" aria-label="Dictionary words" style={{ ...field, width: "100%", resize: "vertical" }} />
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={settings.learnWords !== false} onChange={(e) => save({ learnWords: e.target.checked })} style={{ marginTop: 3 }} data-testid="dictation-learn" />
          <span>
            Learn words I correct
            <span style={{ display: "block", fontWeight: 400, opacity: 0.8 }}>When you fix a misheard word right after dictating (say “Prodly” → “ProdLi”), it's added here.</span>
          </span>
        </label>
      </section>

      <section style={card} aria-labelledby={`${id}-snippets`}>
        <h3 id={`${id}-snippets`} style={h}>5 · Snippets</h3>
        <p style={muted}>Say a short cue to type saved text — say just the cue, or use it inside a sentence.</p>
        <p style={muted} data-testid="snippet-picker-help">
          Or pick one without talking: right-click in any text box → <b>Insert a ProdLi snippet</b>, or set a shortcut for it in <code>chrome://extensions/shortcuts</code>. In ProdLi, press Ctrl/⌘+K and type “s ”. <code>{"{date}"}</code>, <code>{"{time}"}</code> and <code>{"{day}"}</code> are filled in when a snippet is picked.
        </p>
        {snippets.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {snippets.map((s) => (
              <li key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: "var(--nb-border)", padding: "6px 8px", background: "hsl(var(--background))", fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>“{s.cue}”</strong>
                  <span style={{ display: "block", fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.text.length > 160 ? `${s.text.slice(0, 160)}…` : s.text}</span>
                </span>
                <button style={{ ...btn(), padding: "2px 8px" }} aria-label={`Delete the snippet “${s.cue}”`} onClick={() => saveSnippets(snippets.filter((x) => x.id !== s.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          <input value={cue} onChange={(e) => setCue(e.target.value)} placeholder="Cue, e.g. “my calendar link”" aria-label="Snippet cue" style={field} />
          <textarea value={snipText} onChange={(e) => setSnipText(e.target.value)} rows={2} placeholder="Text to type, e.g. https://cal.com/you/30min" aria-label="Snippet text" style={{ ...field, resize: "vertical" }} />
          <div>
            <button style={btn()} disabled={!cue.trim() || !snipText.trim()} onClick={addSnippet}>
              + Add snippet
            </button>
          </div>
        </div>
      </section>

      <section style={card} aria-labelledby={`${id}-history`}>
        <h3 id={`${id}-history`} style={h}>6 · History & stats</h3>
        <div data-testid="dictation-stats" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          {streak > 0 && (
            <span data-testid="dictation-streak">
              🔥 <strong style={{ fontSize: 18 }}>{streak}</strong> day{streak === 1 ? "" : "s"} in a row
            </span>
          )}
          <span>
            <strong style={{ fontSize: 18 }}>{stats.weekWords}</strong> words this week
          </span>
          <span>
            <strong style={{ fontSize: 18 }}>{stats.totalWords}</strong> in all
          </span>
          {stats.wpm !== null && (
            <span>
              <strong style={{ fontSize: 18 }}>{stats.wpm}</strong> words/min
            </span>
          )}
          {stats.savedMin > 0 && (
            <span>
              about <strong style={{ fontSize: 18 }}>{stats.savedMin}</strong> min saved vs typing
            </span>
          )}
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={settings.keepHistory !== false}
            onChange={(e) => {
              save({ keepHistory: e.target.checked });
              // Turning it off removes what was said, keeping only the counts.
              if (!e.target.checked) void storageSet(DICTATION_HISTORY_KEY, history.map((x) => ({ ...x, text: "" })));
            }}
            style={{ marginTop: 3 }}
            data-testid="dictation-keep-history"
          />
          <span>
            Keep a history of what I dictate
            <span style={{ display: "block", fontWeight: 400, opacity: 0.8 }}>Off: past text is removed and new dictations aren't saved; only word counts stay, for the stats.</span>
          </span>
        </label>
        {shown.length === 0 ? (
          settings.keepHistory !== false && <p style={muted}>Your last {50} dictations show here (kept on this device only).</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {shown.slice(0, 20).map((e, i) => (
                <li key={`${e.at}-${i}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: "var(--nb-border)", padding: "6px 8px", background: "hsl(var(--background))", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{e.text}</span>
                    <span style={{ display: "block", fontSize: 11, opacity: 0.8 }}>
                      {new Date(e.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {e.site ? ` · ${e.site}` : ""}
                      {e.mode === "command" ? " · Command Mode" : ""}
                    </span>
                  </span>
                  <button style={{ ...btn(), padding: "2px 8px" }} onClick={() => void navigator.clipboard.writeText(e.text)} aria-label="Copy this dictation">
                    Copy
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <button style={btn()} onClick={() => void storageSet(DICTATION_HISTORY_KEY, history.map((x) => ({ ...x, text: "" })))}>
                Clear history
              </button>
            </div>
          </>
        )}
      </section>

      <p style={{ ...muted, fontSize: 11 }}>
        Privacy: your voice is sent to ProdLi's AI (Whisper, on Cloudflare) only while you dictate, and the text (with up to 1,000 characters already in the box before your cursor, for context) to Claude for the clean-up. Neither is stored on ProdLi's servers. The history stays on this device. Audio counts against your monthly AI transcription minutes.
      </p>
    </div>
  );
}

/** A box to try dictation in, with a 🎙 button (the same as the shortcut). */
function TryIt({ ready }: { ready: boolean }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor="dictation-try" style={{ fontSize: 12, fontWeight: 800 }}>
        Try it: click in the box, then press the shortcut (or 🎙) and talk
      </label>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <textarea id="dictation-try" data-testid="dictation-try" rows={3} placeholder="Your words appear here…" style={{ ...field, flex: 1, resize: "vertical" }} />
        <button
          style={btn()}
          disabled={!ready}
          aria-label="Dictate into the box"
          title={ready ? "Dictate into the box" : "Turn on dictation first"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            (document.getElementById("dictation-try") as HTMLTextAreaElement | null)?.focus();
            void chrome.runtime.sendMessage({ target: "background-dictate", type: "toggle-from-page" });
          }}
        >
          🎙
        </button>
      </div>
    </div>
  );
}
