// 🔗 Share a screen recording: upload with progress, then the link with Copy,
// views and Stop sharing. In Meetings (a video's page) and on the recorder's
// "Saved" screen. Logic: share.ts; server: prodli-api/src/videos.ts.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { accountsEnabled, getProdliAccount } from "../lib/prodliAccount";
import { getMeeting } from "../recorder/db";
import type { Meeting } from "../recorder/types";
import { refreshVideoNotes, shareVideo, unshareVideo, videoViews } from "./share";

const ink = "hsl(var(--foreground))";
const btn = (primary = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: "var(--nb-shadow-sm)",
  background: primary ? "#FF4FA3" : "hsl(var(--card))",
  color: primary ? "#000" : ink,
  padding: "7px 12px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

export function VideoShare({ meetingId, onChange }: { meetingId: string; onChange?: () => void }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [views, setViews] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = () => void getMeeting(meetingId).then((m) => setMeeting(m ?? null));
  useEffect(() => {
    load();
    void getProdliAccount().then((u) => setSignedIn(!!u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // The page gets the notes once they're written (they come after the recording).
  useEffect(() => {
    if (!meeting?.videoShare) return;
    void videoViews(meeting.videoShare.id).then(setViews);
    void refreshVideoNotes(meeting).then((changed) => changed && load()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting?.videoShare?.id, meeting?.summary?.generatedAt]);

  if (!accountsEnabled() || !meeting) return null;
  const share = meeting.videoShare;

  const start = async () => {
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      await shareVideo(meetingId, setProgress, abort.current.signal);
      load();
      onChange?.();
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(err instanceof Error ? err.message : "The video couldn't be uploaded. Try again.");
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };
  const stop = async () => {
    if (!confirm("Stop sharing this video? The link stops working; the video stays here.")) return;
    try {
      await unshareVideo(meeting);
      load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't stop sharing. Try again.");
    }
  };
  const copy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div data-testid="video-share" style={{ border: "var(--nb-border)", background: "hsl(var(--card))", padding: "10px 12px", display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.07em" }}>🔗 Share</div>
      {share ? (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input readOnly value={share.url} aria-label="Share link" onFocus={(e) => e.target.select()} style={{ flex: "1 1 240px", border: "var(--nb-border)", background: "hsl(var(--background))", color: ink, fontFamily: "inherit", fontSize: 13, padding: "6px 8px" }} data-testid="video-share-url" />
            <button style={btn(true)} onClick={() => void copy()}>
              {copied ? "✓ Copied" : "Copy link"}
            </button>
            <a href={share.url} target="_blank" rel="noopener noreferrer" style={{ ...btn(), textDecoration: "none" }}>
              Open
            </a>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, opacity: 0.85, flexWrap: "wrap" }}>
            <span>Anyone with the link can watch it, with its notes and transcript.{views !== null ? ` ${views} view${views === 1 ? "" : "s"}.` : ""}</span>
            <button style={{ border: "none", background: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 700 }} onClick={() => void stop()}>
              Stop sharing
            </button>
          </div>
        </>
      ) : progress !== null ? (
        <div style={{ display: "grid", gap: 6 }} role="status" aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
            <span>Uploading… {Math.round(progress * 100)}%</span>
            <button style={{ ...btn(), padding: "2px 8px" }} onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
          <div role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, border: "var(--nb-border)", background: "hsl(var(--background))" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: "#FF4FA3", transition: "width .2s" }} />
          </div>
        </div>
      ) : signedIn === false ? (
        <p style={{ margin: 0, fontSize: 12 }}>Sign in to ProdLi (👤, free) to get a link anyone can watch.</p>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn(true)} onClick={() => void start()} data-testid="video-share-start">
            Get a share link
          </button>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Uploads the video; people open a page with the video, its notes and transcript. Free: 25 videos, up to 5 minutes each.</span>
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700 }}>
          {error}
        </div>
      )}
    </div>
  );
}
