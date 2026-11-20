import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { repeatLabel, timeLabel, type Todo } from "../shared";
import { toggleTodoDone } from "../lib/data";
import { haptic } from "../lib/haptics";
import { Checkbox } from "./kit";
import { font, useTheme } from "./theme";

const PRIORITY = { high: "#FF6B6B", medium: "#FFB300", low: "#33BBFF" } as const;

export function dueLabel(t: Pick<Todo, "dueDate" | "dueTime">, today: string): string {
  if (!t.dueDate) return "";
  const d = new Date(`${t.dueDate}T00:00:00`);
  const days = Math.round((d.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days < 0 ? `${-days} days ago` : days < 7 ? d.toLocaleDateString("en-US", { weekday: "long" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return t.dueTime ? `${day} ${timeLabel(t.dueTime)}` : day;
}

export function TodoRow({ todo, today }: { todo: Todo; today: string }) {
  const t = useTheme();
  const due = dueLabel(todo, today);
  const overdue = !!todo.dueDate && todo.dueDate < today && !todo.completed;
  const subs = todo.subtasks ?? [];
  const meta = [due, todo.repeat ? `↻ ${repeatLabel(todo.repeat)}` : "", subs.length ? `${subs.filter((s) => s.completed).length}/${subs.length}` : "", ...(todo.labels ?? []).map((l) => `@${l}`)].filter(Boolean);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? "#333842" : "#00000018" }}>
      <Checkbox
        checked={todo.completed}
        label={`${todo.completed ? "Mark not done" : "Mark done"}: ${todo.title}`}
        onPress={() => {
          haptic(todo.completed ? "light" : "success");
          toggleTodoDone(todo.id);
        }}
        color={t.success}
      />
      <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: "/todo/[id]", params: { id: todo.id } })} accessibilityRole="button" accessibilityLabel={`Open ${todo.title}`}>
        <Text style={{ fontSize: font.body, fontWeight: "700", color: todo.completed ? t.mutedFg : t.fg, textDecorationLine: todo.completed ? "line-through" : "none" }}>{todo.title}</Text>
        {meta.length ? <Text style={{ fontSize: font.small, color: overdue ? t.danger : t.mutedFg, fontWeight: overdue ? "800" : "500" }}>{meta.join(" · ")}</Text> : null}
      </Pressable>
      {todo.priority ? <View accessibilityLabel={`${todo.priority} priority`} style={{ width: 10, height: 10, backgroundColor: PRIORITY[todo.priority], borderWidth: 1, borderColor: "#000" }} /> : null}
    </View>
  );
}
