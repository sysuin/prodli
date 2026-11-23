// Today: last month's recap (first days of a month) and, in the last 3 days of
// the free Pro trial, what the trial covered with an Upgrade button.
// Counted on this device (lib/valueRecap.ts).

import { useEffect, useState, type CSSProperties } from "react";
import { storageGet, storageSet } from "../../lib/storage";
import { openUpgrade, trialDaysLeft } from "../../lib/billing";
import { DICTATION_HISTORY_KEY } from "../../dictation/core";
import { dismissMonth, dismissTrialToday, monthRecapWindow, NO_RECAP_STATE, RECAP_KEY, recapPhrases, recapStats, trialReminderDue, type RecapInput, type RecapState } from "../../lib/valueRecap";
import type { Habit, Todo } from "../../types";

const card: CSSProperties = { border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" };
const btn = (primary = false): CSSProperties => ({
  border: "var(--nb-border)",
  background: primary ? "#FFD700" : "hsl(var(--card))",
  color: primary ? "#000" : "hsl(var(--foreground))",
  padding: "6px 12px",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  fontFamily: "inherit",
});

async function loadInput(): Promise<RecapInput> {
  const [todos, habits, sessions, dictation] = await Promise.all([
    storageGet<Todo[]>("todos", []),
    storageGet<Habit[]>("habits", []),
    storageGet<{ completedAt: string; duration: number }[]>("pomodoroSessions", []),
    storageGet<{ at: string; words: number }[]>(DICTATION_HISTORY_KEY, []),
  ]);
  let meetings: RecapInput["meetings"] = [];
  try {
    meetings = await (await import("../../recorder/db")).listMeetings();
  } catch {
    // No IndexedDB (some previews): meetings just don't count.
  }
  return { todos, habits, sessions, dictation, meetings };
}

const sentence = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

export function ValueRecap({ trialEndsAt }: { trialEndsAt?: number | null }) {
  const [state, setState] = useState<RecapState | null>(null);
  const [input, setInput] = useState<RecapInput | null>(null);

  useEffect(() => {
    void storageGet<RecapState>(RECAP_KEY, NO_RECAP_STATE).then((s) => setState({ ...NO_RECAP_STATE, ...s }));
    void loadInput().then(setInput);
  }, []);

  if (!state || !input) return null;
  const now = new Date();
  const save = (next: RecapState) => {
    setState(next);
    void storageSet(RECAP_KEY, next);
  };

  if (trialEndsAt && trialReminderDue(trialEndsAt, now, state)) {
    const left = trialDaysLeft(trialEndsAt, now.getTime());
    const parts = recapPhrases(recapStats(input, trialEndsAt - 14 * 86_400_000, now.getTime() + 1));
    return (
      <section style={{ ...card, borderLeft: "6px solid #FFD700" }} data-testid="trial-reminder" aria-label="Your Pro trial">
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
          ⭐ Your Pro trial ends {left === 1 ? "tomorrow" : `in ${left} days`}.{parts.length ? ` So far ProdLi ${sentence(parts)}.` : ""} After that you're on the free plan: nothing is deleted, Pro features and higher AI limits stop.
        </span>
        <button style={btn(true)} onClick={openUpgrade} data-testid="trial-upgrade">
          Keep Pro
        </button>
        <button style={btn()} onClick={() => save(dismissTrialToday(state, now))} aria-label="Hide for today">
          Not now
        </button>
      </section>
    );
  }

  const month = monthRecapWindow(now, state);
  if (!month) return null;
  const parts = recapPhrases(recapStats(input, month.from, month.to));
  if (!parts.length) return null;
  return (
    <section style={{ ...card, borderLeft: "6px solid #8B5CF6" }} data-testid="month-recap" aria-label={`Your ${month.label} in ProdLi`}>
      <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
        📈 Your {month.label} in ProdLi: {sentence(parts)}.
      </span>
      <button style={btn()} onClick={() => save(dismissMonth(state, month.id))}>
        Nice
      </button>
    </section>
  );
}
