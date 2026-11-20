// Add or edit a habit.
import { goBack } from "@/lib/nav";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { type Habit } from "@/shared";
import { addHabit, deleteHabit, HABIT_COLORS, replaceHabit, useList } from "@/lib/data";
import { Button, Chip, H2, Input, P, Row, Screen } from "@/ui/kit";
import { useTheme } from "@/ui/theme";

const KINDS = [
  { id: "check", label: "Daily check", hint: "Done or not" },
  { id: "count", label: "Count", hint: "e.g. 8 glasses" },
  { id: "timed", label: "Minutes", hint: "e.g. 20 min" },
  { id: "quit", label: "Quit", hint: "At most N a day" },
] as const;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const EMOJIS = ["✅", "💧", "📚", "🏃", "🧘", "💪", "🥗", "😴", "✍️", "🎸", "🚭", "📵"];

export default function HabitEdit() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const habits = useList<Habit>("habits");
  const existing = id ? habits.find((h) => h.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [emoji, setEmoji] = useState(existing?.emoji ?? "✅");
  const [color, setColor] = useState(existing?.color ?? HABIT_COLORS[habits.length % HABIT_COLORS.length]);
  const [kind, setKind] = useState<NonNullable<Habit["kind"]>>(existing?.kind ?? "check");
  const [target, setTarget] = useState(String(existing?.target ?? (kind === "quit" ? 0 : kind === "timed" ? 20 : 8)));
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [days, setDays] = useState<number[] | undefined>(existing?.days);

  const save = () => {
    if (!name.trim()) return Alert.alert("Name your habit", "For example “Drink water” or “Read”.");
    const n = Number(target);
    const fields: Partial<Habit> = { name: name.trim().slice(0, 100), emoji, color, kind, days: days?.length ? [...days].sort() : undefined, ...(kind === "check" ? { target: undefined, unit: undefined } : { target: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 1, unit: kind === "count" ? unit.trim() || undefined : undefined }) };
    if (existing) replaceHabit({ ...existing, ...fields });
    else addHabit({ name: fields.name!, emoji, ...fields });
    goBack();
  };

  return (
    <Screen edges={[]}>
      <Input label="Name" placeholder="Drink water" value={name} onChangeText={setName} autoFocus={!existing} maxLength={100} />
      <H2>Icon</H2>
      <Row style={{ flexWrap: "wrap" }}>
        {EMOJIS.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e)} accessibilityRole="button" accessibilityState={{ selected: emoji === e }} accessibilityLabel={`Icon ${e}`} style={{ borderWidth: 2, borderColor: emoji === e ? t.border : "transparent", padding: 6 }}>
            <Text style={{ fontSize: 24 }}>{e}</Text>
          </Pressable>
        ))}
      </Row>
      <H2>Color</H2>
      <Row>
        {HABIT_COLORS.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} accessibilityRole="button" accessibilityState={{ selected: color === c }} accessibilityLabel={`Color ${c}`} style={{ width: 36, height: 36, backgroundColor: c, borderWidth: color === c ? 4 : 2, borderColor: t.border }} />
        ))}
      </Row>
      <H2>Kind</H2>
      <Row style={{ flexWrap: "wrap" }}>
        {KINDS.map((k) => (
          <Chip key={k.id} label={k.label} active={kind === k.id} onPress={() => setKind(k.id)} />
        ))}
      </Row>
      <P muted>{KINDS.find((k) => k.id === kind)?.hint}</P>
      {kind !== "check" ? (
        <Row>
          <Input label={kind === "quit" ? "At most per day" : kind === "timed" ? "Minutes per day" : "Times per day"} value={target} onChangeText={setTarget} keyboardType="number-pad" style={{ width: 120 }} />
          {kind === "count" ? <Input label="Unit" placeholder="glasses" value={unit} onChangeText={setUnit} style={{ width: 160 }} /> : null}
        </Row>
      ) : null}
      <H2>Days</H2>
      <Row>
        {WEEKDAYS.map((d, i) => {
          const on = !days || days.includes(i);
          return <Chip key={i} label={d} active={on} onPress={() => setDays((cur) => { const base = cur ?? [0, 1, 2, 3, 4, 5, 6]; const next = base.includes(i) ? base.filter((x) => x !== i) : [...base, i]; return next.length === 7 ? undefined : next; })} />;
        })}
      </Row>
      <P muted>Days it isn't scheduled never break a streak.</P>
      <Button title={existing ? "Save" : "Add habit"} icon="checkmark" onPress={save} />
      {existing ? (
        <Row>
          <Button style={{ flex: 1 }} variant="ghost" title="Archive" icon="archive-outline" onPress={() => (replaceHabit({ ...existing, archived: true }), goBack())} />
          <Button
            style={{ flex: 1 }}
            variant="danger"
            title="Delete"
            icon="trash-outline"
            onPress={() =>
              Alert.alert("Delete this habit?", "Its history is deleted on all your devices. Archive keeps it.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => (deleteHabit(existing.id), goBack()) },
              ])
            }
          />
        </Row>
      ) : null}
    </Screen>
  );
}
