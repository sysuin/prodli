// Habits: today's progress, streaks and the last 7 days. Tap to log; long-press to edit.
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { addAmount, bestStreak, currentStreak, getDayKey, isDone, isScheduled, kindOf, progressLabel, setAmount, amountOn, toggleCheck, type Habit } from "@/shared";
import { replaceHabit, useList } from "@/lib/data";
import { haptic } from "@/lib/haptics";
import { Button, Card, Empty, IconButton, P, Row, Screen, Title } from "@/ui/kit";
import { SyncPill } from "@/ui/SyncPill";
import { font, useTheme } from "@/ui/theme";

function lastDays(n: number, today: string): string[] {
  const out: string[] = [];
  const d = new Date(`${today}T12:00:00`);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(getDayKey(x));
  }
  return out;
}

function HabitCard({ h, today }: { h: Habit; today: string }) {
  const t = useTheme();
  const kind = kindOf(h);
  const done = isDone(h, today);
  const restDay = !isScheduled(h, today) && !done;
  const streak = currentStreak(h, today);
  const days = lastDays(7, today);
  const log = () => {
    haptic(done ? "light" : "success");
    replaceHabit(kind === "check" ? toggleCheck(h, today) : addAmount(h, today, kind === "timed" ? 5 : 1));
  };
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Pressable style={{ flex: 1 }} onLongPress={() => router.push({ pathname: "/habit/edit", params: { id: h.id } })} onPress={() => router.push({ pathname: "/habit/edit", params: { id: h.id } })} accessibilityRole="button" accessibilityLabel={`Edit ${h.name}`}>
          <Text style={{ fontWeight: "900", fontSize: font.h2, color: t.fg }}>
            {h.emoji} {h.name}
          </Text>
          <P muted style={{ fontSize: font.small }}>
            {restDay ? "not scheduled today" : progressLabel(h, today)}
            {streak ? ` · 🔥 ${streak} day${streak > 1 ? "s" : ""}` : ""}
            {` · best ${bestStreak(h, today)}`}
          </P>
        </Pressable>
        {kind === "check" ? (
          <Pressable onPress={log} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`${h.name} done today`} style={{ width: 48, height: 48, borderWidth: 2, borderColor: t.border, backgroundColor: done ? h.color : "transparent", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 22, fontWeight: "900", color: "#000" }}>{done ? "✓" : ""}</Text>
          </Pressable>
        ) : (
          <Row gap={4}>
            <IconButton icon="remove-circle-outline" label={`Less ${h.name}`} onPress={() => replaceHabit(setAmount(h, today, Math.max(0, amountOn(h, today) - (kind === "timed" ? 5 : 1))))} />
            <IconButton icon="add-circle" label={`More ${h.name}`} onPress={log} color={done ? t.success : t.fg} size={30} />
          </Row>
        )}
      </Row>
      <Row gap={6}>
        {days.map((d) => {
          const on = isDone(h, d);
          const scheduled = isScheduled(h, d);
          return (
            <View key={d} accessibilityLabel={`${d}: ${on ? "done" : scheduled ? "not done" : "not scheduled"}`} style={{ flex: 1, alignItems: "center", gap: 2 }}>
              <Text style={{ fontSize: font.tiny, color: t.mutedFg, fontWeight: "700" }}>{new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" })}</Text>
              <View style={{ width: "100%", aspectRatio: 1, maxWidth: 30, borderWidth: 2, borderColor: t.border, backgroundColor: on ? h.color : scheduled ? "transparent" : t.muted, opacity: scheduled ? 1 : 0.5 }} />
            </View>
          );
        })}
      </Row>
    </Card>
  );
}

export default function HabitsScreen() {
  const habits = useList<Habit>("habits");
  const today = getDayKey();
  const active = habits.filter((h) => !h.archived);
  const doneCount = active.filter((h) => isScheduled(h, today) && isDone(h, today)).length;
  const scheduled = active.filter((h) => isScheduled(h, today)).length;
  return (
    <Screen>
      <Title right={<SyncPill />}>Habits</Title>
      <Row style={{ justifyContent: "space-between" }}>
        <P muted>{scheduled ? `${doneCount} of ${scheduled} done today` : "Build a habit, one day at a time."}</P>
        <Button small title="New habit" icon="add" onPress={() => router.push("/habit/edit")} />
      </Row>
      {active.length ? active.map((h) => <HabitCard key={h.id} h={h} today={today} />) : <Empty icon="flame-outline" title="No habits yet" hint="Add one — a daily check, a count (8 glasses), minutes (20 min reading), or something to quit." />}
    </Screen>
  );
}
