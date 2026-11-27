// Writing check, in the page you're typing in: underlines mistakes as you
// type, a card with the fix (one click to accept), and a small badge with the
// count, "Fix all", rewrites (shorter, clearer, more formal, friendlier) and
// "Turn off on this site".
//
// Injected into the tab on demand (right-click → Check writing with ProdLi, or
// its shortcut), or on every site when the user turned that on (an optional
// permission). It never changes the page's markup: underlines are drawn with
// the CSS Custom Highlight API (rich editors such as Gmail) or a see-through
// copy of the text laid over the box (textarea and input). Fixes are typed
// with execCommand("insertText"), so undo works and the site notices.
//
// Skips passwords, card and one-time-code fields, code editors and fields the
// site marked spellcheck="false". Must stay self-contained (bundled alone).

import { applyAll, dismissKey, filterIssues, looksEnglish, paragraphKey, shiftIssues, splitParagraphs, type Paragraph } from "./text";
import { checkOnDevice, onDeviceState } from "./onDevice";
import { DEFAULT_WRITING_SETTINGS, ISSUE_GROUP, ISSUE_LABEL, REWRITE_ACTIONS, REWRITE_LABEL, WRITING_SETTINGS_KEY } from "./constants";
import type {
  CheckError,
  CheckIssue,
  CheckReply,
  RewriteAction,
  RewriteReply,
  ToWritingBackground,
  ToWritingPage,
  WritingSettings,
} from "./types";

type Field = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
/** An issue placed in the field's whole text. */
interface Placed extends CheckIssue {
  abs: number;
  absEnd: number;
  key: string;
}

const COLORS = { correct: "#E5484D", clear: "#3B82F6", tone: "#A855F7" } as const;
const TYPING_PAUSE_MS = 1200;
const OTHER_PARAGRAPHS_MS = 500;

const w = window as unknown as { __prodliWritingCheck?: boolean };
if (!w.__prodliWritingCheck) {
  w.__prodliWritingCheck = true;
  install();
}

function install(): void {
  let active = false;
  let settings: WritingSettings = DEFAULT_WRITING_SETTINGS;
  let onDevice = false;
  const host = location.hostname;
  /** Checked paragraphs (by text + settings) → their issues. */
  const results = new Map<string, CheckIssue[]>();
  const inFlight = new Set<string>();
  const dismissed = new Set<string>();
  let lastError: { error: CheckError; message: string; at: number } | null = null;
  let usage: { used: number; limit: number } | null = null;

  let field: Field | null = null;
  let placed: Placed[] = [];
  let checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = <T>(msg: ToWritingBackground) => chrome.runtime.sendMessage(msg) as Promise<T>;

  // ── Settings ────────────────────────────────────────────────────────────────
  const loadSettings = async () => {
    const r = await chrome.storage.local.get(WRITING_SETTINGS_KEY).catch(() => ({}) as Record<string, unknown>);
    settings = { ...DEFAULT_WRITING_SETTINGS, ...((r[WRITING_SETTINGS_KEY] as Partial<WritingSettings> | undefined) ?? {}) };
    onDevice = settings.onDevice && (await onDeviceState()) === "available";
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[WRITING_SETTINGS_KEY]) return;
    void loadSettings().then(() => {
      if (settings.offSites.includes(host)) return stop();
      if (field) render();
    });
  });

  chrome.runtime.onMessage.addListener((msg: ToWritingPage) => {
    if (msg?.target !== "writing-page") return;
    if (msg.type === "start") void start(true);
    if (msg.type === "stop") stop();
  });

  async function start(explicit: boolean): Promise<void> {
    await loadSettings();
    if (!explicit && (!settings.everywhere || settings.offSites.includes(host))) return;
    active = true;
    const f = fieldFrom(deepActive());
    if (f) attach(f, explicit);
  }

  function stop(): void {
    active = false;
    detach();
  }

  // ── Which fields ────────────────────────────────────────────────────────────
  function deepActive(): Element | null {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function fieldFrom(el: Element | null): Field | null {
    if (!el || !(el instanceof HTMLElement)) return null;
    if (el.closest(".cm-editor, .CodeMirror, .monaco-editor, .ace_editor, [data-prodli-writing]")) return null;
    if (el instanceof HTMLTextAreaElement) return okField(el) ? el : null;
    if (el instanceof HTMLInputElement) return (el.type === "text" || el.type === "search") && okField(el) && el.getBoundingClientRect().width >= 160 ? el : null;
    if (el.isContentEditable) {
      let root: HTMLElement = el;
      while (root.parentElement?.isContentEditable) root = root.parentElement;
      return okField(root) ? root : null;
    }
    return null;
  }

  function okField(el: HTMLElement): boolean {
    if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return false;
    if (el.getAttribute("spellcheck") === "false") return false;
    const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (/cc-|one-time-code|password|username/.test(ac)) return false;
    return true;
  }

  document.addEventListener(
    "focusin",
    () => {
      if (!active) return;
      const f = fieldFrom(deepActive());
      if (f && f !== field) attach(f, false);
    },
    true,
  );

  // ── Attaching to a field ────────────────────────────────────────────────────
  let detachers: (() => void)[] = [];

  function attach(f: Field, explicit: boolean): void {
    detach();
    field = f;
    const onInput = () => schedule(false);
    const onScroll = () => position();
    f.addEventListener("input", onInput);
    f.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    const onMove = (e: MouseEvent) => hover(e.clientX, e.clientY);
    f.addEventListener("mousemove", onMove);
    const onCaret = () => caretMoved();
    document.addEventListener("selectionchange", onCaret);
    f.addEventListener("keyup", onCaret);
    const ro = new ResizeObserver(() => position());
    ro.observe(f);
    detachers = [
      () => f.removeEventListener("input", onInput),
      () => f.removeEventListener("scroll", onScroll),
      () => window.removeEventListener("scroll", onScroll, true),
      () => window.removeEventListener("resize", onScroll),
      () => f.removeEventListener("mousemove", onMove),
      () => document.removeEventListener("selectionchange", onCaret),
      () => f.removeEventListener("keyup", onCaret),
      () => ro.disconnect(),
    ];
    ensureUi();
    schedule(true);
    if (explicit) badgeEl!.dataset.pulse = "1";
  }

  function detach(): void {
    detachers.forEach((d) => d());
    detachers = [];
    clearTimeout(timer);
    field = null;
    placed = [];
    hideCard();
    hidePanel();
    clearHighlights();
    if (mirrorHost) mirrorHost.style.display = "none";
    if (badgeEl) badgeEl.style.display = "none";
  }

  // ── Reading the text ────────────────────────────────────────────────────────
  const isPlain = (f: Field): f is HTMLTextAreaElement | HTMLInputElement => f instanceof HTMLTextAreaElement || f instanceof HTMLInputElement;
  const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER)$/;

  interface Seg {
    node: Text;
    at: number;
  }
  function readEditable(root: HTMLElement): { text: string; segs: Seg[] } {
    let text = "";
    const segs: Seg[] = [];
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          segs.push({ node: child as Text, at: text.length });
          text += (child as Text).data;
        } else if (child instanceof HTMLElement) {
          if (child.tagName === "BR") text += "\n";
          else if (child.getAttribute("contenteditable") === "false" || child.tagName === "STYLE" || child.tagName === "SCRIPT") continue;
          else {
            const block = BLOCK.test(child.tagName);
            if (block && text && !text.endsWith("\n")) text += "\n";
            walk(child);
            if (block && text && !text.endsWith("\n")) text += "\n";
          }
        }
      }
    };
    walk(root);
    return { text, segs };
  }

  function readText(): string {
    if (!field) return "";
    return isPlain(field) ? field.value : readEditable(field).text;
  }

  function rangeFor(a: number, b: number): Range | null {
    if (!field || isPlain(field)) return null;
    const { segs } = readEditable(field);
    const find = (pos: number, end: boolean) => {
      for (const s of segs) {
        const len = s.node.data.length;
        if (pos > s.at + len || pos < s.at) continue;
        if (pos === s.at + len && !end) continue;
        return { node: s.node, offset: pos - s.at };
      }
      return null;
    };
    const from = find(a, false);
    const to = find(b, true);
    if (!from || !to) return null;
    const r = document.createRange();
    r.setStart(from.node, from.offset);
    r.setEnd(to.node, to.offset);
    return r;
  }

  /** The caret's place in the field's text (or -1). */
  function caretIndex(): number {
    if (!field) return -1;
    if (isPlain(field)) return field === deepActive() ? (field.selectionStart ?? -1) : -1;
    const sel = getSelection();
    if (!sel?.rangeCount || !field.contains(sel.anchorNode)) return -1;
    const { segs } = readEditable(field);
    const seg = segs.find((s) => s.node === sel.anchorNode);
    return seg ? seg.at + sel.anchorOffset : -1;
  }

  // ── Checking ────────────────────────────────────────────────────────────────
  function schedule(now: boolean): void {
    clearTimeout(timer);
    hideCard();
    // While typing, keep the underlines in the paragraphs you aren't touching.
    render();
    timer = setTimeout(() => void run(), now ? 50 : OTHER_PARAGRAPHS_MS);
  }

  async function run(): Promise<void> {
    if (!field || !active) return;
    const text = readText();
    const paragraphs = splitParagraphs(text);
    const caret = caretIndex();
    const typingIn = paragraphs.find((p) => caret >= p.start && caret <= p.start + p.text.length);
    const want = paragraphs.filter((p) => !results.has(keyOf(p)) && !inFlight.has(keyOf(p)));
    // The paragraph you're typing in waits for a longer pause (and a finished word).
    const ready = want.filter((p) => p !== typingIn || Date.now() - lastInputAt >= TYPING_PAUSE_MS);
    if (want.length > ready.length) {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), TYPING_PAUSE_MS);
    }
    if (!ready.length) return render();
    if (lastError && (lastError.error === "signed_out" || lastError.error === "quota") && Date.now() - lastError.at < 60_000) return render();
    const batch = ready.slice(0, 16);
    batch.forEach((p) => inFlight.add(keyOf(p)));
    checking = true;
    render();
    try {
      const server: Paragraph[] = [];
      for (const p of batch) {
        if (onDevice && looksEnglish(p.text)) {
          try {
            results.set(keyOf(p), await checkOnDevice(p.text, settings.level, settings.variant));
            continue;
          } catch {
            /* fall back to ProdLi's AI */
          }
        }
        server.push(p);
      }
      if (server.length) {
        const reply = await send<CheckReply>({ target: "writing-bg", type: "check", paragraphs: server.map((p) => p.text), level: settings.level, ...(settings.variant ? { variant: settings.variant } : {}) }).catch(
          (): CheckReply => ({ ok: false, error: "offline", message: "ProdLi was updated. Reload this page to keep checking." }),
        );
        if (reply.ok) {
          server.forEach((p, i) => results.set(keyOf(p), reply.issues[i] ?? []));
          if (reply.limit !== undefined) usage = { used: reply.used ?? 0, limit: reply.limit };
          lastError = null;
        } else lastError = { ...reply, at: Date.now() };
      }
    } finally {
      batch.forEach((p) => inFlight.delete(keyOf(p)));
      checking = false;
      render();
    }
  }

  let lastInputAt = 0;
  document.addEventListener("input", () => (lastInputAt = Date.now()), true);

  const keyOf = (p: Paragraph) => paragraphKey(p.text, settings.level, settings.variant);

  function place(): Placed[] {
    const text = readText();
    const out: Placed[] = [];
    for (const p of splitParagraphs(text)) {
      const key = keyOf(p);
      for (const i of filterIssues(results.get(key) ?? [], settings.dictionary, dismissed)) {
        if (p.text.slice(i.start, i.end) !== i.original) continue;
        out.push({ ...i, abs: p.start + i.start, absEnd: p.start + i.end, key });
      }
    }
    return out;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  let mirrorHost: HTMLDivElement | null = null;
  let mirror: HTMLDivElement | null = null;
  let badgeEl: HTMLButtonElement | null = null;
  let ui: ShadowRoot | null = null;
  let cardEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let styleEl: HTMLStyleElement | null = null;

  function ensureUi(): void {
    if (ui) return;
    const hostEl = document.createElement("div");
    hostEl.setAttribute("data-prodli-writing", "");
    hostEl.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;";
    ui = hostEl.attachShadow({ mode: "open" });
    ui.innerHTML = `<style>${UI_CSS}</style>`;
    document.documentElement.appendChild(hostEl);
    mirrorHost = document.createElement("div");
    mirrorHost.className = "mirror-host";
    mirror = document.createElement("div");
    mirror.className = "mirror";
    mirrorHost.appendChild(mirror);
    ui.appendChild(mirrorHost);
    badgeEl = document.createElement("button");
    badgeEl.className = "badge";
    badgeEl.type = "button";
    badgeEl.setAttribute("aria-label", "ProdLi writing check");
    badgeEl.addEventListener("mousedown", (e) => e.preventDefault());
    badgeEl.addEventListener("click", () => (panelEl ? hidePanel() : showPanel()));
    ui.appendChild(badgeEl);
    styleEl = document.createElement("style");
    styleEl.textContent = Object.entries(COLORS)
      .map(([g, c]) => `::highlight(prodli-wc-${g}){text-decoration:underline wavy ${c};text-decoration-thickness:1.5px;text-underline-offset:3px;background-color:${c}14;}`)
      .join("");
    document.head?.appendChild(styleEl);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideCard();
        hidePanel();
      }
    });
    document.addEventListener("mousedown", (e) => {
      if (!(e.composedPath() as Node[]).includes(hostEl)) {
        hidePanel();
        if (!(e.composedPath() as Node[]).includes(field as Node)) hideCard();
      }
    });
  }

  function clearHighlights(): void {
    const hl = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    for (const g of Object.keys(COLORS)) hl?.delete(`prodli-wc-${g}`);
  }

  function render(): void {
    if (!field || !ui) return;
    placed = place();
    if (isPlain(field)) drawMirror();
    else drawHighlights();
    drawBadge();
    position();
  }

  function drawHighlights(): void {
    if (mirrorHost) mirrorHost.style.display = "none";
    const g = globalThis as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown };
    if (!g.CSS?.highlights || !g.Highlight) return;
    const groups: Record<string, Range[]> = { correct: [], clear: [], tone: [] };
    for (const p of placed) {
      const r = rangeFor(p.abs, p.absEnd);
      if (r) groups[ISSUE_GROUP[p.type]].push(r);
    }
    for (const [name, ranges] of Object.entries(groups)) {
      if (ranges.length) g.CSS.highlights.set(`prodli-wc-${name}`, new g.Highlight(...ranges));
      else g.CSS.highlights.delete(`prodli-wc-${name}`);
    }
  }

  const MIRROR_PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "textIndent", "textAlign", "direction", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"] as const;

  function drawMirror(): void {
    if (!field || !mirror || !mirrorHost || !isPlain(field)) return;
    clearHighlights();
    const cs = getComputedStyle(field);
    for (const p of MIRROR_PROPS) (mirror.style as unknown as Record<string, string>)[p] = cs[p];
    mirror.style.borderStyle = "solid";
    mirror.style.borderColor = "transparent";
    const textarea = field instanceof HTMLTextAreaElement;
    mirror.style.whiteSpace = textarea ? "pre-wrap" : "pre";
    mirror.style.overflowWrap = textarea ? "break-word" : "normal";
    const text = field.value;
    mirror.textContent = "";
    let at = 0;
    for (const p of placed) {
      if (p.abs < at) continue;
      mirror.appendChild(document.createTextNode(text.slice(at, p.abs)));
      const span = document.createElement("span");
      span.className = `u ${ISSUE_GROUP[p.type]}`;
      span.textContent = text.slice(p.abs, p.absEnd);
      span.dataset.i = String(placed.indexOf(p));
      mirror.appendChild(span);
      at = p.absEnd;
    }
    mirror.appendChild(document.createTextNode(text.slice(at) + (textarea ? "\n" : "")));
    mirrorHost.style.display = placed.length ? "block" : "none";
  }

  function position(): void {
    if (!field || !ui) return;
    const r = field.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    if (mirrorHost && mirror && isPlain(field)) {
      mirrorHost.style.cssText = `display:${visible && placed.length ? "block" : "none"};left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
      const borders = parseFloat(getComputedStyle(field).borderLeftWidth) + parseFloat(getComputedStyle(field).borderRightWidth);
      mirror.style.width = `${field.clientWidth + borders}px`;
      mirror.style.height = `${r.height}px`;
      mirror.scrollTop = field.scrollTop;
      mirror.scrollLeft = field.scrollLeft;
    }
    if (badgeEl) {
      badgeEl.style.display = visible ? "flex" : "none";
      const bottom = Math.min(r.bottom, innerHeight) - 30;
      badgeEl.style.left = `${Math.max(4, r.right - 32)}px`;
      badgeEl.style.top = `${Math.max(r.top + 2, bottom)}px`;
    }
    if (panelEl) placePanel();
  }

  function drawBadge(): void {
    if (!badgeEl) return;
    const mistakes = placed.filter((p) => ISSUE_GROUP[p.type] === "correct").length;
    const n = placed.length;
    badgeEl.className = `badge ${checking ? "busy" : lastError ? "err" : n === 0 ? "ok" : mistakes ? "correct" : "clear"}`;
    badgeEl.textContent = checking && !n ? "…" : lastError && !n ? "!" : n ? String(Math.min(n, 99)) : "✓";
    badgeEl.title = lastError ? lastError.message : n ? `${n} suggestion${n === 1 ? "" : "s"}: click to see them` : "ProdLi writing check: no suggestions";
  }

  // ── The suggestion card ─────────────────────────────────────────────────────
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: Placed | null = null;

  function rectsOf(p: Placed): DOMRect[] {
    if (!field) return [];
    if (isPlain(field)) {
      const span = mirror?.querySelector<HTMLElement>(`span[data-i="${placed.indexOf(p)}"]`);
      return span ? Array.from(span.getClientRects()) : [];
    }
    const r = rangeFor(p.abs, p.absEnd);
    return r ? Array.from(r.getClientRects()) : [];
  }

  function hover(x: number, y: number): void {
    clearTimeout(hoverTimer);
    const hit = placed.find((p) => rectsOf(p).some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 2 && y <= r.bottom + 4));
    if (!hit) return;
    if (shown && dismissKey(shown) === dismissKey(hit) && shown.abs === hit.abs) return;
    hoverTimer = setTimeout(() => showCard(hit), 250);
  }

  function caretMoved(): void {
    const c = caretIndex();
    if (c < 0) return;
    const hit = placed.find((p) => c > p.abs && c < p.absEnd);
    if (hit) showCard(hit);
  }

  function showCard(p: Placed): void {
    if (!ui) return;
    hidePanel();
    hideCard();
    shown = p;
    const rect = rectsOf(p)[0];
    if (!rect) return;
    const group = ISSUE_GROUP[p.type];
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Writing suggestion");
    const head = el("div", "card-head");
    head.append(el("span", `dot ${group}`), el("span", "card-kind", ISSUE_LABEL[p.type]), el("span", "brand", "ProdLi"));
    const fix = el("button", "fix", "");
    fix.setAttribute("data-action", "accept");
    if (p.original.trim()) fix.append(el("s", "", p.original));
    fix.append(el("span", "arrow", "→"), el("strong", "", p.replacement || "(remove)"));
    fix.addEventListener("click", () => accept(p));
    card.append(head, fix);
    if (p.explanation) card.append(el("p", "why", p.explanation));
    const row = el("div", "row");
    const dismiss = el("button", "link", "Dismiss");
    dismiss.addEventListener("click", () => {
      dismissed.add(dismissKey(p));
      hideCard();
      render();
    });
    row.append(dismiss);
    if (p.type === "spelling") {
      const add = el("button", "link", "Add to dictionary");
      add.addEventListener("click", () => {
        settings = { ...settings, dictionary: [...settings.dictionary, p.original.trim()] };
        void send({ target: "writing-bg", type: "add-word", word: p.original });
        hideCard();
        render();
      });
      row.append(add);
    }
    card.append(row);
    for (const b of Array.from(card.querySelectorAll("button"))) b.addEventListener("mousedown", (e) => e.preventDefault());
    card.addEventListener("mouseleave", () => (hoverTimer = setTimeout(hideCard, 400)));
    card.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
    ui.appendChild(card);
    cardEl = card;
    const top = rect.bottom + 6 + card.offsetHeight > innerHeight ? rect.top - card.offsetHeight - 6 : rect.bottom + 6;
    card.style.left = `${Math.min(Math.max(8, rect.left), innerWidth - card.offsetWidth - 8)}px`;
    card.style.top = `${Math.max(8, top)}px`;
  }

  function hideCard(): void {
    cardEl?.remove();
    cardEl = null;
    shown = null;
  }

  // ── Applying fixes ──────────────────────────────────────────────────────────
  /** Replaces [a, b) in the field with `text` as if typed (undo works, the site notices). */
  function replaceRange(a: number, b: number, text: string): boolean {
    if (!field) return false;
    field.focus();
    if (isPlain(field)) {
      field.setSelectionRange(a, b);
      if (document.execCommand("insertText", false, text)) return true;
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, field.value.slice(0, a) + text + field.value.slice(b));
      field.setSelectionRange(a + text.length, a + text.length);
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }
    const r = rangeFor(a, b);
    if (!r) return false;
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    const lines = text.split("\n");
    let ok = true;
    lines.forEach((line, i) => {
      if (i > 0) ok = document.execCommand("insertLineBreak") && ok;
      if (line) ok = document.execCommand("insertText", false, line) && ok;
    });
    if (!text) ok = document.execCommand("delete") && ok;
    return ok;
  }

  /** Accepts one suggestion and keeps the paragraph's other suggestions without checking it again. */
  function accept(p: Placed): void {
    hideCard();
    const before = readText();
    const para = splitParagraphs(before).find((q) => keyOf(q) === p.key);
    if (!replaceRange(p.abs, p.absEnd, p.replacement)) return;
    if (para) {
      const local = { start: p.abs - para.start, end: p.absEnd - para.start };
      const newText = para.text.slice(0, local.start) + p.replacement + para.text.slice(local.end);
      const rest = shiftIssues(results.get(p.key) ?? [], local.start, local.end, p.replacement.length - (local.end - local.start));
      results.set(paragraphKey(newText, settings.level, settings.variant), rest);
    }
    render();
  }

  function fixAll(): void {
    const byPara = new Map<string, Placed[]>();
    for (const p of placed) byPara.set(p.key, [...(byPara.get(p.key) ?? []), p]);
    // From the end of the text, so earlier offsets stay right.
    const paras = splitParagraphs(readText()).filter((q) => byPara.has(keyOf(q))).reverse();
    for (const q of paras) {
      const issues = (byPara.get(keyOf(q)) ?? []).map((p) => ({ ...p, start: p.abs - q.start, end: p.absEnd - q.start }));
      const fixed = applyAll(q.text, issues);
      if (fixed === q.text) continue;
      if (replaceRange(q.start, q.start + q.text.length, fixed)) results.set(paragraphKey(fixed, settings.level, settings.variant), []);
    }
    hidePanel();
    render();
  }

  // ── The panel (badge click) ─────────────────────────────────────────────────
  function showPanel(): void {
    if (!ui || !field) return;
    hideCard();
    hidePanel();
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "ProdLi writing check");
    const head = el("div", "panel-head");
    head.append(el("strong", "", "Writing check"), el("span", "engine", onDevice ? "On this computer" : usage ? `ProdLi AI · ${Math.max(0, usage.limit - usage.used)} checks left` : "ProdLi AI"));
    panel.append(head);
    if (lastError) {
      const box = el("div", "error", lastError.message);
      if (lastError.error === "signed_out" || lastError.error === "quota") {
        const go = el("button", "primary", lastError.error === "signed_out" ? "Open ProdLi to sign in" : "See plans");
        go.addEventListener("click", () => void send({ target: "writing-bg", type: "open-settings" }));
        box.append(go);
      }
      panel.append(box);
    }
    if (placed.length) {
      const list = el("div", "list");
      for (const p of placed.slice(0, 12)) {
        const item = el("button", "item", "");
        item.append(el("span", `dot ${ISSUE_GROUP[p.type]}`));
        if (p.original.trim()) item.append(el("s", "", p.original));
        item.append(el("span", "arrow", "→"), el("strong", "", p.replacement || "(remove)"));
        item.title = p.explanation;
        item.addEventListener("click", () => {
          accept(p);
          showPanel();
        });
        list.append(item);
      }
      panel.append(list);
      const all = el("button", "primary wide", `Fix all (${placed.length})`);
      all.setAttribute("data-action", "fix-all");
      all.addEventListener("click", fixAll);
      panel.append(all);
    } else if (!lastError) panel.append(el("p", "quiet", checking ? "Checking…" : "Nothing to fix here."));
    const rw = el("div", "rewrite");
    rw.append(el("span", "label", "Rewrite"));
    for (const a of REWRITE_ACTIONS) {
      const b = el("button", "chip", REWRITE_LABEL[a]);
      b.addEventListener("click", () => void rewrite(a, panel));
      rw.append(b);
    }
    panel.append(rw);
    const foot = el("div", "foot");
    const off = el("button", "link", "Turn off on this site");
    off.addEventListener("click", () => {
      void send({ target: "writing-bg", type: "site-off", host });
      stop();
    });
    const set = el("button", "link", "Settings");
    set.addEventListener("click", () => void send({ target: "writing-bg", type: "open-settings" }));
    foot.append(off, set);
    panel.append(foot);
    for (const b of Array.from(panel.querySelectorAll("button"))) b.addEventListener("mousedown", (e) => e.preventDefault());
    ui.appendChild(panel);
    panelEl = panel;
    placePanel();
  }

  function placePanel(): void {
    if (!panelEl || !badgeEl) return;
    const b = badgeEl.getBoundingClientRect();
    const h = panelEl.offsetHeight;
    panelEl.style.left = `${Math.max(8, Math.min(b.right - panelEl.offsetWidth, innerWidth - panelEl.offsetWidth - 8))}px`;
    panelEl.style.top = `${b.top - h - 8 >= 8 ? b.top - h - 8 : Math.min(b.bottom + 8, innerHeight - h - 8)}px`;
  }

  function hidePanel(): void {
    panelEl?.remove();
    panelEl = null;
  }

  /** Rewrites the selected text in the field, or all of it, and offers to replace it. */
  async function rewrite(action: RewriteAction, panel: HTMLElement): Promise<void> {
    if (!field) return;
    const text = readText();
    let a = 0;
    let b = text.length;
    if (isPlain(field) && field.selectionStart !== null && field.selectionEnd !== null && field.selectionEnd > field.selectionStart) {
      a = field.selectionStart;
      b = field.selectionEnd;
    } else if (!isPlain(field)) {
      const sel = getSelection();
      if (sel?.rangeCount && !sel.isCollapsed && field.contains(sel.anchorNode)) {
        const { segs } = readEditable(field);
        const r = sel.getRangeAt(0);
        const sa = segs.find((s) => s.node === r.startContainer);
        const sb = segs.find((s) => s.node === r.endContainer);
        if (sa && sb) {
          a = sa.at + r.startOffset;
          b = sb.at + r.endOffset;
        }
      }
    }
    const source = text.slice(a, b);
    if (!source.trim()) return;
    const box = el("div", "result", "Rewriting…");
    panel.querySelector(".result")?.remove();
    panel.insertBefore(box, panel.querySelector(".foot"));
    placePanel();
    const reply = await send<RewriteReply>({ target: "writing-bg", type: "rewrite", text: source, action }).catch((): RewriteReply => ({ ok: false, error: "offline", message: "Couldn't reach ProdLi. Reload the page and try again." }));
    box.textContent = "";
    if (!reply.ok) {
      box.append(el("p", "error", reply.message));
      return placePanel();
    }
    const out = reply.text.replace(/\*\*(.+?)\*\*/g, "$1");
    box.append(el("div", "preview", out));
    const row = el("div", "row");
    const use = el("button", "primary", "Replace");
    use.setAttribute("data-action", "replace");
    use.addEventListener("mousedown", (e) => e.preventDefault());
    use.addEventListener("click", () => {
      if (readText().slice(a, b) === source) replaceRange(a, b, out);
      hidePanel();
      schedule(true);
    });
    const copy = el("button", "link", "Copy");
    copy.addEventListener("mousedown", (e) => e.preventDefault());
    copy.addEventListener("click", () => void navigator.clipboard.writeText(out));
    row.append(use, copy);
    box.append(row);
    placePanel();
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  // Registered for every site (Settings → Check on every site): start by itself.
  void start(false);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (e instanceof HTMLButtonElement) e.type = "button";
  return e;
}

const UI_CSS = `
:host { all: initial; }
.card, .card *, .panel, .panel *, .badge { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
/* The see-through copy must use exactly the text box's font, or underlines drift. */
.mirror * { font: inherit; letter-spacing: inherit; word-spacing: inherit; }
.mirror-host { position: fixed; pointer-events: none; overflow: hidden; display: none; }
.mirror { position: absolute; left: 0; top: 0; overflow: hidden; color: transparent; margin: 0; }
.u { text-decoration: underline wavy; text-decoration-thickness: 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.u.correct { text-decoration-color: ${COLORS.correct}; background: ${COLORS.correct}14; }
.u.clear { text-decoration-color: ${COLORS.clear}; background: ${COLORS.clear}14; }
.u.tone { text-decoration-color: ${COLORS.tone}; background: ${COLORS.tone}14; }
.badge { position: fixed; display: none; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; border: 2px solid #000; font: 800 12px/1 -apple-system, sans-serif; cursor: pointer; color: #000; box-shadow: 2px 2px 0 #000; transition: transform .1s; }
.badge:hover { transform: translateY(-1px); }
.badge.ok { background: #fff; color: #16A34A; }
.badge.correct { background: ${COLORS.correct}; color: #fff; }
.badge.clear { background: ${COLORS.clear}; color: #fff; }
.badge.busy { background: #FFD700; }
.badge.err { background: #FFF3B0; }
.badge[data-pulse="1"] { animation: pulse 1s ease 2; }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px #FFD70088; } }
.card, .panel { position: fixed; background: #fff; color: #111; border: 2px solid #000; box-shadow: 4px 4px 0 #000; font-size: 13px; line-height: 1.4; }
.card { width: 290px; padding: 10px 12px; }
.panel { width: 320px; max-height: 70vh; overflow: auto; padding: 10px 12px; }
.card-head, .panel-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.card-kind { font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.brand, .engine { margin-left: auto; font-size: 11px; font-weight: 700; opacity: .55; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dot.correct { background: ${COLORS.correct}; } .dot.clear { background: ${COLORS.clear}; } .dot.tone { background: ${COLORS.tone}; }
.fix, .item { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 2px solid #000; background: #FFD700; color: #000; padding: 7px 9px; font-size: 14px; cursor: pointer; flex-wrap: wrap; }
.fix:hover, .item:hover { background: #FFE34D; }
.item { background: #fff; font-size: 13px; border-width: 1px; margin-bottom: 4px; }
.item:hover { background: #FFF7CC; }
s { color: #9B1C1C; opacity: .8; }
.arrow { opacity: .5; }
.why { margin: 8px 0 2px; color: #333; }
.row { display: flex; gap: 12px; margin-top: 8px; align-items: center; }
.link { border: none; background: none; padding: 0; color: #111; font-size: 12px; font-weight: 700; text-decoration: underline; cursor: pointer; }
.primary { border: 2px solid #000; background: #FFD700; color: #000; font-weight: 800; font-size: 12px; padding: 6px 12px; cursor: pointer; box-shadow: 2px 2px 0 #000; }
.wide { width: 100%; margin-top: 4px; }
.rewrite { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd; }
.label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; opacity: .6; margin-right: 2px; }
.chip { border: 1px solid #000; background: #fff; color: #000; font-size: 12px; font-weight: 700; padding: 3px 8px; cursor: pointer; }
.chip:hover { background: #FFF7CC; }
.result { margin-top: 8px; font-size: 13px; }
.preview { white-space: pre-wrap; border: 1px dashed #999; padding: 8px; max-height: 200px; overflow: auto; background: #FAFAF7; }
.error { background: #FFF3B0; border: 1px solid #000; padding: 8px; margin-bottom: 8px; display: grid; gap: 8px; }
.quiet { opacity: .7; margin: 4px 0; }
.foot { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd; }
@media (prefers-color-scheme: dark) {
  .card, .panel { background: #1b1d22; color: #eee; border-color: #FFD700; box-shadow: 4px 4px 0 #FFD700; }
  .why, .link { color: #ddd; } .item, .chip { background: #24262c; color: #eee; border-color: #555; }
  .item:hover, .chip:hover { background: #33352c; } .preview { background: #24262c; border-color: #555; }
  s { color: #FCA5A5; } .error { background: #4a4316; color: #eee; }
}
`;
