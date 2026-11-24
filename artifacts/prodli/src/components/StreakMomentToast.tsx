// The little celebration after a streak milestone (3, 7, 14, 30, 100 days…)
// or a newly earned streak freeze. Shown by Habits and Today; goes away by itself.
import { useEffect } from "react";
import { momentText, type StreakMoment } from "../lib/habits";

export function StreakMomentToast({ moment, quit, onClose }: { moment: StreakMoment; quit?: boolean; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [moment, onClose]);
  const { title, detail } = momentText(moment, quit);
  return (
    <div role="status" aria-live="polite" data-testid="streak-moment" className="streak-moment">
      <div className="streak-moment-burst" aria-hidden>
        {["🎉", "✨", "🔥", "⭐", "🎉", "✨"].map((e, i) => (
          <span key={i} style={{ ["--i" as string]: i }}>{e}</span>
        ))}
      </div>
      <span style={{ fontSize: 30 }} aria-hidden>{moment.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
          {moment.name}
          {detail ? ` · ${detail}` : ""}
        </div>
      </div>
      <button onClick={onClose} aria-label="Close" style={{ border: "2px solid #000", background: "#fff", color: "#000", width: 26, height: 26, cursor: "pointer", fontWeight: 900, fontFamily: "inherit" }}>
        ✕
      </button>
    </div>
  );
}
