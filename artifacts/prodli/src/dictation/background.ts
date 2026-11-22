// Voice dictation (Wispr Flow-style), the background side:
//   Alt+Shift+D → the pill appears in the page and the microphone starts
//   (offscreen document); each piece of speech is transcribed by Whisper as
//   soon as it's cut at a pause; Alt+Shift+D again (or releasing it after
//   holding, or ✓) → the text is cleaned up (AI polish in the site's style,
//   snippets) and typed into the field the user was in. With text selected,
//   the speech is an instruction for that text instead (Command Mode, Pro).
// Esc or ✕ cancels. Nothing is kept on ProdLi's servers; a short history and
// stats stay on this device.

import { accountRequest, AccountError, accountsEnabled } from "../lib/prodliAccount";
import { sendWithRetry } from "../recorder/audioTranscribe";
import { base64ToBytes } from "../recorder/format";
import { canUseProdliAi } from "../recorder/summarize";
import { DICTATING_KEY, ensureOffscreenDocument, hasOffscreenDocument } from "../recorder/controller";
import { RECORDING_STATE_KEY, VOCABULARY_STORAGE_KEY } from "../recorder/types";
import {
  cleanLocally,
  countWords,
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_HISTORY_KEY,
  DICTATION_SETTINGS_KEY,
  expandSnippets,
  fieldKind,
  MAX_DICTATION_MINUTES,
  MAX_HISTORY,
  siteCategory,
  SNIPPETS_KEY,
  type DictationEntry,
  type DictationSettings,
  type Snippet,
  wholeSnippet,
} from "./core";
import type { FieldInfo, InsertResult, PillState, ToBackground, ToOffscreen, ToPill } from "./messages";

export const DICTATE_COMMAND = "dictate";
/** Settings → Dictation in ProdLi (opened when something needs setting up). */
const SETUP_URL = "index.html#settings=dictation";

interface Session {
  id: string;
  tabId: number;
  /** A ProdLi page (messages go through chrome.runtime instead of the tab). */
  page: boolean;
  startedAt: number;
  info: FieldInfo | null;
  settings: DictationSettings;
  vocabulary: string[];
  pieces: Map<number, Promise<string>>;
  transcribeError: string | null;
  finishing: boolean;
  timer: ReturnType<typeof setTimeout>;
}

let current: Session | null = null;

/** Test builds only: a stand-in for /api/ai/dictate (and for the account checks). */
type DictateStub = (body: Record<string, unknown>) => Promise<{ text: string }>;
const dictateStub = (): DictateStub | undefined => (import.meta.env.VITE_E2E === "1" ? (globalThis as { __prodliDictateStub?: DictateStub }).__prodliDictateStub : undefined);
function callDictate(body: Record<string, unknown>): Promise<{ text: string }> {
  const stub = dictateStub();
  if (stub) return stub(body);
  return accountRequest<{ text: string }>("/api/ai/dictate", { method: "POST", body: JSON.stringify(body) });
}

async function local<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}

function notify(title: string, message: string): void {
  chrome.notifications.create(`dictate_${Date.now()}`, { type: "basic", iconUrl: "icons/icon-128.png", title, message });
}

async function shortcutLabel(): Promise<string> {
  const all = await chrome.commands?.getAll().catch((): chrome.commands.Command[] => []);
  return all?.find((c) => c.name === DICTATE_COMMAND)?.shortcut || "Alt+Shift+D";
}

function toPill(s: Session, msg: Omit<ToPill, "target" | "session" | "tabId">): Promise<unknown> {
  const full = { target: "dictate-pill", session: s.id, ...msg } as ToPill;
  if (s.page) return chrome.runtime.sendMessage({ ...full, tabId: s.tabId }).catch(() => undefined);
  return chrome.tabs.sendMessage(s.tabId, full).catch(() => undefined);
}
const state = (s: Session, st: PillState) => void toPill(s, { type: "state", state: st } as Omit<ToPill, "target" | "session" | "tabId">);

function cannotTypeHere(url: string | undefined): boolean {
  if (!url) return true;
  if (url.startsWith(chrome.runtime.getURL(""))) return false;
  return !/^(https?|file):/.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

async function openSetup(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(SETUP_URL) });
}

// ── Start ────────────────────────────────────────────────────────────────────

export async function toggleDictation(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (current) {
    // A held key can repeat the shortcut: ignore repeats right after starting.
    if (Date.now() - current.startedAt < 500) return;
    return finish();
  }
  if (!tab?.id) return;
  if (cannotTypeHere(tab.url)) return notify("Dictation can't type here", "Chrome doesn't let extensions type on this page. Click into a text field on a website (or in ProdLi) and press the shortcut again.");
  if (!dictateStub() && !accountsEnabled()) return notify("Dictation isn't available", "Voice dictation needs ProdLi's servers, which aren't set up in this copy of ProdLi.");
  if (!dictateStub() && !(await canUseProdliAi())) {
    notify("Sign in to dictate", "Voice dictation uses your ProdLi account (free). Sign in from ProdLi (👤 at the bottom left), then press the shortcut again.");
    return void openSetup();
  }
  if (!(await chrome.permissions.contains({ permissions: ["offscreen"] }).catch(() => false))) {
    notify("Turn on dictation first", "Open Settings → Dictation in ProdLi and click Turn on dictation (it asks to use your microphone).");
    return void openSetup();
  }

  const page = !!tab.url?.startsWith(chrome.runtime.getURL(""));
  const [settings, vocabulary, shortcut] = await Promise.all([
    local<Partial<DictationSettings>>(DICTATION_SETTINGS_KEY, {}).then((s) => ({ ...DEFAULT_DICTATION_SETTINGS, ...s, styles: { ...DEFAULT_DICTATION_SETTINGS.styles, ...(s.styles ?? {}) } })),
    local<string[]>(VOCABULARY_STORAGE_KEY, []),
    shortcutLabel(),
  ]);
  const s: Session = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    page,
    startedAt: Date.now(),
    info: null,
    settings,
    vocabulary,
    pieces: new Map(),
    transcribeError: null,
    finishing: false,
    timer: setTimeout(() => void finish(), MAX_DICTATION_MINUTES * 60_000),
  };
  current = s;

  // The pill (and the field the user is in).
  if (!page) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["dictate-pill.js"] });
    } catch {
      current = null;
      clearTimeout(s.timer);
      return notify("Dictation can't type here", "ProdLi couldn't reach this page. Reload it and try again.");
    }
  }
  const listening: PillState = { phase: "listening", command: false, hold: settings.holdToTalk, shortcut };
  s.info = ((await toPill(s, { type: "start", state: listening } as Omit<ToPill, "target" | "session" | "tabId">)) as FieldInfo | undefined) ?? null;
  if (!s.info && !page) {
    // Focus wasn't in the page (e.g. the address bar): the top frame shows the pill; the text is copied.
    const force: ToPill = { target: "dictate-pill", type: "start", session: s.id, state: listening, force: true };
    s.info = ((await chrome.tabs.sendMessage(tab.id, force, { frameId: 0 }).catch(() => undefined)) as FieldInfo | undefined) ?? null;
  }

  await chrome.storage.session.set({ [DICTATING_KEY]: true });
  try {
    await ensureOffscreenDocument();
    const r = (await chrome.runtime.sendMessage({ target: "offscreen-dictate", type: "start", session: s.id } satisfies ToOffscreen)) as { ok: boolean; error?: string } | undefined;
    if (!r?.ok) throw new Error(r?.error ?? "mic-failed");
  } catch (err) {
    const reason = err instanceof Error ? err.message : "";
    state(s, {
      phase: "error",
      message: reason === "mic-blocked" ? "ProdLi can't use the microphone. Allow it in Settings → Dictation." : reason === "no-mic" ? "No microphone found." : "The microphone didn't start. Try again.",
    });
    if (reason === "mic-blocked") void openSetup();
    await cleanup(s, 6000);
  }
}

// ── Pieces as they come ──────────────────────────────────────────────────────

const TRANSCRIBE_MESSAGES = (err: unknown) => (err instanceof AccountError ? err.message : "Transcription didn't work. Try again.");

function onPiece(msg: Extract<ToBackground, { type: "piece" }>): void {
  const s = current;
  if (!s || msg.session !== s.id) return;
  s.pieces.set(
    msg.seq,
    sendWithRetry(base64ToBytes(msg.wav), msg.startMs, s.vocabulary).then(
      (r) => r.text.trim(),
      (err: unknown) => {
        s.transcribeError = TRANSCRIBE_MESSAGES(err);
        return "";
      },
    ),
  );
}

// ── Finish ───────────────────────────────────────────────────────────────────

async function finish(): Promise<void> {
  const s = current;
  if (!s || s.finishing) return;
  s.finishing = true;
  clearTimeout(s.timer);
  const command = !!s.info?.editable && !!s.info.selection.trim();
  state(s, { phase: "working", command });
  const stopped = ((await chrome.runtime.sendMessage({ target: "offscreen-dictate", type: "stop" } satisfies ToOffscreen).catch(() => undefined)) as { ms: number; pieces: number } | undefined) ?? { ms: Date.now() - s.startedAt, pieces: s.pieces.size };
  // The last pieces are on their way.
  for (let i = 0; i < 40 && s.pieces.size < stopped.pieces; i++) await new Promise((r) => setTimeout(r, 50));
  const texts = await Promise.all([...s.pieces.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p));
  const raw = texts.join(" ").replace(/\s+/g, " ").trim();

  if (!raw) {
    state(s, s.transcribeError ? { phase: "error", message: s.transcribeError } : { phase: "done", message: "Didn't catch anything — try again a bit louder." });
    return cleanup(s, s.transcribeError ? 6000 : 2200);
  }

  let text = raw;
  let polished = false;
  let note = "";
  try {
    if (command) {
      const r = await callDictate({ mode: "command", text: raw, selection: s.info!.selection, dictionary: s.vocabulary.slice(0, 100) });
      text = r.text;
      polished = true;
    } else {
      const snippets = await local<Snippet[]>(SNIPPETS_KEY, []);
      const whole = wholeSnippet(raw, snippets);
      if (whole) {
        text = whole.text; // the whole dictation was a snippet cue
      } else {
        if (s.settings.polish) {
          const host = s.info?.host ?? "";
          const style = s.settings.styles[siteCategory(host)];
          const field = s.info ? fieldKind(host, s.info.field) : "other";
          try {
            const r = await callDictate({ mode: "polish", text: raw, style, field, dictionary: s.vocabulary.slice(0, 100) });
            text = r.text;
            polished = true;
          } catch (err) {
            text = cleanLocally(raw);
            note = err instanceof AccountError && err.status === 429 ? " (AI clean-up allowance used up this month)" : " (without AI clean-up)";
          }
        } else text = cleanLocally(raw);
        text = expandSnippets(text, snippets).text;
      }
    }
  } catch (err) {
    if (command) {
      const message = err instanceof AccountError && err.status === 402 ? "Command Mode (editing selected text by voice) is part of ProdLi Pro." : err instanceof AccountError ? err.message : "Couldn't apply that edit. Try again.";
      state(s, { phase: "error", message });
      return cleanup(s, 6000);
    }
  }
  if (!text.trim()) {
    state(s, { phase: "done", message: "Nothing to type." });
    return cleanup(s, 2000);
  }

  const result = ((await toPill(s, { type: "insert", text, replaceSelection: command } as Omit<ToPill, "target" | "session" | "tabId">)) as InsertResult | undefined) ?? { ok: false, method: "none" };
  const words = countWords(text);
  const mac = /Mac/i.test(navigator.userAgent);
  state(
    s,
    result.method === "typed"
      ? { phase: "done", message: `✓ ${command ? "Edited" : `Typed ${words} word${words === 1 ? "" : "s"}`}${note}` }
      : result.method === "copied"
        ? { phase: "done", message: `Copied — paste it with ${mac ? "⌘V" : "Ctrl+V"}${note}` }
        : { phase: "error", message: "Couldn't type or copy the text. It's in ProdLi → Settings → Dictation → History." },
  );
  await saveHistory({ at: new Date().toISOString(), text, words, ms: stopped.ms, site: s.info?.host || "", mode: command ? "command" : "dictate", polished });
  await cleanup(s, result.method === "typed" ? 1400 : 3500);
}

async function cancel(): Promise<void> {
  const s = current;
  if (!s || s.finishing) return;
  clearTimeout(s.timer);
  await chrome.runtime.sendMessage({ target: "offscreen-dictate", type: "cancel" } satisfies ToOffscreen).catch(() => undefined);
  state(s, { phase: "done", message: "Cancelled" });
  await cleanup(s, 700);
}

async function cleanup(s: Session, pillDelayMs: number): Promise<void> {
  void toPill(s, { type: "end", delayMs: pillDelayMs } as Omit<ToPill, "target" | "session" | "tabId">);
  if (current?.id === s.id) current = null;
  clearTimeout(s.timer);
  await chrome.storage.session.remove(DICTATING_KEY);
  // Close the offscreen document unless a meeting is being recorded.
  const recording = (await chrome.storage.session.get(RECORDING_STATE_KEY))[RECORDING_STATE_KEY];
  if (!recording && (await hasOffscreenDocument())) await chrome.offscreen.closeDocument().catch(() => {});
}

async function saveHistory(entry: DictationEntry): Promise<void> {
  const list = await local<DictationEntry[]>(DICTATION_HISTORY_KEY, []);
  await chrome.storage.local.set({ [DICTATION_HISTORY_KEY]: [entry, ...list].slice(0, MAX_HISTORY) });
}

// ── Wiring ───────────────────────────────────────────────────────────────────

export function registerDictation(): void {
  if (import.meta.env.VITE_E2E === "1") Object.assign(globalThis, { __prodliToggleDictation: toggleDictation });

  chrome.commands?.onCommand.addListener((command, tab) => {
    if (command !== DICTATE_COMMAND) return;
    if (tab) void toggleDictation(tab);
    else void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => toggleDictation(t));
  });

  chrome.runtime.onMessage.addListener((msg: ToBackground, sender) => {
    if (msg?.target !== "background-dictate") return undefined;
    switch (msg.type) {
      case "piece":
        onPiece(msg);
        break;
      case "level":
        if (current && !current.finishing) void toPill(current, { type: "level", level: msg.level } as Omit<ToPill, "target" | "session" | "tabId">);
        break;
      case "finish":
        // Released after holding: only when push-to-talk is on.
        if (msg.heldMs !== undefined && !current?.settings.holdToTalk) break;
        void finish();
        break;
      case "cancel":
        void cancel();
        break;
      case "toggle-from-page":
        void toggleDictation(sender.tab);
        break;
    }
    return undefined;
  });
}
