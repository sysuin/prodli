// Voice dictation in ProdLi itself, for the web app (app.prodli.com) and the
// desktop app, where the extension's dictation (dictation/background.ts) isn't
// there. Alt+Shift+D, or the small 🎙 button on the text box you're in: talk,
// then press it again (or ✓). Each piece of speech is transcribed by Whisper as
// soon as it's cut at a pause (/api/ai/transcribe), the text is cleaned up
// (/api/ai/dictate, AI polish) and typed where the cursor was. With text
// selected, the speech is an instruction for that text (Command Mode, Pro).
// Esc or ✕ cancels. Nothing is kept on ProdLi's servers.

import { useCallback, useEffect, useRef, useState } from "react";
import { DictationCapture } from "../dictation/capture";
import { cleanLocally, countWords, DEFAULT_DICTATION_SETTINGS, DICTATION_SETTINGS_KEY, MAX_DICTATION_MINUTES, type DictationSettings, type FieldKind } from "../dictation/core";
import { sendWithRetry } from "../recorder/audioTranscribe";
import { canUseProdliAi } from "../recorder/summarize";
import { VOCABULARY_STORAGE_KEY } from "../recorder/types";
import { AccountError, accountRequest } from "../lib/prodliAccount";
import { storageGet } from "../lib/storage";
import { aiLanguage, getVoiceLanguage, whisperLanguage } from "../lib/voiceLanguage";

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface Target {
  el: Editable;
  start: number | null;
  end: number | null;
  range: Range | null;
  selection: string;
}

type Phase = { kind: "idle" } | { kind: "listening"; command: boolean } | { kind: "working"; command: boolean } | { kind: "done"; message: string } | { kind: "error"; message: string };

/** Test builds only: stand-ins for /api/ai/dictate and the sign-in check (Whisper has __prodliTranscribeStub). */
type DictateStub = (body: Record<string, unknown>) => Promise<{ text: string }>;
const dictateStub = (): DictateStub | undefined => (import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliDictateStub?: DictateStub }).__prodliDictateStub : undefined);
const callDictate = (body: Record<string, unknown>) => dictateStub()?.(body) ?? accountRequest<{ text: string }>("/api/ai/dictate", { method: "POST", body: JSON.stringify(body) });

const TEXT_TYPES = new Set(["text", "search", "email", "url", ""]);
/** The text box an element belongs to, if it's one dictation can type into. */
export function editableOf(el: Element | null): Editable | null {
  if (!el) return null;
  if (el.closest("[data-no-dictation]") || el.getAttribute("role") === "combobox") return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled ? el : null;
  if (el instanceof HTMLElement && el.isContentEditable) {
    let h: HTMLElement = el;
    while (h.parentElement?.isContentEditable) h = h.parentElement;
    return h;
  }
  return null;
}

/** What kind of field it is, for the clean-up style (ProdLi's own pages are "documents" or plain fields). */
const fieldOf = (el: Editable): FieldKind => (el instanceof HTMLInputElement ? (el.type === "search" ? "search" : "other") : "document");

function capture(el: Editable): Target {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    return { el, start, end, range: null, selection: start !== null && end !== null && end > start ? el.value.slice(start, end) : "" };
  }
  const sel = window.getSelection();
  const range = sel && sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0).cloneRange() : null;
  return { el, start: null, end: null, range, selection: range ? range.toString() : "" };
}

function typeInto(t: Target, text: string, replaceSelection: boolean): "typed" | "copied" {
  const el = t.el;
  if (!el.isConnected) return copy(text);
  const value = el instanceof HTMLInputElement ? text.replace(/\s*\n+\s*/g, " ") : text;
  try {
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = t.start ?? el.value.length;
      const end = replaceSelection ? (t.end ?? start) : start;
      el.setSelectionRange(start, end);
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const lead = !replaceSelection && before && !/\s$/.test(before) && !/^[\s,.!?;:]/.test(value) ? " " : "";
      const trail = !replaceSelection && after && !/^[\s,.!?;:]/.test(after) && !/\s$/.test(value) ? " " : "";
      if (!document.execCommand("insertText", false, lead + value + trail)) return copy(text);
    } else {
      const sel = window.getSelection();
      if (t.range && sel) {
        sel.removeAllRanges();
        const r = t.range.cloneRange();
        if (!replaceSelection) r.collapse(false);
        sel.addRange(r);
      }
      let ok = true;
      value.split("\n").forEach((line, i) => {
        if (i > 0) ok = document.execCommand("insertParagraph") && ok;
        if (line) ok = document.execCommand("insertText", false, line) && ok;
      });
      if (!ok) return copy(text);
    }
    return "typed";
  } catch {
    return copy(text);
  }
}
function copy(text: string): "copied" {
  void navigator.clipboard?.writeText(text).catch(() => {});
  return "copied";
}

export function WebDictation() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const [focused, setFocused] = useState<{ el: Editable; rect: DOMRect } | null>(null);
  const session = useRef<{ target: Target; capture: DictationCapture; pieces: Map<number, Promise<string>>; error: string | null; timer: ReturnType<typeof setTimeout>; startedAt: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = phase.kind === "listening" || phase.kind === "working";

  const settle = useCallback((p: Phase, ms: number) => {
    setPhase(p);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPhase({ kind: "idle" }), ms);
  }, []);

  const start = useCallback(async (el: Editable | null) => {
    if (session.current) return;
    if (!el) return settle({ kind: "error", message: "Click into a text box first, then press Alt+Shift+D (or 🎙)." }, 3500);
    if (!dictateStub() && !(await canUseProdliAi())) return settle({ kind: "error", message: "Dictation uses your ProdLi account (free): sign in (👤 at the bottom left), then try again." }, 5000);
    const target = capture(el);
    const command = !!target.selection.trim();
    const [language, vocabulary] = await Promise.all([getVoiceLanguage(), storageGet<string[]>(VOCABULARY_STORAGE_KEY, [])]);
    const pieces = new Map<number, Promise<string>>();
    const s = {
      target,
      pieces,
      error: null as string | null,
      startedAt: Date.now(),
      timer: setTimeout(() => void finishRef.current(), MAX_DICTATION_MINUTES * 60_000),
      capture: new DictationCapture(
        (p) => {
          pieces.set(
            p.seq,
            sendWithRetry(p.wav, p.startMs, vocabulary, undefined, whisperLanguage(language)).then(
              (r) => r.text.trim(),
              (err: unknown) => {
                s.error = err instanceof AccountError ? err.message : "Transcription didn't work. Try again.";
                return "";
              },
            ),
          );
        },
        setLevel,
      ),
    };
    session.current = s;
    clearTimeout(hideTimer.current);
    setPhase({ kind: "listening", command });
    try {
      await s.capture.start();
    } catch (err) {
      session.current = null;
      clearTimeout(s.timer);
      const name = err instanceof DOMException ? err.name : "";
      settle({ kind: "error", message: name === "NotAllowedError" || name === "SecurityError" ? "ProdLi can't use the microphone. Allow it for this site (the 🔒 in the address bar), then try again." : name === "NotFoundError" ? "No microphone found." : "The microphone didn't start. Try again." }, 6000);
    }
  }, [settle]);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearTimeout(s.timer);
    const command = !!s.target.selection.trim();
    setPhase({ kind: "working", command });
    const { pieces: count } = s.capture.stop();
    for (let i = 0; i < 40 && s.pieces.size < count; i++) await new Promise((r) => setTimeout(r, 50));
    const texts = await Promise.all([...s.pieces.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p));
    const raw = texts.join(" ").replace(/\s+/g, " ").trim();
    if (!raw) return settle(s.error ? { kind: "error", message: s.error } : { kind: "done", message: "Didn't catch anything — try again a bit louder." }, s.error ? 6000 : 2400);
    const [settings, language, vocabulary] = await Promise.all([
      storageGet<Partial<DictationSettings>>(DICTATION_SETTINGS_KEY, {}).then((x) => ({ ...DEFAULT_DICTATION_SETTINGS, ...x })),
      getVoiceLanguage(),
      storageGet<string[]>(VOCABULARY_STORAGE_KEY, []),
    ]);
    let text = raw;
    let note = "";
    if (command) {
      try {
        text = (await callDictate({ mode: "command", text: raw, selection: s.target.selection.slice(0, 8000), dictionary: vocabulary.slice(0, 100) })).text;
      } catch (err) {
        return settle({ kind: "error", message: err instanceof AccountError && err.status === 402 ? "Command Mode (editing selected text by voice) is part of ProdLi Pro." : err instanceof AccountError ? err.message : "Couldn't apply that edit. Try again." }, 6000);
      }
    } else if (settings.polish) {
      try {
        const lang = aiLanguage(language);
        text = (await callDictate({ mode: "polish", text: raw, style: settings.styles.other, field: fieldOf(s.target.el), dictionary: vocabulary.slice(0, 100), ...(lang ? { language: lang } : {}) })).text;
      } catch (err) {
        text = cleanLocally(raw);
        note = err instanceof AccountError && err.status === 429 ? " (AI clean-up allowance used up this month)" : " (without AI clean-up)";
      }
    } else text = cleanLocally(raw);
    if (!text.trim()) return settle({ kind: "done", message: "Nothing to type." }, 2000);
    const how = typeInto(s.target, text, command);
    const words = countWords(text);
    const mac = /Mac/i.test(navigator.userAgent);
    settle({ kind: "done", message: how === "typed" ? `✓ ${command ? "Edited" : `Typed ${words} word${words === 1 ? "" : "s"}`}${note}` : `Copied — paste it with ${mac ? "⌘V" : "Ctrl+V"}${note}` }, how === "typed" ? 1600 : 3500);
  }, [settle]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearTimeout(s.timer);
    s.capture.cancel();
    settle({ kind: "done", message: "Cancelled" }, 800);
  }, [settle]);

  // Alt+Shift+D toggles; Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyD" || e.key.toLowerCase() === "d")) {
        e.preventDefault();
        if (session.current) void finish();
        else void start(editableOf(document.activeElement));
      } else if (e.key === "Escape" && session.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [start, finish, cancel]);

  // The 🎙 button follows the text box that has focus.
  useEffect(() => {
    const update = () => {
      const el = editableOf(document.activeElement);
      if (!el) return setFocused(null);
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 24) return setFocused(null);
      setFocused({ el, rect });
    };
    const onBlur = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onBlur);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onBlur);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, []);

  useEffect(() => () => session.current?.capture.cancel(), []);

  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  return (
    <>
      {focused && !busy && (
        <button
          type="button"
          data-testid="web-dictate-button"
          aria-label="Dictate into this box (Alt+Shift+D)"
          title={`Dictate: talk instead of typing (${mac ? "⌥⇧D" : "Alt+Shift+D"})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void start(focused.el)}
          className="web-dictate-btn"
          style={{ top: Math.max(4, focused.rect.bottom - 30), left: Math.min(window.innerWidth - 32, focused.rect.right - 30) }}
        >
          🎙
        </button>
      )}
      {phase.kind !== "idle" && (
        <div role="status" aria-live="polite" data-testid="web-dictate-pill" className="web-dictate-pill">
          {phase.kind === "listening" && (
            <>
              <span className="web-dictate-bars" aria-hidden>
                {[0.6, 1, 0.8, 1, 0.6].map((m, i) => (
                  <span key={i} style={{ height: 4 + Math.round(level * 14 * m) }} />
                ))}
              </span>
              <span>{phase.command ? "Say how to change the selection…" : "Listening…"}</span>
              <span className="web-dictate-hint">{mac ? "⌥⇧D" : "Alt+Shift+D"} or ✓ to finish · Esc cancels</span>
              <button type="button" className="ok" aria-label="Finish dictating" onMouseDown={(e) => e.preventDefault()} onClick={() => void finish()}>
                ✓
              </button>
              <button type="button" className="x" aria-label="Cancel dictating" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
                ✕
              </button>
            </>
          )}
          {phase.kind === "working" && (
            <>
              <span className="web-dictate-spin" aria-hidden />
              <span>{phase.command ? "Editing…" : "Writing it up…"}</span>
            </>
          )}
          {(phase.kind === "done" || phase.kind === "error") && <span>{phase.message}</span>}
        </div>
      )}
    </>
  );
}
