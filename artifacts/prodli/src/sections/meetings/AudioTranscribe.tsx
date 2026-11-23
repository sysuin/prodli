// "🌐 Transcribe audio with AI" under a meeting's audio: rewrites the transcript
// from the recording, for calls where people switch languages (Meet's captions
// follow one language). The captions transcript is kept, so the user can switch
// back. Work happens in lib recorder/audioTranscribe.ts.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getAudio, updateMeeting } from "../../recorder/db";
import { transcribeRecording, TranscribeError, TRANSCRIBE_QUOTA_MESSAGE, type TranscribeProgress } from "../../recorder/audioTranscribe";
import { labelSpeakers } from "../../recorder/speakers";
import { accountsEnabled, getAiUsage, getProdliAccount } from "../../lib/prodliAccount";
import type { Meeting } from "../../recorder/types";

const ACCENT = "#FF4FA3";

function btn(primary = false, disabled = false): CSSProperties {
  return {
    border: "var(--nb-border)",
    boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
    background: primary ? ACCENT : "hsl(var(--card))",
    color: primary ? "#000" : "hsl(var(--foreground))",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
}

const minutes = (sec: number) => Math.max(0, Math.ceil(sec / 60));

export function languageNames(codes: string[] | undefined): string {
  if (!codes?.length) return "";
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    names = null;
  }
  return codes.map((c) => names?.of(c) ?? c).join(", ");
}

type Phase = { kind: "idle" } | { kind: "running"; progress: TranscribeProgress } | { kind: "error"; message: string };

export function AudioTranscribe({ meeting, busy, flash, onSummarize, canSummarize }: { meeting: Meeting; busy: boolean; flash: (msg: string) => void; onSummarize: () => void; canSummarize: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [left, setLeft] = useState<number | null>(null); // seconds left this month
  const abort = useRef<AbortController | null>(null);
  const totalMs = Math.max(1, meeting.durationSec * 1000);
  const fromAudio = meeting.transcriptSource === "audio";

  useEffect(() => {
    let cancelled = false;
    void (async () => (accountsEnabled() && (await getProdliAccount()) ? getAiUsage() : null))()
      .then((u) => {
        if (!cancelled && u?.transcribeSeconds) setLeft(Math.max(0, u.transcribeSeconds.limit - u.transcribeSeconds.used));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, [meeting.id]);

  const start = async () => {
    if (left !== null && left < Math.min(meeting.durationSec, 60)) {
      setPhase({ kind: "error", message: TRANSCRIBE_QUOTA_MESSAGE });
      return;
    }
    const blob = await getAudio(meeting.id);
    if (!blob) {
      setPhase({ kind: "error", message: "The recording isn't on this computer." });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "running", progress: { doneMs: 0, pieces: 0 } });
    try {
      const r = await transcribeRecording(blob, meeting.audioMimeType, { signal: controller.signal, onProgress: (progress) => setPhase({ kind: "running", progress }) });
      if (controller.signal.aborted) return;
      await updateMeeting(meeting.id, (m) => ({
        transcript: labelSpeakers(r.entries, m.speakerActivity),
        transcriptSource: "audio",
        captionTranscript: m.transcriptSource === "audio" ? m.captionTranscript : m.transcript,
        audioLanguages: r.languages,
        notice: null,
      }));
      if (r.usage) setLeft(Math.max(0, r.usage.limitSeconds - r.usage.usedSeconds));
      setPhase({ kind: "idle" });
      flash(`Transcript written from the audio (${r.entries.length} lines)`);
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "error", message: err instanceof TranscribeError ? err.message : err instanceof Error ? err.message : "Something went wrong. Try again." });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const useCaptions = async () => {
    await updateMeeting(meeting.id, (m) => ({ transcript: m.captionTranscript ?? m.transcript, transcriptSource: "captions", captionTranscript: undefined }));
    flash("Back to the Meet captions transcript");
  };

  const cost = minutes(meeting.durationSec);

  return (
    <div data-testid="audio-transcribe" style={{ marginTop: 10 }}>
      {phase.kind === "running" ? (
        <div role="status" aria-live="polite" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
            <span>
              Transcribing the audio… {minutes(phase.progress.doneMs / 1000)} of {cost} min
            </span>
            <button style={btn()} onClick={() => abort.current?.abort()}>Stop</button>
          </div>
          <div
            role="progressbar"
            aria-label="Transcription progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round((phase.progress.doneMs / totalMs) * 100))}
            style={{ height: 8, border: "var(--nb-border)", background: "hsl(var(--background))" }}
          >
            <div style={{ height: "100%", width: `${Math.min(100, (phase.progress.doneMs / totalMs) * 100)}%`, background: ACCENT, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Keep this tab open until it finishes.</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btn(!fromAudio, busy)} disabled={busy} onClick={() => void start()}>
            {fromAudio ? "Transcribe again" : "🌐 Transcribe audio with AI"}
          </button>
          {fromAudio && meeting.captionTranscript && meeting.captionTranscript.length > 0 && (
            <button style={btn(false, busy)} disabled={busy} onClick={() => void useCaptions()}>Use Meet captions instead</button>
          )}
        </div>
      )}
      {phase.kind === "error" && (
        <div role="alert" style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>
          {phase.message}
        </div>
      )}
      {phase.kind !== "running" && (
        <p style={{ fontSize: 12, opacity: 0.8, margin: "6px 0 0" }}>
          {fromAudio
            ? `The transcript below was written from the audio${meeting.audioLanguages?.length ? ` (heard: ${languageNames(meeting.audioLanguages)})` : ""}. Lines are labelled You and Others when your microphone was included; otherwise Speaker.`
            : "For calls in more than one language: AI listens to the recording and writes each part in the language it was spoken. Lines are labelled You and Others when your microphone was included; otherwise Speaker."}
          {` Uses about ${cost} min${left !== null ? ` of your ${minutes(left)} min left this month` : ""}.`}
        </p>
      )}
      {fromAudio && phase.kind === "idle" && canSummarize && (
        <button style={{ ...btn(), marginTop: 8 }} onClick={onSummarize}>
          {meeting.summary ? "Re-summarize from this transcript" : "✨ Summarize"}
        </button>
      )}
    </div>
  );
}
