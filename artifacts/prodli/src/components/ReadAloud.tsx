// ▶ Listen / ⏸ Pause / ⏹ Stop for notes and saved pages, with a voice and
// speed picker (remembered). See lib/readAloud.ts.

import { useEffect, useId, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  currentReadAloudPrefs,
  ensureReadAloudPrefs,
  pauseReading,
  RATES,
  readAloudAvailable,
  readAloudStatus,
  resumeReading,
  setReadAloudPrefs,
  startReading,
  stopReading,
  subscribeReadAloud,
  type ReadAloudState,
} from "../lib/readAloud";

/** This component's reader: its state (idle unless it's the one speaking) and controls. */
export function useReadAloud() {
  const owner = useId();
  const status = useSyncExternalStore(subscribeReadAloud, () => {
    const s = readAloudStatus();
    return s.owner === owner ? s.state : "idle";
  });
  useEffect(() => {
    void ensureReadAloudPrefs();
    return () => stopReading(owner);
  }, [owner]);
  return {
    available: readAloudAvailable(),
    state: status as ReadAloudState,
    start: (text: string) => startReading(text, owner),
    pause: pauseReading,
    resume: resumeReading,
    stop: () => stopReading(owner),
  };
}

const btn: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "3px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const pick: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 11, fontWeight: 700, padding: "2px 4px", fontFamily: "inherit", maxWidth: 160 };

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (readAloudAvailable() ? window.speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!readAloudAvailable()) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener?.("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", update);
  }, []);
  return voices;
}

/** Voice and speed, remembered for next time. */
function VoicePicker() {
  const voices = useVoices();
  const [prefs, setPrefs] = useState(currentReadAloudPrefs);
  useEffect(() => {
    void ensureReadAloudPrefs().then(setPrefs);
  }, []);
  const change = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setReadAloudPrefs(next);
  };
  return (
    <>
      <select aria-label="Reading speed" title="Reading speed" value={String(prefs.rate)} onChange={(e) => change({ rate: Number(e.target.value) })} style={pick}>
        {RATES.map((r) => (
          <option key={r} value={String(r)}>{r}×</option>
        ))}
      </select>
      {voices.length > 0 && (
        <select aria-label="Voice" title="Voice" value={prefs.voice} onChange={(e) => change({ voice: e.target.value })} style={pick}>
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.lang ? ` (${v.lang})` : ""}</option>
          ))}
        </select>
      )}
    </>
  );
}

/** Pause / Resume, Stop, speed and voice for a reader that's speaking. */
export function ReadAloudBar({ reader, label }: { reader: ReturnType<typeof useReadAloud>; label?: string }) {
  if (reader.state === "idle") return null;
  return (
    <div role="group" aria-label="Read aloud" data-testid="read-aloud-bar" style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {label && <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginRight: 2 }}>{label}</span>}
      {reader.state === "playing" ? (
        <button type="button" style={btn} onClick={reader.pause}>⏸ Pause</button>
      ) : (
        <button type="button" style={btn} onClick={reader.resume}>▶ Resume</button>
      )}
      <button type="button" style={btn} onClick={reader.stop}>⏹ Stop</button>
      <VoicePicker />
    </div>
  );
}
