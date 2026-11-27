// Screen recorder: draws the camera bubble onto the screen video, in a worker.
// A worker keeps a steady 30 frames a second while the recorder's tab is in
// the background (a page's timers and animation frames are slowed there), and
// redraws the last screen frame when the screen doesn't change (Chrome only
// sends a screen frame when something moves), so the bubble never freezes.

import { bubbleRect, type BubbleLayout } from "./layout";

interface Start {
  type: "start";
  screen: ReadableStream<VideoFrame>;
  camera: ReadableStream<VideoFrame> | null;
  out: WritableStream<VideoFrame>;
  layout: BubbleLayout;
  fps: number;
}
type Msg = Start | { type: "layout"; layout: BubbleLayout } | { type: "stop" };

let layout: BubbleLayout = { size: "medium", corner: "bottom-left", shape: "circle", visible: true };
let running = false;
let screen: ImageBitmap | null = null;
let camera: ImageBitmap | null = null;

async function pump(stream: ReadableStream<VideoFrame>, set: (b: ImageBitmap) => void): Promise<void> {
  const reader = stream.getReader();
  while (running) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    try {
      set(await createImageBitmap(value));
    } finally {
      value.close();
    }
  }
  reader.releaseLock();
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === "layout") {
    layout = msg.layout;
    return;
  }
  if (msg.type === "stop") {
    running = false;
    return;
  }
  layout = msg.layout;
  running = true;
  void pump(msg.screen, (b) => {
    screen?.close();
    screen = b;
  });
  if (msg.camera)
    void pump(msg.camera, (b) => {
      camera?.close();
      camera = b;
    });
  const writer = msg.out.getWriter();
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  const start = performance.now();
  const frameMs = 1000 / msg.fps;
  let n = 0;
  while (running) {
    const due = start + n * frameMs;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    n++;
    if (!screen) continue;
    if (!canvas || canvas.width !== screen.width || canvas.height !== screen.height) {
      canvas = new OffscreenCanvas(screen.width, screen.height);
      ctx = canvas.getContext("2d", { alpha: false });
    }
    if (!ctx) break;
    ctx.drawImage(screen, 0, 0);
    if (camera && layout.visible) {
      const r = bubbleRect(canvas.width, canvas.height, layout);
      // Centre-crop the camera to a square (or to the bubble's shape).
      const side = Math.min(camera.width, camera.height);
      const sx = (camera.width - side) / 2;
      const sy = (camera.height - side) / 2;
      ctx.save();
      ctx.beginPath();
      if (layout.shape === "circle") ctx.arc(r.x + r.size / 2, r.y + r.size / 2, r.size / 2, 0, Math.PI * 2);
      else ctx.roundRect(r.x, r.y, r.size, r.size, r.size * 0.16);
      ctx.closePath();
      ctx.clip();
      // Mirrored, like a mirror: what people expect of their own camera.
      ctx.translate(r.x + r.size, r.y);
      ctx.scale(-1, 1);
      ctx.drawImage(camera, sx, sy, side, side, 0, 0, r.size, r.size);
      ctx.restore();
      ctx.lineWidth = Math.max(3, r.size * 0.025);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      if (layout.shape === "circle") ctx.arc(r.x + r.size / 2, r.y + r.size / 2, r.size / 2, 0, Math.PI * 2);
      else ctx.roundRect(r.x, r.y, r.size, r.size, r.size * 0.16);
      ctx.stroke();
    }
    const frame = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - start) * 1000) });
    try {
      await writer.write(frame);
    } catch {
      frame.close();
      break;
    }
  }
  screen?.close();
  camera?.close();
  screen = camera = null;
  await writer.close().catch(() => undefined);
};
