// Desktop app: the pill for dictation into any app (index.html#dictate-pill, a
// small window that floats at the bottom of the screen and never takes the
// focus). The app's shortcut starts and finishes it (prodli-desktop
// src/main/dictation.ts); speech is transcribed piece by piece (Whisper), the
// text cleaned up in the style for the app in front, and pasted where the
// cursor is. History and the streak are kept like the extension's.

import { useCallback, useEffect, useRef, useState } from "react";
import { DictationCapture } from "../dictation/capture";
import {
  addDay,
  appCategory,
  appFieldKind,
  cleanLocally,
  cleanupLevel,
  countWords,
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_DAYS_KEY,
  DICTATION_HISTORY_KEY,
  DICTATION_SETTINGS_KEY,
  expandSnippets,
  MAX_DICTATION_MINUTES,
  MAX_HISTORY,
  SNIPPETS_KEY,
  wholeSnippet,
  type DictationEntry,
  type DictationSettings,
  type Snippet,
} from "../dictation/core";
import { desktop, shortcutLabel, type DesktopDictationControl } from "../lib/desktop";
import { AccountError, accountRequest } from "../lib/prodliAccount";
import { storageGet, storageSet } from "../lib/storage";
import { aiLanguage, getVoiceLanguage, whisperLanguage } from "../lib/voiceLanguage";
import { sendWithRetry } from "../recorder/audioTranscribe";
import { canUseProdliAi } from "../recorder/summarize";
import { VOCABULARY_STORAGE_KEY } from "../recorder/types";

type Phase = { kind: "idle" } | { kind: "listening" } | { kind: "working" } | { kind: "done"; message: string } | { kind: "error"; message: string };

interface Session {
  app: string;
  capture: DictationCapture;
  pieces: Map<number, Promise<string>>;
  error: string | null;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

export function DesktopDictationPill() {
  const bridge = desktop()?.dictation;
  const mac = desktop()?.platform === "mac";
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const [app, setApp] = useState("");
  const [shortcut, setShortcut] = useState("");
  const session = useRef<Session | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const settle = useCallback(
    (p: Phase, ms: number) => {
      setPhase(p);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setPhase({ kind: "idle" });
        bridge?.done();
      }, ms);
    },
    [bridge],
  );

  const start = useCallback(
    async (appName: string) => {
      if (session.current) return;
      clearTimeout(hideTimer.current);
      setApp(appName);
      setPhase({ kind: "listening" });
      void desktop()?.prefs.get().then((p) => setShortcut(shortcutLabel(p.dictateShortcut ?? "Alt+Shift+Space", mac)));
      const [language, vocabulary] = await Promise.all([getVoiceLanguage(), storageGet<string[]>(VOCABULARY_STORAGE_KEY, [])]);
      const pieces = new Map<number, Promise<string>>();
      const s: Session = {
        app: appName,
        pieces,
        error: null,
        startedAt: Date.now(),
        cancelled: false,
        timer: setTimeout(() => bridge?.finish(), MAX_DICTATION_MINUTES * 60_000),
        capture: new DictationCapture(
          (p) =>
            pieces.set(
              p.seq,
              sendWithRetry(p.wav, p.startMs, vocabulary, undefined, whisperLanguage(language)).then(
                (r) => r.text.trim(),
                (err: unknown) => {
                  s.error = err instanceof AccountError ? err.message : "Transcription didn't work. Try again.";
                  return "";
                },
              ),
            ),
          setLevel,
        ),
      };
      session.current = s;
      if (!(await canUseProdliAi())) {
        session.current = null;
        clearTimeout(s.timer);
        bridge?.cancel();
        return settle({ kind: "error", message: "Sign in to ProdLi to dictate (👤 in ProdLi, free)." }, 5000);
      }
      try {
        await s.capture.start();
      } catch (err) {
        session.current = null;
        clearTimeout(s.timer);
        bridge?.cancel();
        const name = err instanceof DOMException ? err.name : "";
        settle({ kind: "error", message: name === "NotAllowedError" ? `ProdLi can't use the microphone. Allow it in ${mac ? "System Settings → Privacy & Security → Microphone" : "Settings → Privacy → Microphone"}.` : name === "NotFoundError" ? "No microphone found." : "The microphone didn't start. Try again." }, 6000);
      }
    },
    [bridge, mac, settle],
  );

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s || !bridge) return;
    session.current = null;
    clearTimeout(s.timer);
    setPhase({ kind: "working" });
    const { pieces: count } = s.capture.stop();
    for (let i = 0; i < 40 && s.pieces.size < count; i++) await new Promise((r) => setTimeout(r, 50));
    const raw = (await Promise.all([...s.pieces.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p))).join(" ").replace(/\s+/g, " ").trim();
    if (!raw) return settle(s.error ? { kind: "error", message: s.error } : { kind: "done", message: "Didn't catch anything — try again a bit louder." }, s.error ? 6000 : 2400);

    const [settings, language, vocabulary, snippets] = await Promise.all([
      storageGet<Partial<DictationSettings>>(DICTATION_SETTINGS_KEY, {}).then((x) => ({ ...DEFAULT_DICTATION_SETTINGS, ...x, styles: { ...DEFAULT_DICTATION_SETTINGS.styles, ...(x.styles ?? {}) } })),
      getVoiceLanguage(),
      storageGet<string[]>(VOCABULARY_STORAGE_KEY, []),
      storageGet<Snippet[]>(SNIPPETS_KEY, []),
    ]);
    let text = raw;
    let polished = false;
    let note = "";
    const whole = wholeSnippet(raw, snippets);
    if (whole) text = whole.text;
    else {
      const level = cleanupLevel(settings);
      if (level !== "none") {
        try {
          const lang = aiLanguage(language);
          const body = { mode: "polish", text: raw, style: settings.styles[appCategory(s.app)], field: appFieldKind(s.app), level, dictionary: vocabulary.slice(0, 100), ...(lang ? { language: lang } : {}) };
          text = (await accountRequest<{ text: string }>("/api/ai/dictate", { method: "POST", body: JSON.stringify(body) })).text;
          polished = true;
        } catch (err) {
          text = cleanLocally(raw);
          note = err instanceof AccountError && err.status === 429 ? " (AI clean-up allowance used up this month)" : " (without AI clean-up)";
        }
      } else text = cleanLocally(raw);
      text = expandSnippets(text, snippets).text;
    }
    if (!text.trim()) return settle({ kind: "done", message: "Nothing to type." }, 2000);

    const result = await bridge.paste(text);
    const words = countWords(text);
    const paste = mac ? "⌘V" : "Ctrl+V";
    if (result.method === "typed") settle({ kind: "done", message: `✓ Typed ${words} word${words === 1 ? "" : "s"}${note}` }, 1600);
    else if (result.reason === "permission") settle({ kind: "done", message: `Copied — paste with ${paste}. To paste for you, allow ProdLi in Accessibility (Settings › Desktop app).` }, 6000);
    else settle({ kind: "done", message: `Copied — paste it with ${paste}${note}` }, 3500);

    const entry: DictationEntry = { at: new Date().toISOString(), text: settings.keepHistory === false ? "" : text, words, ms: Date.now() - s.startedAt, site: s.app, mode: "dictate", polished };
    const [history, days] = await Promise.all([storageGet<DictationEntry[]>(DICTATION_HISTORY_KEY, []), storageGet<string[]>(DICTATION_DAYS_KEY, [])]);
    await Promise.all([storageSet(DICTATION_HISTORY_KEY, [entry, ...history].slice(0, MAX_HISTORY)), storageSet(DICTATION_DAYS_KEY, addDay(days))]);
  }, [bridge, mac, settle]);

  const cancel = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (s) {
      clearTimeout(s.timer);
      s.capture.cancel();
    }
    settle({ kind: "done", message: "Cancelled" }, 700);
  }, [settle]);

  const handlers = useRef({ start, finish, cancel });
  handlers.current = { start, finish, cancel };
  useEffect(() => {
    // The window is see-through around the pill.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    if (!bridge) return;
    const off = bridge.onControl((c: DesktopDictationControl) => {
      if (c.type === "start") void handlers.current.start(c.app);
      else if (c.type === "app") {
        setApp(c.app);
        if (session.current) session.current.app = c.app;
      } else if (c.type === "finish") void handlers.current.finish();
      else if (c.type === "cancel") handlers.current.cancel();
    });
    bridge.ready();
    return off;
  }, [bridge]);

  if (phase.kind === "idle") return null;
  return (
    <div role="status" aria-live="polite" data-testid="desktop-dictate-pill" className="web-dictate-pill" style={{ position: "fixed", left: 8, right: 8, bottom: 10, transform: "none", maxWidth: "none", justifyContent: "flex-start" }}>
      {phase.kind === "listening" && (
        <>
          <span className="web-dictate-bars" aria-hidden>
            {[0.6, 1, 0.8, 1, 0.6].map((m, i) => (
              <span key={i} style={{ height: 4 + Math.round(level * 14 * m) }} />
            ))}
          </span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>Listening{app ? ` · ${app}` : "…"}</span>
          <span className="web-dictate-hint" style={{ marginLeft: "auto" }}>
            {shortcut || "Shortcut"} or ✓ · Esc
          </span>
          <button type="button" className="ok" aria-label="Finish dictating" onClick={() => bridge?.finish()}>
            ✓
          </button>
          <button type="button" className="x" aria-label="Cancel dictating" onClick={() => bridge?.cancel()}>
            ✕
          </button>
        </>
      )}
      {phase.kind === "working" && (
        <>
          <span className="web-dictate-spin" aria-hidden />
          <span>Writing it up…</span>
        </>
      )}
      {(phase.kind === "done" || phase.kind === "error") && <span style={{ fontSize: 12, lineHeight: 1.3 }}>{phase.message}</span>}
    </div>
  );
}
