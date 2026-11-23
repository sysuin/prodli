// Messages between the parts of voice dictation (types only, so the injected
// page script can import them without pulling in code):
// background (dictation/background.ts) ⇄ offscreen recorder (offscreenDictation.ts)
// background ⇄ the pill in the page (pill.ts).

export type ToOffscreen =
  | { target: "offscreen-dictate"; type: "start"; session: string }
  | { target: "offscreen-dictate"; type: "stop" }
  | { target: "offscreen-dictate"; type: "cancel" };

export type ToBackground =
  | { target: "background-dictate"; type: "piece"; session: string; seq: number; startMs: number; wav: string }
  | { target: "background-dictate"; type: "level"; level: number }
  /** From the pill: finish (✓, or the shortcut released after holding it), or cancel (✕ / Esc). */
  | { target: "background-dictate"; type: "finish"; heldMs?: number }
  | { target: "background-dictate"; type: "cancel" }
  /** From a ProdLi page (🎙 button): start dictating into this page's focused field. */
  | { target: "background-dictate"; type: "toggle-from-page" };

export interface FieldInfo {
  /** Where the text goes. False: nothing editable was focused (the text is copied instead). */
  editable: boolean;
  host: string;
  /** The field itself, to choose formatting (core.ts fieldKind). */
  field: { tag: string; type?: string; role?: string | null; multiline: boolean; codeLike: boolean };
  /** Selected text (Command Mode when not empty). */
  selection: string;
  /** Single-line field: newlines become spaces. */
  singleLine: boolean;
  /** ProdLi's own page with no text field focused: Speak tasks opened instead, so there's nothing to dictate. */
  handoff?: "voice-tasks";
}

export type PillState =
  | { phase: "listening"; command: boolean; hold: boolean; shortcut: string }
  | { phase: "working"; command: boolean }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

export type ToPill =
  /** `force`: answer even without focus (the top frame, when focus is outside the page). */
  | { target: "dictate-pill"; type: "start"; session: string; tabId?: number; state: PillState; force?: boolean }
  | { target: "dictate-pill"; type: "state"; session: string; tabId?: number; state: PillState }
  | { target: "dictate-pill"; type: "level"; session: string; tabId?: number; level: number }
  | { target: "dictate-pill"; type: "insert"; session: string; tabId?: number; text: string; replaceSelection: boolean }
  | { target: "dictate-pill"; type: "end"; session: string; tabId?: number; delayMs: number };

export interface InsertResult {
  ok: boolean;
  method: "typed" | "copied" | "none";
}
