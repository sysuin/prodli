// Content script injected into meet.google.com while a recording is running.
//
// It reads Google Meet's live captions (speaker name + text) to build the
// transcript. Optionally (Meetings → Setup) it shows a small "recording" label
// that only the person recording can see; Chrome's own tab-capture dot and the
// REC badge on the ProdLi icon show it's recording either way.
// Captions are a per-viewer setting in Meet: turning them on is not shown to
// other participants.
//
// IMPORTANT: this file is injected as a classic script — keep it self-contained.
// Only `import type` is allowed (types are erased at build time).

import type { BackgroundMessage, ContentCommand, TranscriptEntry } from "./types";

(() => {
  const w = window as unknown as { __prodliCaptions?: boolean };
  if (w.__prodliCaptions) return;
  w.__prodliCaptions = true;

  const SEND_EVERY_MS = 3_000;
  /** Give Meet this long to show captions (ProdLi turns them on) before warning. */
  const CAPTIONS_GRACE_MS = 15_000;
  const SCAN_EVERY_MS = 1_000;

  let meetingId: string | null = null;
  let startedAtMs = 0;
  let entries: TranscriptEntry[] = [];
  const entryByBlock = new WeakMap<Element, TranscriptEntry>();
  let lastSpeaker = "Unknown";
  let dirty = false;
  let captionsOn = false;
  let sawLeaveButton = false;
  let leaveMissingSince: number | null = null;
  let captionClickAttempts = 0;
  let scanTimer: number | undefined;
  let sendTimer: number | undefined;
  let badge: HTMLDivElement | null = null;
  let showIndicator = false;
  let captionsMissing = false;
  let warning: HTMLDivElement | null = null;

  // Captions panel label in Meet's UI language (en, es/pt, de, fr, it, nl, ru, tr, pl, hi, ja/zh, ko…).
  const CAPTION_REGION_LABEL = /caption|subt[ií]t|legend|untertitel|sous-titre|sottotitol|ondertitel|субтитр|altyaz|napisy|कैप्शन|字幕|자막/i;

  /**
   * Meet draws button icons with an icon font whose ligature names are the
   * same in every UI language (e.g. "call_end", "closed_caption_off").
   * Matching them makes detection work regardless of the user's language.
   */
  function hasIcon(el: Element, names: string[]): boolean {
    for (const node of el.querySelectorAll("i, span")) {
      if (node.children.length === 0 && names.includes((node.textContent ?? "").trim())) return true;
    }
    return false;
  }

  function findLeaveButton(): Element | null {
    const byLabel = document.querySelector('button[aria-label*="Leave call" i]');
    if (byLabel) return byLabel;
    for (const b of document.querySelectorAll("button")) if (hasIcon(b, ["call_end"])) return b;
    return null;
  }

  function send(msg: BackgroundMessage): void {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      // Extension was reloaded; nothing to do.
    }
  }

  function findCaptionRegion(): HTMLElement | null {
    const regions = document.querySelectorAll<HTMLElement>('[role="region"][aria-label]');
    for (const r of regions) {
      if (CAPTION_REGION_LABEL.test(r.getAttribute("aria-label") ?? "")) return r;
    }
    return null;
  }

  function tryTurnOnCaptions(): void {
    if (captionClickAttempts >= 3) return;
    for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
      const label = b.getAttribute("aria-label") ?? "";
      const englishOff = /turn on captions/i.test(label) || (/captions/i.test(label) && b.getAttribute("aria-pressed") === "false");
      // Any language: the "captions off" icon, or the captions icon on an unpressed toggle.
      const iconOff = hasIcon(b, ["closed_caption_off", "subtitles_off"]) || (hasIcon(b, ["closed_caption", "subtitles"]) && b.getAttribute("aria-pressed") === "false");
      if (englishOff || iconOff) {
        captionClickAttempts++;
        b.click();
        return;
      }
    }
  }

  function meetingTitle(): string | null {
    const t = document.title.replace(/^Meet\s*[-–—:]\s*/i, "").trim();
    return t && t.toLowerCase() !== "meet" && t.toLowerCase() !== "google meet" ? t : null;
  }

  const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

  /**
   * Merge an updated caption text into what we already have for that block.
   * While someone keeps talking, Meet shows only the last few lines of their
   * caption (older words scroll away) and keeps correcting recent words, so
   * this matches on words (ignoring case and punctuation) and never drops
   * text we already have.
   */
  function mergeText(oldText: string, newText: string): string {
    if (!oldText) return newText;
    if (newText.includes(oldText)) return newText;
    if (oldText.includes(newText)) return oldText;
    const a = words(oldText);
    const b = words(newText);
    // Same words, different punctuation/capitalisation: take the newer version.
    if (a.join(" ") === b.join(" ")) return newText;
    // The new text starts where the old one ends (earlier words scrolled away): append the rest.
    for (let n = Math.min(a.length, b.length); n >= 3; n--) {
      if (a.slice(-n).join(" ") === b.slice(0, n).join(" ")) {
        const tail = newText.split(/\s+/).slice(n).join(" ");
        return tail ? `${oldText} ${tail}` : oldText;
      }
    }
    // The new text corrects the end of the old one: keep the start, take the corrected end.
    for (let n = Math.min(a.length, b.length); n >= 3; n--) {
      const start = a.length - b.length;
      if (start >= 0 && a.slice(start, start + n).join(" ") === b.slice(0, n).join(" ")) {
        return `${oldText.split(/\s+/).slice(0, start).join(" ")} ${newText}`.trim();
      }
    }
    // Mostly the same words (Meet rewording a short caption): prefer the newer text.
    const overlap = b.filter((x) => a.includes(x)).length;
    if (b.length >= a.length * 0.6 && overlap >= a.length * 0.6) return newText;
    // Unrelated: keep both rather than lose anything.
    return `${oldText} ${newText}`;
  }

  /** Visible text of an element without buttons and icon glyphs (Meet puts controls inside the captions area). */
  function textWithoutControls(el: HTMLElement): string[] {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button, [role=button], i, svg, style, script").forEach((n) => n.remove());
    // innerText needs layout; the clone isn't attached, so use textContent per line-ish element.
    const lines: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent ?? "").trim();
        if (t) lines.push(t);
        return;
      }
      for (const c of Array.from(node.childNodes)) walk(c);
    };
    walk(clone);
    return lines;
  }

  function parseBlock(block: HTMLElement): { speaker: string; text: string } | null {
    // Meet's block: [avatar] [name] [text…]. The name is its own element, the text another.
    const lines = textWithoutControls(block);
    if (lines.length === 0) return null;
    if (lines.length === 1) return { speaker: lastSpeaker, text: lines[0] };
    return { speaker: lines[0], text: lines.slice(1).join(" ") };
  }

  /**
   * The caption blocks (one per speaker turn) inside the captions area. Meet
   * wraps them in one or more containers and adds controls (buttons) next to
   * them, so unwrap single containers and ignore anything that's only controls.
   */
  function captionBlocks(region: HTMLElement): HTMLElement[] {
    const content = (el: HTMLElement) => Array.from(el.children).filter((c) => isContent(c as HTMLElement)) as HTMLElement[];
    // A wrapper holds whole blocks (each with a name line and text); a block's own parts have one line each.
    const isWrapper = (el: HTMLElement) => {
      const inner = content(el);
      return inner.length === 1 || (inner.length > 1 && inner.every((c) => textWithoutControls(c).length >= 2));
    };
    let container: HTMLElement = region;
    for (let depth = 0; depth < 6; depth++) {
      const kids = content(container);
      if (kids.length === 1 && isWrapper(kids[0])) {
        container = kids[0];
        continue;
      }
      return kids;
    }
    return content(container);
  }

  function isContent(el: HTMLElement): boolean {
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "STYLE" || el.tagName === "SCRIPT") return false;
    return textWithoutControls(el).length > 0;
  }

  function scan(): void {
    if (!meetingId) return;
    const now = Date.now() - startedAtMs;

    // Detect leaving the call: the "leave call" button disappears (any UI language).
    const leave = findLeaveButton();
    if (leave) {
      sawLeaveButton = true;
      leaveMissingSince = null;
    } else if (sawLeaveButton) {
      leaveMissingSince ??= Date.now();
      if (Date.now() - leaveMissingSince > 5_000) {
        send({ target: "background", type: "captions-ended", meetingId, entries });
        teardown();
        return;
      }
    }

    const region = findCaptionRegion();
    if (captionsOn !== !!region) dirty = true; // tell the background (toolbar icon) right away
    captionsOn = !!region;
    const missing = !captionsOn && now > CAPTIONS_GRACE_MS;
    if (missing !== captionsMissing) {
      captionsMissing = missing;
      dirty = true;
      updateWarning();
    }
    if (!region) {
      tryTurnOnCaptions();
      updateBadge();
      return;
    }

    for (const block of captionBlocks(region)) {
      const parsed = parseBlock(block);
      if (!parsed || !parsed.text) continue;
      lastSpeaker = parsed.speaker;

      const existing = entryByBlock.get(block);
      if (existing) {
        const merged = mergeText(existing.text, parsed.text);
        if (merged !== existing.text || existing.speaker !== parsed.speaker) {
          existing.text = merged;
          existing.speaker = parsed.speaker;
          existing.endMs = now;
          dirty = true;
        }
      } else {
        const entry: TranscriptEntry = {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          speaker: parsed.speaker,
          text: parsed.text,
          startMs: now,
          endMs: now,
        };
        entries.push(entry);
        entryByBlock.set(block, entry);
        dirty = true;
      }
    }
    updateBadge();
  }

  function flush(force = false): void {
    if (!meetingId || (!dirty && !force)) return;
    dirty = false;
    send({ target: "background", type: "captions-update", meetingId, entries, captionsOn, title: meetingTitle(), captionsMissing });
  }

  function updateBadge(): void {
    if (!badge) return;
    const status = badge.querySelector<HTMLSpanElement>("[data-status]");
    if (status) {
      status.textContent = captionsOn ? "ProdLi" : "ProdLi · turn on CC";
      badge.title = captionsOn ? `ProdLi is taking notes (${entries.length} lines). Only you can see this.` : "ProdLi is recording. Turn on captions (CC) for the transcript.";
    }
  }

  /**
   * Shown in the call only when captions still aren't on after the grace
   * period, whatever the label setting: without captions there's no transcript.
   */
  function updateWarning(): void {
    if (!captionsMissing) {
      warning?.remove();
      warning = null;
      return;
    }
    if (warning) return;
    warning = document.createElement("div");
    warning.setAttribute("data-prodli-captions-warning", "");
    warning.setAttribute("role", "status");
    Object.assign(warning.style, {
      position: "fixed",
      left: "12px",
      bottom: showIndicator ? "120px" : "88px",
      zIndex: "2147483647",
      maxWidth: "320px",
      padding: "8px 12px",
      background: "#F59E0B",
      color: "#000",
      borderRadius: "10px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      font: "600 12px/1.35 system-ui, sans-serif",
    } satisfies Partial<CSSStyleDeclaration>);
    warning.textContent = "ProdLi: turn on captions (CC) so it can transcribe. Only the audio is being recorded until then. Only you can see captions and this note.";
    document.body.appendChild(warning);
  }

  function showBadge(): void {
    if (badge) return;
    badge = document.createElement("div");
    badge.setAttribute("data-prodli-badge", "");
    Object.assign(badge.style, {
      position: "fixed",
      left: "12px",
      bottom: "88px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "3px 4px 3px 8px",
      background: "rgba(0,0,0,0.75)",
      color: "#fff",
      borderRadius: "999px",
      font: "600 11px/1.2 system-ui, sans-serif",
    } satisfies Partial<CSSStyleDeclaration>);
    const dot = document.createElement("span");
    Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", background: "#E53935" });
    const status = document.createElement("span");
    status.setAttribute("data-status", "");
    const stop = document.createElement("button");
    stop.textContent = "Stop";
    Object.assign(stop.style, {
      border: "none",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.18)",
      color: "#fff",
      font: "700 10px system-ui, sans-serif",
      padding: "2px 7px",
      cursor: "pointer",
    });
    stop.addEventListener("click", () => send({ target: "background", type: "stop-recording" }));
    badge.append(dot, status, stop);
    document.body.appendChild(badge);
    updateBadge();
  }

  function begin(id: string, startMs: number, withIndicator: boolean): void {
    if (meetingId === id) return;
    meetingId = id;
    startedAtMs = startMs;
    entries = [];
    sawLeaveButton = false;
    leaveMissingSince = null;
    captionClickAttempts = 0;
    captionsMissing = false;
    showIndicator = withIndicator;
    if (showIndicator) showBadge();
    tryTurnOnCaptions();
    scanTimer = window.setInterval(scan, SCAN_EVERY_MS);
    sendTimer = window.setInterval(() => flush(), SEND_EVERY_MS);
    scan();
    flush(true);
  }

  function teardown(): void {
    window.clearInterval(scanTimer);
    window.clearInterval(sendTimer);
    badge?.remove();
    badge = null;
    warning?.remove();
    warning = null;
    meetingId = null;
    w.__prodliCaptions = false;
    chrome.runtime.onMessage.removeListener(onMessage);
  }

  function onMessage(msg: ContentCommand, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) {
    if (msg?.target !== "captions") return undefined;
    if (msg.type === "start") {
      begin(msg.meetingId, msg.startedAtMs, !!msg.showIndicator);
      sendResponse({ ok: true });
    } else if (msg.type === "stop") {
      scan();
      const final = entries;
      teardown();
      sendResponse({ ok: true, entries: final });
    }
    return undefined;
  }

  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener("pagehide", () => flush(true));
})();
