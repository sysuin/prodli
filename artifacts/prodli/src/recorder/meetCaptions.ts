// Content script injected into meet.google.com while a recording is running.
//
// It reads Google Meet's live captions (speaker name + text) to build the
// transcript, and shows a small badge that only the person recording can see.
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

  /** Merge an updated caption text into what we already have for that block. */
  function mergeText(oldText: string, newText: string): string {
    if (!oldText) return newText;
    if (newText.includes(oldText)) return newText;
    if (oldText.includes(newText)) return oldText;
    // Meet sometimes drops the start of a long caption — stitch the overlap.
    const max = Math.min(oldText.length, newText.length, 300);
    for (let n = max; n >= 12; n--) {
      if (newText.startsWith(oldText.slice(-n))) return oldText + newText.slice(n);
    }
    // Otherwise it's most likely Meet correcting itself: prefer the newer text.
    return newText.length >= oldText.length * 0.6 ? newText : `${oldText} ${newText}`;
  }

  function parseBlock(block: HTMLElement): { speaker: string; text: string } | null {
    const lines = (block.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    if (lines.length === 1) return { speaker: lastSpeaker, text: lines[0] };
    return { speaker: lines[0], text: lines.slice(1).join(" ") };
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
    captionsOn = !!region;
    if (!region) {
      tryTurnOnCaptions();
      updateBadge();
      return;
    }

    for (const child of Array.from(region.children)) {
      const block = child as HTMLElement;
      if (block.tagName === "BUTTON" || block.querySelector("button")) continue;
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
    send({ target: "background", type: "captions-update", meetingId, entries, captionsOn, title: meetingTitle() });
  }

  function updateBadge(): void {
    if (!badge) return;
    const status = badge.querySelector<HTMLSpanElement>("[data-status]");
    if (status) {
      status.textContent = captionsOn
        ? `ProdLi is taking notes · ${entries.length} lines`
        : "ProdLi is recording · turn on captions (CC) for the transcript";
    }
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
      gap: "8px",
      padding: "6px 8px 6px 10px",
      background: "#FFD700",
      color: "#000",
      border: "2px solid #000",
      boxShadow: "3px 3px 0 #000",
      font: "700 12px/1.2 system-ui, sans-serif",
    } satisfies Partial<CSSStyleDeclaration>);
    const dot = document.createElement("span");
    Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", background: "#E53935" });
    const status = document.createElement("span");
    status.setAttribute("data-status", "");
    const stop = document.createElement("button");
    stop.textContent = "Stop";
    Object.assign(stop.style, {
      border: "2px solid #000",
      background: "#000",
      color: "#FFD700",
      font: "800 11px system-ui, sans-serif",
      padding: "2px 8px",
      cursor: "pointer",
    });
    stop.addEventListener("click", () => send({ target: "background", type: "stop-recording" }));
    badge.append(dot, status, stop);
    document.body.appendChild(badge);
    updateBadge();
  }

  function begin(id: string, startMs: number): void {
    if (meetingId === id) return;
    meetingId = id;
    startedAtMs = startMs;
    entries = [];
    sawLeaveButton = false;
    leaveMissingSince = null;
    captionClickAttempts = 0;
    showBadge();
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
    meetingId = null;
    w.__prodliCaptions = false;
    chrome.runtime.onMessage.removeListener(onMessage);
  }

  function onMessage(msg: ContentCommand, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) {
    if (msg?.target !== "captions") return undefined;
    if (msg.type === "start") {
      begin(msg.meetingId, msg.startedAtMs);
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
