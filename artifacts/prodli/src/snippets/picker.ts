// "Insert a snippet", in the page: a small searchable list next to the text box
// the user is in; Enter (or a click) types the snippet into it. Injected with
// chrome.scripting into the active tab (right-click → Insert a ProdLi snippet,
// or the shortcut set in chrome://extensions/shortcuts). Only the frame with a
// focused field answers. Must stay self-contained: type-only imports.

import type { PickerOpened, PickerSnippet, ToPicker } from "./messages";

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const w = window as unknown as { __prodliSnippetPicker?: boolean };
if (!w.__prodliSnippetPicker) {
  w.__prodliSnippetPicker = true;
  install();
}

function install(): void {
  let host: HTMLDivElement | null = null;
  let el: Editable | null = null;
  let start: number | null = null;
  let end: number | null = null;
  let range: Range | null = null;

  function deepActive(): Element | null {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", ""]);
  function editableOf(x: Element | null): Editable | null {
    if (!x) return null;
    if (x instanceof HTMLTextAreaElement) return x.readOnly || x.disabled ? null : x;
    if (x instanceof HTMLInputElement) return TEXT_TYPES.has(x.type) && !x.readOnly && !x.disabled ? x : null;
    if (x instanceof HTMLElement && x.isContentEditable) {
      let h: HTMLElement = x;
      while (h.parentElement?.isContentEditable) h = h.parentElement;
      return h;
    }
    return null;
  }
  function remember(): boolean {
    el = editableOf(deepActive());
    start = end = null;
    range = null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      start = el.selectionStart;
      end = el.selectionEnd;
    } else if (el) {
      const sel = window.getSelection();
      if (sel?.rangeCount) range = sel.getRangeAt(0).cloneRange();
    }
    return !!el;
  }

  function insert(text: string): "typed" | "copied" {
    if (!el || !el.isConnected) return copy(text);
    const value = el instanceof HTMLInputElement ? text.replace(/\s*\n+\s*/g, " ") : text;
    try {
      el.focus({ preventScroll: true });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const s = start ?? el.value.length;
        const e = end ?? s;
        el.setSelectionRange(s, e);
        if (!document.execCommand("insertText", false, value)) {
          el.setRangeText(value, s, e, "end");
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        }
      } else {
        const sel = window.getSelection();
        if (range && sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let ok = true;
        value.split("\n").forEach((line, i) => {
          if (i > 0) ok = document.execCommand("insertLineBreak") && ok;
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

  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
  function filter(list: PickerSnippet[], q: string): PickerSnippet[] {
    const n = norm(q);
    if (!n) return list;
    const score = (s: PickerSnippet) => {
      const cue = norm(s.cue);
      if (cue.startsWith(n)) return 0;
      if (cue.split(/\s+/).some((x) => x.startsWith(n))) return 1;
      if (cue.includes(n)) return 2;
      if (norm(s.text).includes(n)) return 3;
      return 9;
    };
    return list.map((s, i) => ({ s, i, sc: score(s) })).filter((x) => x.sc < 9).sort((a, b) => a.sc - b.sc || a.i - b.i).map((x) => x.s);
  }

  function close(refocus: boolean): void {
    host?.remove();
    host = null;
    if (!refocus || !el?.isConnected) return;
    // Back where the cursor was.
    el.focus({ preventScroll: true });
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && start !== null) el.setSelectionRange(start, end ?? start);
    else if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  function open(snippets: PickerSnippet[]): void {
    close(false);
    host = document.createElement("div");
    host.setAttribute("data-prodli-snippets", "");
    // Next to the field (below it, or above when there's no room), else bottom centre.
    const r = el?.getBoundingClientRect();
    const W = Math.min(360, window.innerWidth - 16);
    const H = 300;
    let left = r ? Math.min(Math.max(8, r.left), window.innerWidth - W - 8) : (window.innerWidth - W) / 2;
    let top = r ? (r.bottom + 6 + H < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - H - 6)) : window.innerHeight - H - 24;
    if (!Number.isFinite(left)) left = 8;
    if (!Number.isFinite(top)) top = 8;
    host.style.cssText = `all: initial; position: fixed; left: ${left}px; top: ${top}px; width: ${W}px; z-index: 2147483647;`;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .box { background: #FFF8E7; color: #000; border: 3px solid #000; box-shadow: 5px 5px 0 #FFD700; font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 2px solid #000; background: #FFD700; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
        input { all: unset; box-sizing: border-box; width: 100%; padding: 8px 10px; border-bottom: 2px solid #000; font-size: 14px; background: #fff; }
        ul { list-style: none; margin: 0; padding: 4px; max-height: 210px; overflow-y: auto; }
        li { padding: 7px 8px; cursor: pointer; display: grid; gap: 2px; }
        li[aria-selected="true"] { background: #000; color: #FFD700; }
        .cue { font-weight: 800; }
        .text { font-size: 12px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .empty { padding: 10px; font-size: 12px; opacity: .8; }
        .foot { padding: 5px 8px; border-top: 2px solid #000; font-size: 11px; opacity: .75; }
        .logo { width: 12px; height: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; }
        .logo i { display: block; } .logo i:nth-child(1){background:#000}.logo i:nth-child(2){background:#00BCD4}.logo i:nth-child(3){background:#FF6B6B}.logo i:nth-child(4){background:#66BB6A}
      </style>
      <div class="box" role="dialog" aria-label="Insert a ProdLi snippet">
        <div class="head"><span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Insert a snippet</div>
        <input type="text" placeholder="Search snippets…" aria-label="Search snippets" role="combobox" aria-expanded="true" aria-controls="list" autocomplete="off" spellcheck="false" />
        <ul id="list" role="listbox"></ul>
        <div class="foot">↑↓ choose · Enter insert · Esc close</div>
      </div>`;
    document.documentElement.appendChild(host);
    const input = root.querySelector("input")!;
    const list = root.querySelector("ul")!;
    let shown: PickerSnippet[] = [];
    let active = 0;

    const choose = (s: PickerSnippet | undefined) => {
      if (!s) return;
      close(false);
      const how = insert(s.text);
      if (how === "copied") toast(`Copied “${s.cue}”. Paste it with ${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}V.`);
    };
    const render = () => {
      shown = filter(snippets, input.value);
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren();
      if (!snippets.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No snippets yet. Add them in ProdLi: Settings → Dictation → Snippets.";
        list.append(li);
        return;
      }
      if (!shown.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Nothing matches.";
        list.append(li);
        return;
      }
      shown.forEach((s, i) => {
        const li = document.createElement("li");
        li.id = `opt-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        const cue = document.createElement("span");
        cue.className = "cue";
        cue.textContent = s.cue;
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = s.text.replace(/\s+/g, " ");
        li.append(cue, text);
        li.addEventListener("mousedown", (e) => e.preventDefault());
        li.addEventListener("click", () => choose(s));
        li.addEventListener("mouseenter", () => {
          active = i;
          list.querySelectorAll("li").forEach((x, j) => x.setAttribute("aria-selected", String(j === i)));
        });
        list.append(li);
      });
      input.setAttribute("aria-activedescendant", `opt-${active}`);
      list.querySelector(`#opt-${active}`)?.scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("input", () => {
      active = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, shown.length - 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(shown[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    });
    // Clicking elsewhere closes it.
    const outside = (e: MouseEvent) => {
      if (host && !e.composedPath().includes(host)) {
        document.removeEventListener("mousedown", outside, true);
        close(false);
      }
    };
    document.addEventListener("mousedown", outside, true);
    render();
    input.focus({ preventScroll: true });
  }

  function toast(message: string): void {
    const t = document.createElement("div");
    t.setAttribute("data-prodli-snippets-toast", "");
    t.style.cssText = "all: initial; position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; background: #111; color: #FFD700; border: 2px solid #FFD700; padding: 8px 14px; font: 700 13px system-ui, sans-serif;";
    t.setAttribute("role", "status");
    t.textContent = message;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  chrome.runtime.onMessage.addListener((msg: ToPicker, _sender, reply: (r: PickerOpened) => void) => {
    if (msg?.target !== "snippet-picker" || msg.type !== "open") return undefined;
    if (msg.mode === "top" && window !== window.top) return undefined;
    const editable = remember();
    // Sent to every frame: only the one the user is typing in answers.
    if (msg.mode === "focused" && (!editable || !document.hasFocus())) return undefined;
    open(msg.snippets);
    reply({ editable });
    return undefined;
  });
}
