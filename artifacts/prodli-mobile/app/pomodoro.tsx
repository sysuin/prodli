import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { getDayKey } from "@/shared";
import { recordPomodoro, useList, type PomodoroSession } from "@/lib/data";
import { haptic } from "@/lib/haptics";
import { next, pause, saveTimer, secondsLeft, settings, start, TIMER_KEY, totalOf, withPhase, freshTimer, type Phase, type TimerState } from "@/lib/pomodoro";
import { cancelPomodoroEnd, schedulePomodoroEnd } from "@/lib/reminders";
import { useStored } from "@/lib/store";
import { Button, Card, Chip, H2, Input, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

const LABEL: Record<Phase, string> = { work: "Focus", "short-break": "Short break", "long-break": "Long break" };
const COLOR: Record<Phase, string> = { work: "#FFD700", "short-break": "#66BB6A", "long-break": "#33BBFF" };
/** Saves the timer and keeps the "phase finished" notification in step with it. */
function setTimer(next: TimerState) {
  saveTimer(next);
  if (next.running && next.endsAt) void schedulePomodoroEnd(next.endsAt, next.phase === "work" ? "Focus session done 🎉" : "Break's over", next.phase === "work" ? "Time for a break." : "Ready for the next focus session?");
  else void cancelPomodoroEnd();
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function PomodoroScreen() {
  const t = useTheme();
  const stored = useStored<TimerState | null>(TIMER_KEY, null);
  const timer = stored ?? freshTimer();
  const sessions = useList<PomodoroSession>("pomodoroSessions");
  const completed = useStored<number>("completedPomodoros", 0);
  const [now, setNow] = useState(Date.now());
  const left = secondsLeft(timer, now);

  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [timer.running]);

  // A phase finished (also while the app was closed): record it and move on.
  useEffect(() => {
    if (!timer.running || left > 0) return;
    if (timer.phase === "work") recordPomodoro(timer.label.trim() || "Focus", settings().workDuration, new Date(timer.endsAt ?? Date.now()));
    haptic("success");
    setTimer(next(timer, settings()));
  }, [left, timer]);

  const today = getDayKey();
  const todayCount = sessions.filter((s) => getDayKey(s.completedAt) === today).length;
  return (
    <Screen edges={[]}>
      <Row>
        {(["work", "short-break", "long-break"] as Phase[]).map((p) => (
          <Chip key={p} label={LABEL[p]} active={timer.phase === p} color={COLOR[p]} onPress={() => setTimer(withPhase(timer, p))} />
        ))}
      </Row>
      <Card color={COLOR[timer.phase]} style={{ alignItems: "center", paddingVertical: 28 }}>
        <Text style={{ fontWeight: "900", color: "#000", fontSize: font.h2 }}>{LABEL[timer.phase]}</Text>
        <Text accessibilityRole="timer" accessibilityLabel={`${Math.floor(left / 60)} minutes ${left % 60} seconds left`} style={{ fontSize: 72, fontWeight: "900", color: "#000", fontVariant: ["tabular-nums"] }}>
          {mmss(left)}
        </Text>
      </Card>
      {timer.phase === "work" ? <Input placeholder="What are you focusing on?" value={timer.label} onChangeText={(label) => saveTimer({ ...timer, label })} maxLength={120} /> : null}
      <Row>
        <Button style={{ flex: 2 }} title={timer.running ? "Pause" : timer.remaining < totalOf(timer.phase, settings()) ? "Resume" : "Start"} icon={timer.running ? "pause" : "play"} onPress={() => (haptic(), setTimer(timer.running ? pause(timer) : start(timer)))} />
        <Button style={{ flex: 1 }} variant="ghost" title="Reset" icon="refresh" onPress={() => setTimer(withPhase(timer, timer.phase))} />
        <Button style={{ flex: 1 }} variant="ghost" title="Skip" icon="play-skip-forward" onPress={() => setTimer(next(pause(timer), settings()))} />
      </Row>
      <P muted>You can leave the app: the session finishes on time, you get a notification (if allowed), and it is recorded when you come back.</P>
      <H2>Today</H2>
      <P>
        <Text style={{ fontWeight: "900" }}>{todayCount}</Text> focus session{todayCount === 1 ? "" : "s"} today · {completed} all time
      </P>
      <View style={{ gap: 4 }}>
        {sessions.slice(0, 8).map((s) => (
          <P key={s.id} muted style={{ fontSize: font.small }}>
            {new Date(s.completedAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} · {s.label} · {s.duration} min
          </P>
        ))}
      </View>
    </Screen>
  );
}
