// Voice dictation, in the page: remembers the field the user was typing in (and
// any selected text, for Command Mode), shows a small floating pill with a live
// microphone level while they talk, and types the finished text into the field.
//
// Injected with chrome.scripting into the active tab when the shortcut is
// pressed (every frame; only the frame that has focus answers), and loaded
// into ProdLi's own pages directly. Must stay self-contained: type-only imports.

import type { FieldInfo, InsertResult, PillState, ToBackground, ToPill } from "./messages";

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface Target {
  el: Editable | null;
  /** input/textarea selection */
  start: number | null;
  end: number | null;
  /** contenteditable selection */
  range: Range | null;
}

const w = window as unknown as { __prodliDictatePill?: boolean };
if (!w.__prodliDictatePill) {
  w.__prodliDictatePill = true;
  install();
}

function install(): void {
  const isExtensionPage = location.protocol === "chrome-extension:";
  let myTabId: number | null = null;
  if (isExtensionPage) void chrome.tabs?.getCurrent?.().then((t) => (myTabId = t?.id ?? null));

  let session = "";
  let target: Target = { el: null, start: null, end: null, range: null };
  let host: HTMLDivElement | null = null;
  let root: ShadowRoot | null = null;
  let bars: HTMLSpanElement[] = [];
  let startedAt = 0;
  let hold = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (msg: ToBackground) => void chrome.runtime.sendMessage(msg).catch(() => {});

  // ── The focused field ──────────────────────────────────────────────────────
  function deepActive(): Element | null {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", ""]);
  function editableOf(el: Element | null): Editable | null {
    if (!el) return null;
    if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
    if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled ? el : null;
    if (el instanceof HTMLElement && el.isContentEditable) {
      // The editing host (outermost contenteditable).
      let h: HTMLElement = el;
      while (h.parentElement?.isContentEditable) h = h.parentElement;
      return h;
    }
    return null;
  }
  function capture(): FieldInfo {
    const el = editableOf(deepActive());
    let selection = "";
    target = { el, start: null, end: null, range: null };
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      target.start = el.selectionStart;
      target.end = el.selectionEnd;
      if (el.selectionStart !== null && el.selectionEnd !== null && el.selectionEnd > el.selectionStart && !(el instanceof HTMLInputElement && el.type === "password")) selection = el.value.slice(el.selectionStart, el.selectionEnd);
    } else if (el) {
      const sel = el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null }).getSelection ? (el.getRootNode() as unknown as { getSelection: () => Selection | null }).getSelection() : window.getSelection();
      if (sel && sel.rangeCount) {
        target.range = sel.getRangeAt(0).cloneRange();
        selection = sel.toString();
      }
    }
    const cls = el ? `${el.className || ""} ${el.parentElement?.className || ""}` : "";
    const codeLike = /\b(cm-content|CodeMirror|monaco|ace_text|code)\b/i.test(String(cls));
    return {
      editable: !!el,
      host: location.hostname,
      field: { tag: el ? el.tagName.toLowerCase() : "", type: el instanceof HTMLInputElement ? el.type : undefined, role: el?.getAttribute("role") ?? null, multiline: !!el && !(el instanceof HTMLInputElement), codeLike },
      selection: selection.slice(0, 8000),
      singleLine: el instanceof HTMLInputElement,
    };
  }

  // ── Typing the text ────────────────────────────────────────────────────────
  function insert(text: string, replaceSelection: boolean): InsertResult {
    const el = target.el;
    if (!el || !el.isConnected) return copy(text);
    const value = el instanceof HTMLInputElement ? text.replace(/\s*\n+\s*/g, " ") : text;
    try {
      el.focus({ preventScroll: true });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = target.start ?? el.value.length;
        const end = replaceSelection ? (target.end ?? start) : start;
        el.setSelectionRange(start, end);
        // A space between the old text and the new, like a person would type.
        const before = el.value.slice(0, start);
        const lead = !replaceSelection && before && !/\s$/.test(before) && !/^[\s,.!?;:]/.test(value) ? " " : "";
        // …and between the new text and what follows the cursor.
        const after = el.value.slice(end);
        const trail = !replaceSelection && after && !/^[\s,.!?;:]/.test(after) && !/\s$/.test(value) ? " " : "";
        const typed = lead + value + trail;
        if (!document.execCommand("insertText", false, typed)) {
          el.setRangeText(typed, start, end, "end");
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: typed }));
        }
      } else {
        const sel = window.getSelection();
        if (target.range && sel) {
          sel.removeAllRanges();
          const r = target.range;
          if (!replaceSelection) r.collapse(false);
          sel.addRange(r);
        }
        const lines = value.split("\n");
        let ok = true;
        lines.forEach((line, i) => {
          if (i > 0) ok = document.execCommand("insertLineBreak") && ok;
          if (line) ok = document.execCommand("insertText", false, line) && ok;
        });
        if (!ok) return copy(text);
      }
      return { ok: true, method: "typed" };
    } catch {
      return copy(text);
    }
  }
  function copy(text: string): InsertResult {
    try {
      void navigator.clipboard.writeText(text);
      return { ok: true, method: "copied" };
    } catch {
      return { ok: false, method: "none" };
    }
  }

  // ── The pill ───────────────────────────────────────────────────────────────
  function ensurePill(): ShadowRoot {
    if (root && host?.isConnected) return root;
    host = document.createElement("div");
    host.setAttribute("data-prodli-dictation", "");
    host.style.cssText = "all: initial; position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .pill { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; background: #111; color: #fff; border: 2px solid #FFD700;
          border-radius: 999px; box-shadow: 4px 4px 0 #000; font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: min(560px, 90vw); }
        .bars { display: flex; gap: 2px; align-items: center; height: 18px; }
        .bars span { width: 3px; height: 4px; background: #FFD700; border-radius: 2px; transition: height 80ms linear; }
        .msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hint { opacity: .75; font-weight: 500; font-size: 12px; white-space: nowrap; }
        button { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; }
        button.ok { background: #FFD700; color: #000; }
        button.x { background: #333; color: #fff; }
        button:focus-visible { outline: 2px solid #fff; }
        .spin { width: 14px; height: 14px; border: 2px solid #FFD70055; border-top-color: #FFD700; border-radius: 50%; animation: s .8s linear infinite; }
        @keyframes s { to { transform: rotate(360deg); } }
        .logo { width: 14px; height: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; flex-shrink: 0; }
        .logo i { display: block; } .logo i:nth-child(1){background:#FFD700}.logo i:nth-child(2){background:#00BCD4}.logo i:nth-child(3){background:#FF6B6B}.logo i:nth-child(4){background:#66BB6A}
      </style>
      <div class="pill" role="status" aria-live="polite"></div>`;
    document.documentElement.appendChild(host);
    return root;
  }
  function render(state: PillState): void {
    clearTimeout(hideTimer);
    const r = ensurePill();
    const pill = r.querySelector(".pill") as HTMLDivElement;
    pill.textContent = "";
    const logo = document.createElement("span");
    logo.className = "logo";
    logo.innerHTML = "<i></i><i></i><i></i><i></i>";
    pill.append(logo);
    bars = [];
    if (state.phase === "listening") {
      const b = document.createElement("span");
      b.className = "bars";
      for (let i = 0; i < 7; i++) {
        const s = document.createElement("span");
        b.append(s);
        bars.push(s);
      }
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = state.command ? "Say how to change the selection…" : "Listening…";
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = state.hold ? `Release to finish · Esc cancels` : `${state.shortcut} or ✓ to finish · Esc cancels`;
      const ok = button("ok", "✓", "Finish dictation", () => send({ target: "background-dictate", type: "finish" }));
      const x = button("x", "✕", "Cancel dictation", () => send({ target: "background-dictate", type: "cancel" }));
      pill.append(b, msg, hint, ok, x);
    } else if (state.phase === "working") {
      const spin = document.createElement("span");
      spin.className = "spin";
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = state.command ? "Editing…" : "Writing…";
      pill.append(spin, msg);
    } else {
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = state.message;
      pill.append(msg);
      if (state.phase === "error") pill.append(button("x", "✕", "Close", () => hide(0)));
    }
  }
  function button(cls: string, label: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.title = aria;
    // Don't take focus from the field.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }
  function level(v: number): void {
    const n = bars.length;
    bars.forEach((b, i) => {
      const shape = 1 - Math.abs(i - (n - 1) / 2) / n;
      const jitter = 0.75 + Math.random() * 0.5;
      b.style.height = `${Math.max(4, Math.round(18 * Math.min(1, v * shape * jitter * 1.6)))}px`;
    });
  }
  function hide(delay: number): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      host?.remove();
      host = null;
      root = null;
      bars = [];
      session = "";
    }, delay);
  }

  // Esc cancels; releasing the shortcut after holding it finishes (push-to-talk).
  window.addEventListener(
    "keydown",
    (e) => {
      if (session && host && e.key === "Escape" && bars.length) {
        e.preventDefault();
        e.stopPropagation();
        send({ target: "background-dictate", type: "cancel" });
      }
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (!session || !hold || !bars.length) return;
      if (e.key === "Alt" || e.key === "Shift" || e.code === "KeyD") {
        const heldMs = performance.now() - startedAt;
        if (heldMs > 600) send({ target: "background-dictate", type: "finish", heldMs });
      }
    },
    true,
  );

  chrome.runtime.onMessage.addListener((msg: ToPill, _sender, sendResponse) => {
    if (msg?.target !== "dictate-pill") return undefined;
    if (isExtensionPage && msg.tabId !== undefined && msg.tabId !== myTabId) return undefined;
    if (msg.type === "start") {
      // Only the frame the user is typing in answers (every frame gets the message).
      if (!document.hasFocus() && !isExtensionPage && !msg.force) return undefined;
      session = msg.session;
      startedAt = performance.now();
      hold = msg.state.phase === "listening" && msg.state.hold;
      const info = capture();
      // In ProdLi itself with no text field focused, the shortcut opens 🎙 Speak tasks
      // (the brain dump becomes to-dos). Same event as lib/voiceTasks.ts VOICE_TASKS_EVENT.
      if (isExtensionPage && !info.editable && msg.state.phase === "listening") {
        window.dispatchEvent(new CustomEvent("prodli-voice-tasks", { detail: { listen: true } }));
        sendResponse({ ...info, handoff: "voice-tasks" } satisfies FieldInfo);
        return undefined;
      }
      render(msg.state.phase === "listening" ? { ...msg.state, command: !!info.selection.trim() && info.editable } : msg.state);
      sendResponse(info);
      return undefined;
    }
    if (msg.session !== session) return undefined;
    if (msg.type === "state") {
      if (msg.state.phase === "listening") hold = msg.state.hold;
      render(msg.state);
    } else if (msg.type === "level") level(msg.level);
    else if (msg.type === "insert") {
      sendResponse(insert(msg.text, msg.replaceSelection));
      return undefined;
    } else if (msg.type === "end") hide(msg.delayMs);
    return undefined;
  });
}
