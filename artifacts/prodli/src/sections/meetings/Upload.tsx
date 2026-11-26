// Meetings → "⬆ Upload recording": the header button (and dropping a file on
// Meetings), the panel that asks for a title and date, and the progress / Retry
// on an uploaded meeting. A transcript file (.vtt, .srt, Otter/Granola text)
// gets its own panel and no transcription. Logic: recorder/upload.ts,
// recorder/transcriptFile.ts.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createTranscriptMeeting, createUpload, onUploadChange, probeFile, processUpload, SIGN_IN_TO_TRANSCRIBE_UPLOAD, stopUpload, uploadJob, type ProbedFile } from "../../recorder/upload";
import { isTranscriptFile, MAX_TRANSCRIPT_BYTES, parseTranscript, TRANSCRIPT_ACCEPT, type ParsedTranscript } from "../../recorder/transcriptFile";
import { defaultUploadDate, defaultUploadTitle, formatBytes, fromDateTimeLocal, isRecordingFile, toDateTimeLocal, UPLOAD_ACCEPT } from "../../recorder/uploadFile";
import { accountsEnabled } from "../../lib/prodliAccount";
import type { Meeting } from "../../recorder/types";

const ACCENT = "#FF4FA3";
const btn = (primary = false, disabled = false): CSSProperties => ({
  border: "var(--nb-border)",
  boxShadow: disabled ? "none" : "var(--nb-shadow-sm)",
  background: primary ? ACCENT : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "7px 12px",
  fontFamily: "inherit",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
});
const field: CSSProperties = { border: "var(--nb-border)", padding: "6px 8px", fontFamily: "inherit", fontSize: 13, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };
const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));

function formatLength(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return sec < 60 ? `${Math.round(sec)}s` : h ? `${h}h ${m}m` : `${m} min`;
}

export function UploadButton({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button data-testid="upload-recording" style={btn()} title="Turn an audio or video file (voice memo, recorder export, Zoom recording…) or a transcript (.vtt, .srt, Otter or Granola text) into meeting notes" onClick={() => input.current?.click()}>
        ⬆ Upload recording
      </button>
      <input
        ref={input}
        data-testid="upload-recording-input"
        type="file"
        accept={`${UPLOAD_ACCEPT},${TRANSCRIPT_ACCEPT}`}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/** Dropping an audio or video file anywhere on Meetings. */
export function useUploadDrop(onFile: (file: File) => void, flash: (msg: string) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  return {
    dragging,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (!f) return;
        if (isRecordingFile(f) || isTranscriptFile(f)) onFile(f);
        else flash("Drop an audio, video or transcript file to upload it");
      },
    },
  };
}

export function DropOverlay() {
  return (
    <div data-testid="upload-drop" style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: ACCENT, color: "#000", padding: "18px 24px", fontWeight: 900, fontSize: 16 }}>⬆ Drop to upload the recording or transcript</div>
    </div>
  );
}

/** Title and date for a picked file, then Upload. */
export function UploadPanel(props: { file: File; signedIn: boolean; onClose: () => void; onCreated: (meetingId: string) => void }) {
  return isTranscriptFile(props.file) && !isRecordingFile(props.file) ? <TranscriptPanel {...props} /> : <RecordingPanel {...props} />;
}

const SPEAKERS_SHOWN = 4;

/** A transcript file: what's in it, a title and date, then Import. */
function TranscriptPanel({ file, signedIn, onClose, onCreated }: { file: File; signedIn: boolean; onClose: () => void; onCreated: (meetingId: string) => void }) {
  const [parsed, setParsed] = useState<ParsedTranscript | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState(() => defaultUploadTitle(file.name));
  const [when, setWhen] = useState(() => toDateTimeLocal(defaultUploadDate(file.lastModified)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setParsed(null);
    setProblem(null);
    setTitle(defaultUploadTitle(file.name));
    setWhen(toDateTimeLocal(defaultUploadDate(file.lastModified)));
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      setProblem("This transcript is too large (over 5 MB).");
      return;
    }
    void file.text().then(
      (text) => {
        if (cancelled) return;
        const p = parseTranscript(text);
        if (!p.entries.length) setProblem("There's no transcript in this file.");
        else setParsed(p);
      },
      () => !cancelled && setProblem("ProdLi can't read this file."),
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const date = fromDateTimeLocal(when);
  const ready = !!parsed && !!date && !saving;
  const save = async () => {
    if (!parsed || !date) return;
    setSaving(true);
    try {
      onCreated(await createTranscriptMeeting(parsed.entries, { title, date, durationSec: parsed.durationSec, fileName: file.name }));
    } catch {
      setProblem("The transcript couldn't be saved. Try again.");
      setSaving(false);
    }
  };
  const speakers = parsed?.speakers ?? [];

  return (
    <div data-testid="upload-panel" style={{ borderBottom: "var(--nb-border)", background: "hsl(var(--muted))", padding: "12px 24px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
        <strong style={{ fontSize: 14 }}>⬆ Import transcript</strong>
        <span data-testid="transcript-info" style={{ fontWeight: 600, opacity: 0.8, overflowWrap: "anywhere" }}>
          {file.name}
          {parsed
            ? ` · ${parsed.entries.length} ${parsed.entries.length === 1 ? "line" : "lines"}${parsed.durationSec && parsed.format !== "text" ? ` · ${formatLength(parsed.durationSec)}` : ""}${speakers.length ? ` · ${speakers.slice(0, SPEAKERS_SHOWN).join(", ")}${speakers.length > SPEAKERS_SHOWN ? ` +${speakers.length - SPEAKERS_SHOWN}` : ""}` : ""}`
            : problem
              ? ""
              : " · reading…"}
        </span>
      </div>
      {problem ? (
        <div role="alert" style={{ fontSize: 13, fontWeight: 700 }}>{problem}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, flex: "1 1 240px" }}>
              Title
              <input data-testid="upload-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={field} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700 }}>
              Held on
              <input data-testid="upload-date" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={field} />
            </label>
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {signedIn ? "ProdLi writes the notes and action items from it, like a recorded call. No transcription minutes are used." : accountsEnabled() ? "The transcript is saved now; sign in (👤, free) to get AI notes from it." : "The transcript is saved as a meeting."}
            {parsed?.format === "text" ? " This file has no times, so the times shown are estimates." : ""}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {!problem && (
          <button data-testid="upload-start" style={btn(true, !ready)} disabled={!ready} onClick={() => void save()}>
            {saving ? "Saving…" : signedIn ? "Import & write notes" : "Import"}
          </button>
        )}
        <button style={btn()} onClick={onClose}>{problem ? "Close" : "Cancel"}</button>
      </div>
    </div>
  );
}

function RecordingPanel({ file, signedIn, onClose, onCreated }: { file: File; signedIn: boolean; onClose: () => void; onCreated: (meetingId: string) => void }) {
  const [probe, setProbe] = useState<ProbedFile | null>(null);
  const [title, setTitle] = useState(() => defaultUploadTitle(file.name));
  const [when, setWhen] = useState(() => toDateTimeLocal(defaultUploadDate(file.lastModified)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setTitle(defaultUploadTitle(file.name));
    setWhen(toDateTimeLocal(defaultUploadDate(file.lastModified)));
    setError(null);
    void probeFile(file)
      .catch((): ProbedFile => ({ format: "unknown", durationSec: null, problem: "ProdLi can't read this file." }))
      .then((p) => !cancelled && setProbe(p));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const problem = probe?.problem ?? null;
  const date = fromDateTimeLocal(when);
  const ready = !!probe && !problem && !!date && !saving;
  const upload = async () => {
    if (!probe || !date) return;
    setSaving(true);
    try {
      onCreated(await createUpload(file, { title, date, durationSec: probe.durationSec }));
    } catch (err) {
      setError(err instanceof Error && /quota/i.test(err.name) ? "There isn't enough space on this device to keep this recording." : "The recording couldn't be saved. Try again.");
      setSaving(false);
    }
  };

  return (
    <div data-testid="upload-panel" style={{ borderBottom: "var(--nb-border)", background: "hsl(var(--muted))", padding: "12px 24px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
        <strong style={{ fontSize: 14 }}>⬆ Upload recording</strong>
        <span style={{ fontWeight: 600, opacity: 0.8, overflowWrap: "anywhere" }}>
          {file.name} · {formatBytes(file.size)}
          {probe ? (probe.durationSec ? ` · ${formatLength(probe.durationSec)}` : "") : " · checking…"}
        </span>
      </div>
      {problem ? (
        <div role="alert" style={{ fontSize: 13, fontWeight: 700 }}>{problem}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, flex: "1 1 240px" }}>
              Title
              <input data-testid="upload-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={field} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700 }}>
              Recorded
              <input data-testid="upload-date" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={field} />
            </label>
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {signedIn
              ? `ProdLi's AI transcribes it and writes notes, like a recorded call. Uses about ${probe?.durationSec ? minutes(probe.durationSec) : "?"} min of your monthly transcription minutes. Keep this tab open until it's done; the file stays on this device.`
              : accountsEnabled()
                ? "Transcription needs a free ProdLi account: sign in (👤) first, or upload now to keep the audio and transcribe it later."
                : "Audio transcription isn't available in this copy of ProdLi; the recording is kept so you can play it back."}
          </div>
        </>
      )}
      {error && <div role="alert" style={{ fontSize: 13, fontWeight: 700 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!problem && (
          <button data-testid="upload-start" style={btn(true, !ready)} disabled={!ready} onClick={() => void upload()}>
            {saving ? "Saving…" : signedIn ? "Upload & transcribe" : "Upload"}
          </button>
        )}
        <button style={btn()} onClick={onClose}>{problem ? "Close" : "Cancel"}</button>
      </div>
    </div>
  );
}

/** On an uploaded meeting: transcription progress, or Retry when it isn't transcribed. */
export function UploadStatus({ meeting, signedIn, flash }: { meeting: Meeting; signedIn: boolean; flash: (msg: string) => void }) {
  const [job, setJob] = useState(() => uploadJob(meeting.id));
  useEffect(() => {
    setJob(uploadJob(meeting.id));
    return onUploadChange(() => setJob(uploadJob(meeting.id)));
  }, [meeting.id]);

  if (job) {
    const totalMs = meeting.durationSec * 1000;
    const pct = totalMs ? Math.min(100, (job.progress.doneMs / totalMs) * 100) : 0;
    return (
      <div data-testid="upload-progress" role="status" aria-live="polite" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span>
            Transcribing…{" "}
            {totalMs ? `${Math.floor(job.progress.doneMs / 60_000)} of ${minutes(meeting.durationSec)} min` : `${Math.floor(job.progress.doneMs / 60_000)} min done`}
            {job.progress.pieces ? ` · ${job.progress.pieces} piece${job.progress.pieces === 1 ? "" : "s"}` : ""}
            {job.progress.reused ? ` (${job.progress.reused} from the last try, not counted again)` : ""}
          </span>
          <button style={btn()} onClick={() => stopUpload(meeting.id)}>Stop</button>
        </div>
        {totalMs > 0 && (
          <div role="progressbar" aria-label="Transcription progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} style={{ height: 8, border: "var(--nb-border)", background: "hsl(var(--background))" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: ACCENT, transition: "width 0.3s" }} />
          </div>
        )}
        <div style={{ fontSize: 12, opacity: 0.8 }}>Keep this tab open until it finishes; you can switch sections.</div>
      </div>
    );
  }
  if (meeting.transcript.length || meeting.status === "processing" || !meeting.hasAudio) return null;
  const firstTime = !meeting.error && meeting.notice === SIGN_IN_TO_TRANSCRIBE_UPLOAD;
  const retry = () => {
    void processUpload(meeting.id).then((r) => flash(r.summarized ? "Notes ready" : r.transcribed ? "Transcript ready" : (r.problem ?? "Couldn't transcribe")));
  };
  return (
    <div data-testid="upload-retry" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
      <button style={btn(true)} onClick={retry}>
        {firstTime ? "🌐 Transcribe" : "↻ Retry"}
      </button>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{signedIn ? "Transcribes the recording with AI, then writes the notes." : "Needs a free ProdLi account (👤)."}</span>
    </div>
  );
}
