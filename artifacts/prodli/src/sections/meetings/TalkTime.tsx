// A meeting's "Talk time" (Pro): how the talking was split between you and the
// others, your longest stretch, and how often the turn changed. From the
// speaker timeline recorded on this device (recorder/speakers.ts).

import { talkStats } from "../../recorder/speakers";
import type { Meeting } from "../../recorder/types";
import { ProBadge, ProNote, useProAccess } from "../../components/Pro";

const mins = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

export function TalkTime({ meeting }: { meeting: Meeting }) {
  const access = useProAccess();
  const stats = talkStats(meeting.speakerActivity);
  if (!stats) return null;
  const locked = !!access && !access.allowed;
  return (
    <div data-testid="talk-time" style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <div style={{ fontWeight: 800 }}>
        Talk time
        <ProBadge />
      </div>
      {locked ? (
        <ProNote access={access} what="Talk-time insights" />
      ) : (
        <>
          <div role="img" aria-label={`You talked ${stats.youShare}% of the time, the others ${100 - stats.youShare}%`} style={{ display: "flex", height: 14, border: "var(--nb-border)" }}>
            <div style={{ width: `${stats.youShare}%`, background: "#FF4FA3" }} />
            <div style={{ flex: 1, background: "#60A5FA" }} />
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontWeight: 700 }}>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 9, height: 9, background: "#FF4FA3", marginRight: 4 }} />
              You {stats.youShare}% ({mins(stats.youMs)})
            </span>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 9, height: 9, background: "#60A5FA", marginRight: 4 }} />
              Others {100 - stats.youShare}% ({mins(stats.othersMs)})
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Your longest stretch: {mins(stats.longestYouMs)} · the turn changed {stats.turns} time{stats.turns === 1 ? "" : "s"}
            {stats.youShare >= 70 ? ". You did most of the talking; asking more questions often helps." : stats.youShare <= 20 ? ". You mostly listened." : "."}
          </div>
          {access?.earlyAccess && <ProNote access={access} what="Talk-time insights" />}
        </>
      )}
    </div>
  );
}
