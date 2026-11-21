// Weekly review: the week's numbers, an AI look back (or a basic one), and next week's priorities.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { addDays, defaultReviewWeek, getDayKey, weekLabel, weekStart, weekStats, type DayRecord, type Habit, type Note, type Todo } from "@/shared";
import { writeReview } from "@/lib/ai";
import { addTodoFromText, updateDay, useList } from "@/lib/data";
import { haptic } from "@/lib/haptics";
import { useMeetings } from "@/lib/meetings";
import { useStored } from "@/lib/store";
import { TRACKING_KEY } from "@/lib/sync";
import { Banner, Button, Card, H2, IconButton, Input, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

function Stat({ value, label }: { value: string | number; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexBasis: "30%", flexGrow: 1, borderWidth: 2, borderColor: t.border, padding: 8, backgroundColor: t.card }}>
      <Text style={{ fontSize: 22, fontWeight: "900", color: t.fg }}>{value}</Text>
      <Text style={{ fontSize: font.tiny, color: t.mutedFg, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export default function ReviewScreen() {
  const t = useTheme();
  const today = getDayKey();
  const [start, setStart] = useState(defaultReviewWeek());
  const todos = useList<Todo>("todos");
  const habits = useList<Habit>("habits");
  const days = useList<DayRecord>("days");
  const notes = useList<Note>("notes");
  const sessions = useList<{ completedAt: string; duration?: number }>("pomodoroSessions");
  const tracking = useStored<Record<string, Record<string, number>>>(TRACKING_KEY, {});
  const meetings = useMeetings();
  const record = days.find((d) => d.id === start);
  const [note, setNote] = useState(record?.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  useEffect(() => setNote(record?.reviewNote ?? ""), [start, record?.reviewNote]);

  const stats = useMemo(() => weekStats({ start, today, todos, habits, days, sessions, tracking, meetings, notes: notes.filter((n) => !n.template) }), [start, today, todos, habits, days, sessions, tracking, meetings, notes]);
  const review = record?.review;
  const habitRate = stats.habits.length ? Math.round((stats.habits.reduce((n, h) => n + h.done, 0) / Math.max(1, stats.habits.reduce((n, h) => n + h.of, 0))) * 100) : null;
  const titles = new Set(todos.filter((x) => !x.completed).map((x) => x.title.trim().toLowerCase()));

  const write = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const r = await writeReview(stats, note);
      updateDay(start, { review: r.review, ...(note.trim() ? { reviewNote: note.trim() } : {}) });
      if (r.fallbackReason) setWhy(r.fallbackReason);
      haptic("success");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Row style={{ justifyContent: "space-between" }}>
        <IconButton icon="chevron-back" label="Previous week" onPress={() => setStart(addDays(start, -7))} />
        <Text accessibilityRole="header" style={{ fontWeight: "900", fontSize: font.h2, color: t.fg }}>{weekLabel(start)}</Text>
        <IconButton icon="chevron-forward" label="Next week" onPress={() => start < weekStart(today) && setStart(addDays(start, 7))} color={start < weekStart(today) ? t.fg : t.muted} />
      </Row>
      <Row style={{ flexWrap: "wrap" }}>
        <Stat value={stats.done.length} label="done" />
        <Stat value={stats.slipped.length} label="slipped" />
        <Stat value={stats.added} label="added" />
        <Stat value={stats.focus.sessions} label="focus sessions" />
        <Stat value={habitRate === null ? "—" : `${habitRate}%`} label="habits kept" />
        <Stat value={stats.meetings.count} label="meetings" />
      </Row>
      {stats.browsing.minutes ? <P muted style={{ fontSize: font.small }}>{Math.round((stats.browsing.minutes / 60) * 10) / 10} h of browsing on your computers{stats.browsing.focusScore !== null ? ` · focus score ${stats.browsing.focusScore}` : ""}.</P> : null}

      <Input label="Your notes on the week (optional, used by the AI)" placeholder="What went well? What got in the way?" value={note} onChangeText={setNote} multiline style={{ minHeight: 70, textAlignVertical: "top" }} onEndEditing={() => note.trim() !== (record?.reviewNote ?? "") && updateDay(start, { reviewNote: note.trim() })} maxLength={1500} />
      <Button variant="ask" icon="sparkles" title={review ? "Write it again" : "Write my weekly review"} busy={busy} onPress={() => void write()} />
      {why ? <Banner text={why} /> : null}

      {review ? (
        <>
          <Card>
            <Text style={{ fontWeight: "900", fontSize: font.h2, color: t.fg }}>{review.headline}</Text>
            <P>{review.summary}</P>
            <P muted style={{ fontSize: font.tiny }}>{review.source === "basic" ? "Basic review (no AI)" : "Written by ProdLi AI"}</P>
          </Card>
          {review.wins.length ? (<><H2>Wins</H2>{review.wins.map((w, i) => <P key={i}>🏆 {w}</P>)}</>) : null}
          {review.slipped.length ? (<><H2>Slipped</H2>{review.slipped.map((s, i) => <P key={i}><Text style={{ fontWeight: "800" }}>{s.title}</Text> — {s.suggestion}</P>)}</>) : null}
          {review.patterns.length ? (<><H2>Patterns</H2>{review.patterns.map((p, i) => <P key={i}>• {p}</P>)}</>) : null}
          {review.nextWeek.length ? (
            <>
              <H2>Next week</H2>
              {review.nextWeek.map((n, i) => {
                const have = titles.has(n.title.trim().toLowerCase());
                return (
                  <Card key={i}>
                    <P style={{ fontWeight: "800" }}>{i + 1}. {n.title}</P>
                    <P muted style={{ fontSize: font.small }}>{n.reason}</P>
                    <Button small variant={have ? "ghost" : "secondary"} disabled={have} icon={have ? "checkmark" : "add"} title={have ? "On your list" : "Add to-do"} onPress={() => (addTodoFromText(n.title), haptic("success"))} />
                  </Card>
                );
              })}
            </>
          ) : null}
          {review.habitTip ? <P muted>💡 {review.habitTip}</P> : null}
          {review.question ? <Card><P style={{ fontWeight: "800" }}>🤔 {review.question}</P></Card> : null}
        </>
      ) : null}
    </Screen>
  );
}
