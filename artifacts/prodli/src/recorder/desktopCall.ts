// Desktop app: record a call in ANY app (Zoom, Teams, Slack, FaceTime, a browser
// tab…) without a bot joining: the computer's sound (the other people) mixed
// with your microphone (you), into one stream for the usual recorder
// (recorder/inPerson.ts). The app grants the computer's sound for
// getDisplayMedia (artifacts/prodli-desktop/src/main/media.ts); the video it
// has to come with is stopped at once and never recorded.
//
// If the computer's sound isn't available (a Mac before macOS 13, or "Screen &
// System Audio Recording" not allowed), it records the microphone alone and
// says so — with speakers rather than headphones, the mic still hears the call.

export interface CallCapture {
  stream: MediaStream;
  /** True when the other people's audio is recorded directly. */
  systemAudio: boolean;
  stop(): void;
}

const micError = (err: unknown) => {
  const name = err instanceof DOMException ? err.name : "";
  return new Error(
    name === "NotAllowedError"
      ? "ProdLi isn't allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone (Mac) or Settings → Privacy → Microphone (Windows), then try again."
      : name === "NotFoundError"
        ? "No microphone was found."
        : "The microphone couldn't be started.",
  );
};

export async function captureCall(): Promise<CallCapture> {
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    throw micError(err);
  }
  let display: MediaStream | null = null;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  } catch {
    display = null; // no permission / not supported: microphone only
  }
  display?.getVideoTracks().forEach((t) => t.stop());
  const system = display?.getAudioTracks()[0];
  if (!system) {
    display?.getTracks().forEach((t) => t.stop());
    return { stream: mic, systemAudio: false, stop: () => mic.getTracks().forEach((t) => t.stop()) };
  }
  const ctx = new AudioContext();
  const out = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(out);
  ctx.createMediaStreamSource(new MediaStream([system])).connect(out);
  return {
    stream: out.stream,
    systemAudio: true,
    stop: () => {
      mic.getTracks().forEach((t) => t.stop());
      display?.getTracks().forEach((t) => t.stop());
      out.stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}

/** "Call · Thu 20 Nov, 14:05" until a summary gives it a real name. */
export function callTitle(d = new Date()): string {
  return `Call · ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
