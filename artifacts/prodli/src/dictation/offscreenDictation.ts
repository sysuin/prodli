// Voice dictation in the offscreen document: records the microphone and sends
// each piece (cut at a pause) to the background as soon as it's ready.

import { bytesToBase64 } from "../recorder/format";
import { DictationCapture } from "./capture";
import type { ToBackground, ToOffscreen } from "./messages";

let capture: DictationCapture | null = null;
let session = "";

const send = (msg: ToBackground) => void chrome.runtime.sendMessage(msg).catch(() => {});

export function registerOffscreenDictation(): void {
  chrome.runtime.onMessage.addListener((msg: ToOffscreen, _sender, sendResponse) => {
    if (msg?.target !== "offscreen-dictate") return undefined;
    if (msg.type === "start") {
      capture?.cancel();
      session = msg.session;
      const s = session;
      capture = new DictationCapture(
        (p) => send({ target: "background-dictate", type: "piece", session: s, seq: p.seq, startMs: p.startMs, wav: bytesToBase64(p.wav) }),
        (level) => send({ target: "background-dictate", type: "level", level }),
      );
      capture.start().then(
        () => sendResponse({ ok: true }),
        (err: unknown) => {
          capture = null;
          const name = err instanceof DOMException ? err.name : "";
          sendResponse({ ok: false, error: name === "NotAllowedError" || name === "SecurityError" ? "mic-blocked" : name === "NotFoundError" ? "no-mic" : "mic-failed" });
        },
      );
      return true;
    }
    if (msg.type === "stop") {
      const r = capture?.stop() ?? { ms: 0, pieces: 0 };
      capture = null;
      sendResponse({ ok: true, ...r });
      return undefined;
    }
    if (msg.type === "cancel") {
      capture?.cancel();
      capture = null;
      sendResponse({ ok: true });
    }
    return undefined;
  });
}
