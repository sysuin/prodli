// Today: focus, today's to-dos, habits, the daily brief and the evening reflection.
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { reviewDue, weekLabel, getDayKey, isDone, isScheduled, progressLabel, toggleCheck, addAmount, kindOf, type DayRecord, type Habit, type Todo } from "@/shared";
import { addTodoFromText, replaceHabit, updateDay, useDay, useList } from "@/lib/data";
import { briefContext, greeting, isForToday, writeBrief } from "@/lib/ai";
import { useMeetings } from "@/lib/meetings";
import { haptic } from "@/lib/haptics";
import { Banner, Button, Card, H2, IconButton, Input, LogoMark, P, Row, Screen } from "@/ui/kit";
import { SyncPill } from "@/ui/SyncPill";
import { TodoRow } from "@/ui/TodoRow";
import { font, useTheme } from "@/ui/theme";

/** The day key, refreshed when the date changes while the app is open. */
function useToday(): string {
  const [day, setDay] = useState(getDayKey());
  useEffect(() => {
    const id = setInterval(() => setDay(getDayKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  return day;
}

export default function TodayScreen() {
  const t = useTheme();
  const today = useToday();
  const todos = useList<Todo>("todos");
  const habits = useList<Habit>("habits");
  const days = useList<DayRecord>("days");
  const meetings = useMeetings();
  const sessions = useList<{ completedAt: string }>("pomodoroSessions");
  const day = useDay(today);
  const [quick, setQuick] = useState("");
  const [focus, setFocus] = useState(day?.focus ?? "");
  const [reflection, setReflection] = useState(day?.reflection ?? "");
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefNote, setBriefNote] = useState<string | null>(null);

  // Keep the inputs in step with edits from other devices (unless typing).
  useEffect(() => setFocus(day?.focus ?? ""), [day?.focus]);
  useEffect(() => setReflection(day?.reflection ?? ""), [day?.reflection]);

  const forToday = useMemo(() => todos.filter((x) => isForToday(x, today)).sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99")), [todos, today]);
  const doneToday = useMemo(() => todos.filter((x) => x.completed && x.completedAt && getDayKey(x.completedAt) === today), [todos, today]);
  const habitsToday = useMemo(() => habits.filter((h) => !h.archived && isScheduled(h, today)), [habits, today]);
  const hour = new Date().getHours();
  const date = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const generate = async () => {
    setBriefBusy(true);
    setBriefNote(null);
    try {
      const ctx = briefContext({ now: new Date(), todos, habits, meetings, days, sessions });
      const r = await writeBrief(ctx);
      updateDay(today, { brief: r.brief });
      if (r.fallbackReason) setBriefNote(r.fallbackReason);
    } finally {
      setBriefBusy(false);
    }
  };

  const brief = day?.brief;
  const reviewWeek = reviewDue(days);
  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <Row>
          <LogoMark size={26} />
          <Text style={{ backgroundColor: t.primary, color: "#000", fontWeight: "900", fontSize: 16, paddingHorizontal: 8, paddingVertical: 2 }}>ProdLi</Text>
        </Row>
        <Row gap={4}>
          <IconButton icon="search" label="Search" onPress={() => router.push("/search")} />
          <SyncPill />
        </Row>
      </Row>
      <View>
        <Text accessibilityRole="header" style={{ fontSize: font.title, fontWeight: "900", color: t.fg, letterSpacing: -0.5 }}>
          {greeting()}
        </Text>
        <P muted>{date}</P>
      </View>

      {reviewWeek ? (
        <Card color={t.ask} onPress={() => router.push("/review")} accessibilityLabel={`Weekly review for ${weekLabel(reviewWeek)}`}>
          <Text style={{ fontWeight: "900", color: "#000" }}>🗓 Your weekly review is ready ({weekLabel(reviewWeek)})</Text>
          <Text style={{ color: "#000", fontSize: font.small }}>What got done, what slipped, and next week's top three.</Text>
        </Card>
      ) : null}

      <Card>
        <Text style={{ fontWeight: "900", color: t.fg }}>🎯 Today's focus</Text>
        <Input placeholder="The one thing that would make today a win" value={focus} onChangeText={setFocus} onEndEditing={() => focus !== (day?.focus ?? "") && updateDay(today, { focus: focus.trim() })} returnKeyType="done" maxLength={300} />
      </Card>

      <H2 right={<Text style={{ color: t.mutedFg, fontWeight: "800", fontSize: font.small }}>{doneToday.length ? `${doneToday.length} done today` : ""}</Text>}>To-dos for today</H2>
      <Input
        placeholder="Add a to-do… try “Call Sam tomorrow 3pm !high”"
        value={quick}
        onChangeText={setQuick}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (addTodoFromText(quick, { planToday: true })) {
            haptic();
            setQuick("");
          }
        }}
        submitBehavior="submit"
      />
      {forToday.length ? (
        <View>{forToday.map((x) => <TodoRow key={x.id} todo={x} today={today} />)}</View>
      ) : (
        <P muted>Nothing planned yet. Add a to-do above, or plan one from To-dos.</P>
      )}

      {habitsToday.length ? (
        <>
          <H2>Habits</H2>
          <Row style={{ flexWrap: "wrap" }}>
            {habitsToday.map((h) => {
              const done = isDone(h, today);
              return (
                <Pressable
                  key={h.id}
                  onPress={() => {
                    haptic(done ? "light" : "success");
                    replaceHabit(kindOf(h) === "check" ? toggleCheck(h, today) : addAmount(h, today, kindOf(h) === "timed" ? 5 : 1));
                  }}
                  onLongPress={() => router.push({ pathname: "/habit/edit", params: { id: h.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.name}: ${progressLabel(h, today)}${done ? ", done" : ""}`}
                  style={{ borderWidth: 2, borderColor: t.border, backgroundColor: done ? h.color : "transparent", paddingHorizontal: 10, paddingVertical: 8 }}
                >
                  <Text style={{ fontWeight: "800", color: done ? "#000" : t.fg }}>
                    {h.emoji} {h.name} <Text style={{ fontWeight: "500", fontSize: font.small }}>{progressLabel(h, today)}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </>
      ) : null}

      <H2>Daily brief</H2>
      {brief ? (
        <Card>
          <Text style={{ fontWeight: "900", fontSize: font.h2, color: t.fg }}>{brief.headline}</Text>
          <P>{brief.summary}</P>
          {brief.priorities.length ? (
            <View style={{ gap: 4 }}>
              {brief.priorities.map((p, i) => (
                <P key={i}>
                  <Text style={{ fontWeight: "900" }}>{i + 1}. {p.title}</Text> — {p.reason}
                </P>
              ))}
            </View>
          ) : null}
          {brief.watchouts.length ? <P muted>⚠️ {brief.watchouts.join(" · ")}</P> : null}
          {brief.tip ? <P muted>💡 {brief.tip}</P> : null}
          <Row style={{ justifyContent: "space-between" }}>
            <P muted style={{ fontSize: font.tiny }}>{brief.source === "basic" ? "Basic brief (no AI)" : "Written by ProdLi AI"}</P>
            <Button small variant="ghost" title="Rewrite" icon="refresh" onPress={generate} busy={briefBusy} />
          </Row>
        </Card>
      ) : (
        <Card>
          <P>Get a short plan for today from your to-dos, habits and meeting action items.</P>
          <Button title="Write my brief" icon="sparkles" onPress={generate} busy={briefBusy} variant="ask" />
        </Card>
      )}
      {briefNote ? <Banner text={briefNote} /> : null}

      <Row>
        <Button style={{ flex: 1 }} title="Ask ProdLi" icon="chatbubble-ellipses" variant="ask" onPress={() => router.push("/ask")} />
        <Button style={{ flex: 1 }} title="Focus 25 min" icon="timer" variant="secondary" onPress={() => router.push("/pomodoro")} />
      </Row>

      {hour >= 16 || reflection ? (
        <>
          <H2>Evening reflection</H2>
          <Input placeholder="How did today go? What would you do differently?" value={reflection} onChangeText={setReflection} multiline style={{ minHeight: 90, textAlignVertical: "top" }} onEndEditing={() => reflection !== (day?.reflection ?? "") && updateDay(today, { reflection: reflection.trim() })} maxLength={2000} />
        </>
      ) : null}
    </Screen>
  );
}
