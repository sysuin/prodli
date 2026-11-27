// 🎥 Record a video (index.html#record): screen, camera bubble and microphone,
// Loom-style. Set up (what to record, camera, microphone, bubble), Start (Chrome
// asks what to share), a countdown, then record with the floating controls on
// top of everything. Stop saves it to Meetings, where ProdLi writes the
// transcript, a title and notes with action items. Logic: recorder.ts.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BUBBLE_FRACTION, formatClock, MAX_RECORDING_MS, type BubbleCorner, type BubbleLayout, type BubbleShape, type BubbleSize, type RecordMode } from "./layout";
import { RecordError, ScreenRecording, type Finished, type RecordOptions } from "./recorder";
import { floatingSupported, openFloating, type FloatingControls } from "./floating";
import { createScreenMeeting } from "../recorder/upload";
import { updateMeeting } from "../recorder/db";
import { storageGet, storageSet } from "../lib/storage";
import { OPEN_MEETING_KEY } from "../lib/askOpen";
import { VideoShare } from "./VideoShare";

const PREFS_KEY = "screenRecorderPrefs";
interface Prefs {
  mode: RecordMode;
  cameraId?: string;
  micId?: string | null;
  layout: BubbleLayout;
  countdown: boolean;
}
const DEFAULT_PREFS: Prefs = { mode: "screen-camera", micId: undefined, layout: { size: "medium", corner: "bottom-left", shape: "circle", visible: true }, countdown: true };

const ink = "hsl(var(--foreground))";
const card: CSSProperties = { border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", background: "hsl(var(--card))", padding: 20 };
const btn = (kind: "primary" | "plain" | "danger" = "plain", on = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: on ? "none" : "var(--nb-shadow-sm)",
  background: kind === "primary" || on ? "#FF4FA3" : kind === "danger" ? "#E5484D" : "hsl(var(--card))",
  color: kind === "plain" && !on ? ink : "#000",
  padding: "8px 14px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
});
const label: CSSProperties = { fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, display: "block" };
const select: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--background))", color: ink, fontFamily: "inherit", fontSize: 13, padding: "6px 8px", width: "100%" };

const MODES: { id: RecordMode; icon: string; title: string; sub: string }[] = [
  { id: "screen-camera", icon: "🖥️🙂", title: "Screen and camera", sub: "You in a bubble over your screen" },
  { id: "screen", icon: "🖥️", title: "Screen only", sub: "A tab, a window or everything" },
  { id: "camera", icon: "🙂", title: "Camera only", sub: "Just you talking" },
];

type Phase = { kind: "setup" } | { kind: "countdown"; n: number } | { kind: "recording" } | { kind: "saving" } | { kind: "done"; rec: Finished; title: string } | { kind: "error"; message: string };

export function RecorderPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<ScreenRecording | null>(null);
  const floating = useRef<FloatingControls | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const stopping = useRef(false);
  const bubbleOn = useRef(true);

  useEffect(() => {
    document.title = "Record a video · ProdLi";
    void storageGet<Partial<Prefs>>(PREFS_KEY, {}).then((p) => setPrefs({ ...DEFAULT_PREFS, ...p, layout: { ...DEFAULT_PREFS.layout, ...(p.layout ?? {}), visible: true } }));
  }, []);
  const savePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void storageSet(PREFS_KEY, next);
    return next;
  };

  const listDevices = useCallback(async () => {
    const all: MediaDeviceInfo[] = await navigator.mediaDevices.enumerateDevices().catch((): MediaDeviceInfo[] => []);
    setDevices({ cams: all.filter((d) => d.kind === "videoinput"), mics: all.filter((d) => d.kind === "audioinput") });
    return all;
  }, []);

  /** Opens the camera and microphone for the preview (and the recording). */
  const openDevices = useCallback(
    async (p: Prefs) => {
      rec.current?.release();
      const r = new ScreenRecording();
      rec.current = r;
      try {
        await r.openDevices(optionsOf(p));
        setCamera(r.camera);
        setNeedsAccess(false);
        setProblem(null);
        await listDevices();
      } catch (err) {
        setCamera(null);
        setProblem(err instanceof RecordError ? err.message : "ProdLi couldn't open your camera or microphone.");
      }
    },
    [listDevices],
  );

  // On load and when the mode or a device changes: open what's needed, if Chrome already allows it.
  useEffect(() => {
    if (phase.kind !== "setup") return;
    void (async () => {
      const all = await listDevices();
      const allowed = all.some((d) => d.label);
      if (!allowed && (prefs.mode !== "screen" || prefs.micId !== null)) return setNeedsAccess(true);
      await openDevices(prefs);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, prefs.cameraId, prefs.micId]);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = camera;
  }, [camera, phase.kind]);

  // Microphone level, so people can see they're heard.
  useEffect(() => {
    const mic = rec.current?.micStream;
    if (!mic || phase.kind === "done") return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(mic).connect(an);
    const data = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [camera, needsAccess, phase.kind, prefs.micId]);

  // The clock (and the length limit).
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const t = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      setElapsed(r.elapsedMs);
      setPaused(r.paused);
      floating.current?.setTime(r.elapsedMs, r.paused);
      if (r.elapsedMs >= MAX_RECORDING_MS) void stop();
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  // Leaving the page mid-recording would lose the end of it: ask first.
  useEffect(() => {
    if (phase.kind !== "recording" && phase.kind !== "countdown") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase.kind]);

  const start = async () => {
    setProblem(null);
    let r = rec.current;
    if (!r) {
      r = new ScreenRecording();
      rec.current = r;
    }
    const opts = optionsOf(prefs);
    bubbleOn.current = true;
    try {
      await r.openDevices(opts);
      setCamera(r.camera);
      // The floating window first, while Chrome still counts this as the click.
      if (opts.mode !== "camera") {
        floating.current = await openFloating(opts.mode === "screen-camera" ? r.camera : null, {
          onPause: () => {
            rec.current?.pause();
            setPaused(true);
          },
          onResume: () => {
            rec.current?.resume();
            setPaused(false);
          },
          onStop: () => void stop(),
          onToggleBubble: () => {
            bubbleOn.current = !bubbleOn.current;
            rec.current?.setLayout({ ...prefs.layout, visible: bubbleOn.current });
          },
        });
        await r.pickScreen();
        r.onEnded = () => void stop();
      }
    } catch (err) {
      floating.current?.close();
      floating.current = null;
      if (err instanceof RecordError && err.cancelled) return;
      setProblem(err instanceof RecordError ? err.message : "Recording couldn't start.");
      return;
    }
    if (prefs.countdown) {
      for (const n of [3, 2, 1]) {
        setPhase({ kind: "countdown", n });
        floating.current?.setCountdown(n);
        await new Promise((res) => setTimeout(res, 900));
      }
      floating.current?.setCountdown(null);
    }
    try {
      r.start(opts);
    } catch (err) {
      r.release();
      floating.current?.close();
      setPhase({ kind: "setup" });
      setProblem(err instanceof Error ? err.message : "Recording couldn't start.");
      return;
    }
    stopping.current = false;
    setElapsed(0);
    setPaused(false);
    setPhase({ kind: "recording" });
  };

  const stop = async () => {
    const r = rec.current;
    if (!r || stopping.current) return;
    stopping.current = true;
    floating.current?.close();
    floating.current = null;
    setPhase({ kind: "saving" });
    try {
      const done = await r.stop();
      const title = r.sourceLabel ? `${r.sourceLabel}` : `Screen recording, ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      await createScreenMeeting({ id: done.id, startedAt: r.startedAt, durationMs: done.durationMs, mimeType: done.mimeType, hasSound: done.hasSound }, title);
      rec.current = null;
      setCamera(null);
      setPhase({ kind: "done", rec: done, title });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "The recording couldn't be saved." });
    }
  };

  const discard = async () => {
    floating.current?.close();
    floating.current = null;
    stopping.current = true;
    await rec.current?.cancel();
    rec.current = null;
    setCamera(null);
    setPhase({ kind: "setup" });
    void openDevices(prefs);
  };

  const openInMeetings = async (id: string) => {
    await storageSet(OPEN_MEETING_KEY, id);
    await storageSet("lastSection", "meetings");
    location.hash = "";
    location.reload();
  };

  const recording = phase.kind === "recording" || phase.kind === "countdown";

  return (
    <div style={{ minHeight: "100vh", background: "hsl(var(--background))", color: ink, fontFamily: "var(--app-font-sans)" }} data-testid="screen-recorder">
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", borderBottom: "var(--nb-border)", background: "hsl(var(--card))" }}>
        <span style={{ fontWeight: 900, fontSize: 18 }}>🎥 Record a video</span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>Saved to Meetings with a transcript, notes and action items</span>
        {!recording && phase.kind !== "saving" && (
          <a href={location.pathname} style={{ marginLeft: "auto", ...btn(), textDecoration: "none" }}>
            ← Back to ProdLi
          </a>
        )}
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 48px", display: "grid", gap: 18 }}>
        {problem && (
          <div role="alert" style={{ ...card, boxShadow: "none", background: "#FFF3B0", color: "#000", padding: "10px 14px", fontWeight: 700 }}>
            {problem}
          </div>
        )}

        {phase.kind === "setup" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }} role="radiogroup" aria-label="What to record">
              {MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={prefs.mode === m.id} data-testid={`record-mode-${m.id}`} onClick={() => savePrefs({ mode: m.id })} style={{ ...btn("plain", prefs.mode === m.id), textAlign: "left", padding: "12px 14px", display: "grid", gap: 3 }}>
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 900 }}>{m.title}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>{m.sub}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(260px, 1fr)", gap: 18, alignItems: "start" }} className="recorder-grid">
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <Preview mode={prefs.mode} layout={prefs.layout} camera={camera} videoRef={preview} />
              </div>
              <div style={{ ...card, display: "grid", gap: 14, alignContent: "start" }}>
                {needsAccess ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13 }}>ProdLi needs your camera and microphone for the bubble and your voice. Chrome will ask.</p>
                    <button style={btn("primary")} onClick={() => void openDevices(prefs)} data-testid="record-allow">
                      Allow camera and microphone
                    </button>
                  </div>
                ) : (
                  <>
                    {prefs.mode !== "screen" && (
                      <label>
                        <span style={label}>Camera</span>
                        <select style={select} value={prefs.cameraId ?? ""} onChange={(e) => savePrefs({ cameraId: e.target.value || undefined })} aria-label="Camera">
                          {devices.cams.length === 0 && <option value="">No camera found</option>}
                          {devices.cams.map((c, i) => (
                            <option key={c.deviceId || i} value={c.deviceId}>
                              {c.label || `Camera ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      <span style={label}>Microphone</span>
                      <select style={select} value={prefs.micId === null ? "none" : (prefs.micId ?? "")} onChange={(e) => savePrefs({ micId: e.target.value === "none" ? null : e.target.value || undefined })} aria-label="Microphone">
                        {devices.mics.map((m, i) => (
                          <option key={m.deviceId || i} value={m.deviceId}>
                            {m.label || `Microphone ${i + 1}`}
                          </option>
                        ))}
                        <option value="none">No microphone</option>
                      </select>
                      {prefs.micId !== null && (
                        <span aria-hidden style={{ display: "block", height: 6, marginTop: 6, background: "hsl(var(--muted))", border: "1px solid var(--nb-section-border)" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.round(level * 100)}%`, background: "#16A34A", transition: "width 0.08s" }} />
                        </span>
                      )}
                    </label>
                  </>
                )}
                {prefs.mode === "screen-camera" && (
                  <div>
                    <span style={label}>Bubble</span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(["small", "medium", "large"] as BubbleSize[]).map((s) => (
                        <button key={s} style={{ ...btn("plain", prefs.layout.size === s), padding: "4px 9px", fontSize: 12 }} aria-pressed={prefs.layout.size === s} onClick={() => savePrefs({ layout: { ...prefs.layout, size: s } })}>
                          {s === "small" ? "S" : s === "medium" ? "M" : "L"}
                        </button>
                      ))}
                      <span style={{ width: 8 }} />
                      {(["circle", "rounded"] as BubbleShape[]).map((s) => (
                        <button key={s} style={{ ...btn("plain", prefs.layout.shape === s), padding: "4px 9px", fontSize: 12 }} aria-pressed={prefs.layout.shape === s} onClick={() => savePrefs({ layout: { ...prefs.layout, shape: s } })} title={s === "circle" ? "Circle" : "Rounded square"}>
                          {s === "circle" ? "●" : "■"}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: 4, marginTop: 6, justifyContent: "start" }}>
                      {(["top-left", "top-right", "bottom-left", "bottom-right"] as BubbleCorner[]).map((c) => (
                        <button key={c} style={{ ...btn("plain", prefs.layout.corner === c), padding: "4px 8px", fontSize: 11 }} aria-pressed={prefs.layout.corner === c} onClick={() => savePrefs({ layout: { ...prefs.layout, corner: c } })}>
                          {c === "top-left" ? "↖" : c === "top-right" ? "↗" : c === "bottom-left" ? "↙" : "↘"}
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, opacity: 0.75, margin: "6px 0 0" }}>Where the bubble sits when you record a tab or a window. When you record your entire screen, drag the floating bubble wherever you like.</p>
                  </div>
                )}
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  <input type="checkbox" checked={prefs.countdown} onChange={(e) => savePrefs({ countdown: e.target.checked })} />
                  3-second countdown
                </label>
                <button style={{ ...btn("primary"), fontSize: 15, padding: "12px 16px" }} onClick={() => void start()} data-testid="record-start">
                  ● Start recording
                </button>
                <p style={{ fontSize: 12, opacity: 0.8, margin: 0 }}>
                  {prefs.mode === "camera"
                    ? "Recording starts after the countdown."
                    : `Chrome then asks what to share: a tab, a window or your entire screen. Choose "Entire screen" to record other apps too.${floatingSupported() ? " Your controls float on top of everything." : ""}`}
                </p>
              </div>
            </div>
          </>
        )}

        {recording && (
          <div style={{ ...card, display: "grid", gap: 16, justifyItems: "center", textAlign: "center", padding: 32 }}>
            {phase.kind === "countdown" ? (
              <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1 }} aria-live="assertive">
                {phase.n}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }} aria-live="polite">
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: paused ? "#888" : "#E5484D" }} />
                  <span style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>{paused ? "Paused" : "Recording"}</span>
                </div>
                <div style={{ fontSize: 64, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }} data-testid="record-clock">
                  {formatClock(elapsed)}
                </div>
                {prefs.mode === "camera" && camera && <video ref={preview} autoPlay muted playsInline style={{ width: 360, maxWidth: "100%", transform: "scaleX(-1)", border: "var(--nb-border)" }} />}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  <button style={btn()} onClick={() => (paused ? (rec.current?.resume(), setPaused(false)) : (rec.current?.pause(), setPaused(true)))} data-testid="record-pause">
                    {paused ? "▶ Resume" : "❚❚ Pause"}
                  </button>
                  <button style={btn("primary")} onClick={() => void stop()} data-testid="record-stop">
                    ■ Stop and save
                  </button>
                  <button style={btn("danger")} onClick={() => void discard()}>
                    Discard
                  </button>
                </div>
                <p style={{ fontSize: 13, opacity: 0.8, margin: 0, maxWidth: 480 }}>{prefs.mode === "camera" ? "Talk to the camera. Stop saves the video to Meetings." : "Go to what you're recording. You can stop from the floating controls, from Chrome's “Stop sharing” bar, or here."}</p>
              </>
            )}
          </div>
        )}

        {phase.kind === "saving" && (
          <div style={{ ...card, textAlign: "center", fontWeight: 800 }} role="status">
            Saving your video…
          </div>
        )}

        {phase.kind === "done" && <Done phase={phase} onOpen={openInMeetings} onAgain={() => (setPhase({ kind: "setup" }), void openDevices(prefs))} />}

        {phase.kind === "error" && (
          <div style={{ ...card, display: "grid", gap: 10 }}>
            <strong>{phase.message}</strong>
            <div>
              <button style={btn()} onClick={() => (setPhase({ kind: "setup" }), void openDevices(prefs))}>
                Try again
              </button>
            </div>
          </div>
        )}
      </main>
      <style>{`@media (max-width: 760px) { .recorder-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function optionsOf(p: Prefs): RecordOptions {
  return { mode: p.mode, micId: p.micId === null ? null : (p.micId ?? ""), cameraId: p.cameraId, layout: { ...p.layout, visible: true } };
}

/** What the video will look like: a screen with the bubble in its corner, or the camera alone. */
function Preview({ mode, layout, camera, videoRef }: { mode: RecordMode; layout: BubbleLayout; camera: MediaStream | null; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const size = `${BUBBLE_FRACTION[layout.size] * 100 * (9 / 16)}%`;
  const inset = "3.5%";
  const bubble: CSSProperties = {
    position: "absolute",
    width: size,
    aspectRatio: "1",
    borderRadius: layout.shape === "circle" ? "50%" : "16%",
    overflow: "hidden",
    border: "3px solid #fff",
    boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    background: "#333",
    ...(layout.corner.startsWith("top") ? { top: inset } : { bottom: inset }),
    ...(layout.corner.endsWith("left") ? { left: `calc(${inset} * 9 / 16)` } : { right: `calc(${inset} * 9 / 16)` }),
  };
  return (
    <div style={{ position: "relative", aspectRatio: "16 / 9", background: mode === "camera" ? "#111" : "linear-gradient(135deg, #2b2f3a, #1a1c22)" }} aria-label="Preview">
      {mode !== "camera" && (
        <div aria-hidden style={{ position: "absolute", inset: "8% 10%", display: "grid", gap: "6%", alignContent: "start", opacity: 0.5 }}>
          <div style={{ height: 14, width: "40%", background: "#FFD700" }} />
          <div style={{ height: 8, width: "85%", background: "#fff" }} />
          <div style={{ height: 8, width: "70%", background: "#fff" }} />
          <div style={{ height: 8, width: "78%", background: "#fff" }} />
        </div>
      )}
      {mode !== "screen" &&
        (camera ? (
          <video ref={videoRef} autoPlay muted playsInline style={mode === "camera" ? { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" } : { ...bubble, objectFit: "cover", transform: "scaleX(-1)" }} />
        ) : (
          <div style={mode === "camera" ? { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontWeight: 700 } : { ...bubble, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>{mode === "camera" ? "Camera preview" : "🙂"}</div>
        ))}
      <span style={{ position: "absolute", left: 10, top: 8, fontSize: 11, fontWeight: 800, color: "#fff", opacity: 0.7 }}>Preview</span>
    </div>
  );
}

function Done({ phase, onOpen, onAgain }: { phase: Extract<Phase, { kind: "done" }>; onOpen: (id: string) => void; onAgain: () => void }) {
  const [title, setTitle] = useState(phase.title);
  const [url] = useState(() => URL.createObjectURL(phase.rec.blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const rename = (t: string) => {
    setTitle(t);
    void updateMeeting(phase.rec.id, () => ({ title: t.trim().slice(0, 200) || phase.title }));
  };
  const ext = /mp4/.test(phase.rec.mimeType) ? "mp4" : "webm";
  return (
    <div style={{ ...card, display: "grid", gap: 14 }} data-testid="record-done">
      <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.07em" }}>✓ Saved to Meetings · {formatClock(phase.rec.durationMs)}</div>
      <input value={title} onChange={(e) => rename(e.target.value)} aria-label="Title" style={{ border: "var(--nb-border)", background: "hsl(var(--background))", color: ink, fontFamily: "inherit", fontSize: 20, fontWeight: 900, padding: "8px 10px" }} />
      <video src={url} controls playsInline style={{ width: "100%", maxHeight: "60vh", background: "#000", border: "var(--nb-border)" }} data-testid="record-playback" />
      <VideoShare meetingId={phase.rec.id} />
      <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>{phase.rec.hasSound ? "ProdLi is writing the transcript and notes with action items; they appear in Meetings in a minute or two (needs a free ProdLi account)." : "Recorded without sound, so there's no transcript."}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btn("primary")} onClick={() => onOpen(phase.rec.id)} data-testid="record-open">
          Open in Meetings
        </button>
        <a href={url} download={`${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "recording"}.${ext}`} style={{ ...btn(), textDecoration: "none" }}>
          Download
        </a>
        <button style={btn()} onClick={onAgain}>
          Record another
        </button>
      </div>
    </div>
  );
}
