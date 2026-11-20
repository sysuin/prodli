// One to-do: title, due date and time, priority, list, labels, subtasks.
import { goBack } from "@/lib/nav";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { getDayKey, repeatLabel, type ListItem, type Todo } from "@/shared";
import { addSubtask, deleteTodo, removeSubtask, togglePlanToday, toggleSubtask, toggleTodoDone, updateTodo, useList } from "@/lib/data";
import { Button, Checkbox, Chip, Empty, H2, IconButton, Input, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return getDayKey(d);
};

export default function TodoDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const todos = useList<Todo>("todos");
  const lists = useList<ListItem>("lists");
  const todo = todos.find((x) => x.id === id);
  const [title, setTitle] = useState(todo?.title ?? "");
  const [sub, setSub] = useState("");
  const [labels, setLabels] = useState((todo?.labels ?? []).join(", "));
  const [date, setDate] = useState(todo?.dueDate ?? "");
  const [time, setTime] = useState(todo?.dueTime ?? "");
  useEffect(() => setTitle(todo?.title ?? ""), [todo?.title]);
  if (!todo) return <Screen edges={[]}><Empty icon="help-circle-outline" title="This to-do is gone" hint="It may have been deleted on another device." /></Screen>;

  const today = getDayKey();
  const planned = !!todo.plannedFor && todo.plannedFor <= today;
  const setDue = (d: string | undefined) => {
    setDate(d ?? "");
    updateTodo(todo.id, { dueDate: d, ...(d ? {} : { dueTime: undefined }) });
  };
  const saveDate = () => {
    const ok = !date || /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!ok) return Alert.alert("Date", "Use the format YYYY-MM-DD, e.g. 2026-12-01.");
    updateTodo(todo.id, { dueDate: date || undefined });
  };
  const saveTime = () => {
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return Alert.alert("Time", "Use 24-hour HH:MM, e.g. 15:30.");
    updateTodo(todo.id, { dueTime: time || undefined, ...(time && !todo.dueDate ? { dueDate: today } : {}) });
  };
  const projectLists = lists.filter((l): l is Extract<ListItem, { kind: "list" }> => l.kind === "list");

  return (
    <Screen edges={[]}>
      <Row>
        <Checkbox checked={todo.completed} onPress={() => toggleTodoDone(todo.id)} label={todo.completed ? "Mark not done" : "Mark done"} color={t.success} />
        <Input style={{ flex: 1, fontWeight: "800" }} value={title} onChangeText={setTitle} onEndEditing={() => title.trim() && title !== todo.title && updateTodo(todo.id, { title: title.trim() })} accessibilityLabel="Title" multiline />
      </Row>
      {todo.repeat ? <P muted>↻ Repeats {repeatLabel(todo.repeat)}. Completing it moves it to the next date.</P> : null}

      <H2>Due</H2>
      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="Today" active={todo.dueDate === today} onPress={() => setDue(today)} />
        <Chip label="Tomorrow" active={todo.dueDate === addDays(today, 1)} onPress={() => setDue(addDays(today, 1))} />
        <Chip label="Next week" active={todo.dueDate === addDays(today, 7)} onPress={() => setDue(addDays(today, 7))} />
        <Chip label="No date" active={!todo.dueDate} onPress={() => setDue(undefined)} />
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Input label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} onEndEditing={saveDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Time (sets a reminder)" placeholder="HH:MM" value={time} onChangeText={setTime} onEndEditing={saveTime} keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
      <Button variant={planned ? "primary" : "ghost"} small icon="sunny-outline" title={planned ? "Planned for today" : "Plan for today"} onPress={() => togglePlanToday(todo.id)} />

      <H2>Priority</H2>
      <Row>
        {(["high", "medium", "low"] as const).map((p) => (
          <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} active={todo.priority === p} onPress={() => updateTodo(todo.id, { priority: todo.priority === p ? undefined : p })} />
        ))}
      </Row>

      <H2>List</H2>
      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="📥 Inbox" active={!todo.listId} onPress={() => updateTodo(todo.id, { listId: undefined })} />
        {projectLists.map((l) => (
          <Chip key={l.id} label={`${l.emoji ?? "#"} ${l.name}`} active={todo.listId === l.id} onPress={() => updateTodo(todo.id, { listId: l.id })} />
        ))}
      </Row>
      <Input label="Labels (comma separated)" placeholder="errands, waiting" value={labels} onChangeText={setLabels} autoCapitalize="none" onEndEditing={() => updateTodo(todo.id, { labels: [...new Set(labels.split(",").map((l) => l.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))] })} />

      <H2>Subtasks</H2>
      {(todo.subtasks ?? []).map((s) => (
        <Row key={s.id}>
          <Checkbox checked={s.completed} onPress={() => toggleSubtask(todo.id, s.id)} label={s.title} color={t.success} />
          <Pressable style={{ flex: 1 }} onPress={() => toggleSubtask(todo.id, s.id)}>
            <Text style={{ color: s.completed ? t.mutedFg : t.fg, textDecorationLine: s.completed ? "line-through" : "none", fontSize: font.body }}>{s.title}</Text>
          </Pressable>
          <IconButton icon="close" label={`Remove ${s.title}`} onPress={() => removeSubtask(todo.id, s.id)} size={18} />
        </Row>
      ))}
      <Input placeholder="Add a subtask" value={sub} onChangeText={setSub} returnKeyType="done" submitBehavior="submit" onSubmitEditing={() => (addSubtask(todo.id, sub), setSub(""))} />

      <View style={{ height: 12 }} />
      <Button
        variant="danger"
        icon="trash-outline"
        title="Delete to-do"
        onPress={() =>
          Alert.alert("Delete this to-do?", "It's deleted on all your devices.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => (deleteTodo(todo.id), goBack()) },
          ])
        }
      />
    </Screen>
  );
}
