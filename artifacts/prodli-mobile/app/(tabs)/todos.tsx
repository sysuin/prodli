// To-dos: smart add, views (Today, Upcoming, All, lists, Done).
import { useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { getDayKey, parseTask, type ListItem, type Todo } from "@/shared";
import { addTodoFromText, clearCompletedTodos, todosFor, useList, type TodoView } from "@/lib/data";
import { haptic } from "@/lib/haptics";
import { Button, Chip, Empty, Input, P, Row, Screen, Title } from "@/ui/kit";
import { SyncPill } from "@/ui/SyncPill";
import { TodoRow, dueLabel } from "@/ui/TodoRow";
import { font } from "@/ui/theme";

export default function TodosScreen() {
  const todos = useList<Todo>("todos");
  const lists = useList<ListItem>("lists");
  const [view, setView] = useState<TodoView>("today");
  const [text, setText] = useState("");
  const today = getDayKey();
  const shown = useMemo(() => todosFor(todos, view, today), [todos, view, today]);
  const projectLists = lists.filter((l): l is Extract<ListItem, { kind: "list" }> => l.kind === "list");
  const parsed = text.trim() ? parseTask(text) : null;
  const hint = parsed ? [parsed.dueDate || parsed.dueTime ? `📅 ${dueLabel({ dueDate: parsed.dueDate ?? today, dueTime: parsed.dueTime }, today)}` : "", parsed.priority ? `❗ ${parsed.priority}` : "", parsed.listName ? `# ${parsed.listName}` : "", parsed.labels?.length ? parsed.labels.map((l) => `@${l}`).join(" ") : "", parsed.repeat ? "↻ repeats" : ""].filter(Boolean).join("  ") : "";

  const add = () => {
    const listId = view.startsWith("list:") && view !== "list:inbox" ? view.slice(5) : undefined;
    if (addTodoFromText(text, { listId, planToday: view === "today" })) {
      haptic();
      setText("");
    }
  };

  const views: { id: TodoView; label: string }[] = [
    { id: "today", label: "☀️ Today" },
    { id: "upcoming", label: "📅 Upcoming" },
    { id: "all", label: "All" },
    { id: "list:inbox", label: "📥 Inbox" },
    ...projectLists.map((l) => ({ id: `list:${l.id}` as TodoView, label: `${l.emoji ?? "#"} ${l.name}` })),
    { id: "done", label: "✓ Done" },
  ];

  return (
    <Screen>
      <Title right={<SyncPill />}>To-dos</Title>
      <Input placeholder="Add a to-do… “Pay rent tomorrow !high #Home”" value={text} onChangeText={setText} onSubmitEditing={add} returnKeyType="done" submitBehavior="submit" />
      {hint ? <P muted style={{ fontSize: font.small }}>{hint}</P> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {views.map((v) => (
          <Chip key={v.id} label={v.label} active={view === v.id} onPress={() => setView(v.id)} />
        ))}
      </ScrollView>
      {shown.length ? (
        <View>{shown.map((x) => <TodoRow key={x.id} todo={x} today={today} />)}</View>
      ) : (
        <Empty icon={view === "done" ? "trophy-outline" : "checkmark-done-outline"} title={view === "done" ? "Nothing done yet" : "All clear"} hint={view === "today" ? "Add something for today, or plan a to-do from All." : "Add a to-do above. Words like “tomorrow”, “every monday” or “!high” are understood."} />
      )}
      {view === "done" && shown.length ? (
        <Row>
          <Button
            variant="ghost"
            small
            icon="trash-outline"
            title="Clear completed"
            onPress={() =>
              Alert.alert("Clear completed to-dos?", "They're deleted on all your devices.", [
                { text: "Cancel", style: "cancel" },
                { text: "Clear", style: "destructive", onPress: () => clearCompletedTodos() },
              ])
            }
          />
        </Row>
      ) : null}
    </Screen>
  );
}
