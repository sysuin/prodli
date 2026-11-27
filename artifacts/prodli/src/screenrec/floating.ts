// Screen recorder: the floating window that stays on top of every app while
// you record (Chrome's Document Picture-in-Picture). It shows your camera as a
// bubble and the controls: time, pause/resume, stop, hide the bubble. When the
// whole screen is recorded, this window is what puts the bubble in the video,
// so the controls only appear while the pointer is over it.

import { formatClock } from "./layout";

export interface FloatingControls {
  setTime(ms: number, paused: boolean): void;
  setCountdown(n: number | null): void;
  close(): void;
}

interface Handlers {
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onToggleBubble(): void;
}

type PipApi = { requestWindow(o: { width: number; height: number }): Promise<Window> };

export const floatingSupported = () => !!(globalThis as { documentPictureInPicture?: PipApi }).documentPictureInPicture;

/** Opens the window. Must be called from a click (Chrome requires it). Returns null where it isn't supported. */
export async function openFloating(camera: MediaStream | null, h: Handlers): Promise<FloatingControls | null> {
  const api = (globalThis as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
  if (!api) return null;
  let win: Window;
  try {
    win = await api.requestWindow({ width: camera ? 230 : 250, height: camera ? 270 : 76 });
  } catch {
    return null;
  }
  const d = win.document;
  d.title = "ProdLi recording";
  const style = d.createElement("style");
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #111; color: #fff; font: 700 13px/1.2 -apple-system, "Segoe UI", sans-serif; overflow: hidden; user-select: none; }
    .wrap { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    .bubble { width: 180px; height: 180px; border-radius: 50%; overflow: hidden; border: 3px solid #fff; box-shadow: 0 4px 18px rgba(0,0,0,.5); background: #222; position: relative; }
    .bubble video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
    .bubble.hidden video { visibility: hidden; }
    .count { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; font-size: 64px; font-weight: 900; background: rgba(0,0,0,.45); }
    .bar { display: flex; align-items: center; gap: 6px; background: #000; border: 2px solid #FFD700; padding: 4px 6px; transition: opacity .15s; }
    .has-camera .bar { opacity: 0; }
    body:hover .bar, .paused .bar { opacity: 1; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #E5484D; animation: blink 1.2s infinite; }
    .paused .dot { background: #888; animation: none; }
    @keyframes blink { 50% { opacity: .3; } }
    .time { min-width: 46px; font-variant-numeric: tabular-nums; }
    button { border: 2px solid #FFD700; background: #111; color: #FFD700; font: 800 12px/1 inherit; padding: 5px 8px; cursor: pointer; }
    button:hover { background: #FFD700; color: #000; }
    button.stop { background: #E5484D; border-color: #E5484D; color: #fff; }
  `;
  d.head.appendChild(style);
  const wrap = d.createElement("div");
  wrap.className = `wrap${camera ? " has-camera" : ""}`;
  let bubble: HTMLDivElement | null = null;
  let count: HTMLDivElement | null = null;
  if (camera) {
    bubble = d.createElement("div");
    bubble.className = "bubble";
    const v = d.createElement("video");
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    v.srcObject = camera;
    bubble.appendChild(v);
    count = d.createElement("div");
    count.className = "count";
    bubble.appendChild(count);
    wrap.appendChild(bubble);
  }
  const bar = d.createElement("div");
  bar.className = "bar";
  const dot = d.createElement("span");
  dot.className = "dot";
  const time = d.createElement("span");
  time.className = "time";
  time.textContent = "0:00";
  const pause = d.createElement("button");
  pause.textContent = "❚❚";
  pause.title = "Pause";
  let paused = false;
  pause.onclick = () => (paused ? h.onResume() : h.onPause());
  const stop = d.createElement("button");
  stop.className = "stop";
  stop.textContent = "■ Stop";
  stop.title = "Stop and save";
  stop.onclick = () => h.onStop();
  bar.append(dot, time, pause, stop);
  if (camera) {
    const hide = d.createElement("button");
    hide.textContent = "◐";
    hide.title = "Hide or show your camera";
    hide.onclick = () => {
      bubble?.classList.toggle("hidden");
      h.onToggleBubble();
    };
    bar.append(hide);
  }
  wrap.appendChild(bar);
  d.body.appendChild(wrap);
  // Closing the window stops the recording, like pressing Stop.
  let closedByUs = false;
  win.addEventListener("pagehide", () => !closedByUs && h.onStop());
  return {
    setTime(ms, isPaused) {
      paused = isPaused;
      time.textContent = formatClock(ms);
      pause.textContent = isPaused ? "▶" : "❚❚";
      pause.title = isPaused ? "Resume" : "Pause";
      wrap.classList.toggle("paused", isPaused);
    },
    setCountdown(n) {
      if (!count) return;
      count.style.display = n ? "flex" : "none";
      count.textContent = n ? String(n) : "";
    },
    close() {
      closedByUs = true;
      win.close();
    },
  };
}
