// A small "● Recording in person" chip shown on other ProdLi sections while an
// in-person recording runs (sections/meetings/InPerson.tsx). Click to go back.

import { useEffect, useState } from "react";
import { currentInPerson, onInPersonChange } from "../recorder/inPersonState";

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};

export function InPersonChip({ onOpen }: { onOpen: () => void }) {
  const [rec, setRec] = useState(currentInPerson);
  const [now, setNow] = useState(Date.now());
  useEffect(() => onInPersonChange(() => setRec(currentInPerson())), []);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rec]);
  if (!rec) return null;
  return (
    <button
      data-testid="in-person-chip"
      onClick={onOpen}
      title="Open Meetings to stop the recording"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 1500, display: "flex", alignItems: "center", gap: 8, border: "2px solid #000", background: "#000", color: "#fff", padding: "8px 12px", fontFamily: "inherit", fontWeight: 800, fontSize: 12, cursor: "pointer", boxShadow: "3px 3px 0 #FF4FA3" }}
    >
      <span className="timer-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: "#E53935", display: "inline-block" }} />
      {rec.kind === "call" ? "Recording a call" : "Recording in person"} · {clock(Math.max(0, now - rec.startedAt))}
    </button>
  );
}
