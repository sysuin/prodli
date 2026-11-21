// To-dos as a Board (columns by when) or an Eisenhower Matrix (important ×
// urgent) — the extension's rules (todoBoards.ts). Tap a card to open it;
// long-press it to move it (changes its date, plan or priority).
import { router } from "expo-router";
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { BOARD_COLUMNS, boardColumn, describeMove, moveToColumn, moveToQuadrant, quadrant, QUADRANTS, type BoardColumn, type Quadrant, type Todo } from "../shared";
import { toggleTodoDone, updateTodo } from "../lib/data";
import { haptic } from "../lib/haptics";
import { dueLabel } from "./TodoRow";
import { font, useTheme } from "./theme";

const QUADRANT_COLOR: Record<Quadrant, string> = { do: "#FF6B6B", schedule: "#33BBFF", quick: "#FFD700", later: "#B0BEC5" };
const COLUMN_COLOR: Record<BoardColumn, string> = { nodate: "#B0BEC5", upcoming: "#33BBFF", today: "#FFD700", done: "#66BB6A" };

function pick(title: string, options: { label: string; run: () => void }[]) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length }, (i) => options[i]?.run());
  } else {
    // Android dialogs show at most three buttons; tapping outside cancels.
    Alert.alert(title, undefined, options.slice(0, 3).map((o) => ({ text: o.label, onPress: o.run })), { cancelable: true });
  }
}

function apply(t: Todo, patch: Partial<Todo> | null, today: string) {
  if (!patch) return;
  updateTodo(t.id, patch);
  haptic();
  AccessibilityInfo.announceForAccessibility(describeMove(t, patch, today));
}

function MiniCard({ todo, today, onLongPress }: { todo: Todo; today: string; onLongPress: () => void }) {
  const t = useTheme();
  const due = dueLabel(todo, today);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/todo/[id]", params: { id: todo.id } })}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${todo.title}${due ? `, ${due}` : ""}`}
      accessibilityHint="Long-press to move"
      style={({ pressed }) => ({ borderWidth: 2, borderColor: t.border, backgroundColor: pressed ? t.muted : t.dark ? t.bg : "#FFFDF8", padding: 8, gap: 2 })}
    >
      <Text numberOfLines={3} style={{ color: todo.completed ? t.mutedFg : t.fg, fontWeight: "700", fontSize: font.small, textDecorationLine: todo.completed ? "line-through" : "none" }}>{todo.title}</Text>
      {due ? <Text style={{ color: todo.dueDate && todo.dueDate < today && !todo.completed ? t.danger : t.mutedFg, fontSize: font.tiny }}>{due}</Text> : null}
    </Pressable>
  );
}

function Column({ label, hint, color, count, children, width }: { label: string; hint: string; color: string; count: number; children: React.ReactNode; width: number | `${number}%` }) {
  const t = useTheme();
  return (
    <View style={{ width, borderWidth: 2, borderColor: t.border, backgroundColor: t.card }}>
      <View style={{ backgroundColor: color, padding: 8, borderBottomWidth: 2, borderBottomColor: "#000" }}>
        <Text style={{ fontWeight: "900", color: "#000" }}>
          {label} <Text style={{ fontWeight: "600" }}>({count})</Text>
        </Text>
        <Text style={{ color: "#000", fontSize: font.tiny }}>{hint}</Text>
      </View>
      <View style={{ padding: 8, gap: 6 }}>{children}</View>
    </View>
  );
}

export function BoardView({ todos, today }: { todos: Todo[]; today: string }) {
  const { width } = useWindowDimensions();
  const colWidth = Math.min(300, Math.round(width * 0.78));
  const move = (todo: Todo) =>
    pick(
      `Move “${todo.title}”`,
      BOARD_COLUMNS.filter((c) => c.id !== boardColumn(todo, today)).map((c) => ({
        label: c.id === "done" ? (todo.completed ? "Not done" : "Done") : c.label,
        run: () => (c.id === "done" || todo.completed ? (toggleTodoDone(todo.id), haptic("success")) : apply(todo, moveToColumn(todo, c.id, today), today)),
      })),
    );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }} snapToInterval={colWidth + 10} decelerationRate="fast">
      {BOARD_COLUMNS.map((c) => {
        const cards = todos.filter((x) => boardColumn(x, today) === c.id).slice(0, c.id === "done" ? 30 : 200);
        return (
          <Column key={c.id} label={c.label} hint={c.hint} color={COLUMN_COLOR[c.id]} count={cards.length} width={colWidth}>
            {cards.map((x) => <MiniCard key={x.id} todo={x} today={today} onLongPress={() => move(x)} />)}
          </Column>
        );
      })}
    </ScrollView>
  );
}

export function MatrixView({ todos, today }: { todos: Todo[]; today: string }) {
  const open = todos.filter((x) => !x.completed);
  const move = (todo: Todo) =>
    pick(
      `Move “${todo.title}”`,
      QUADRANTS.filter((q) => q.id !== quadrant(todo, today)).map((q) => ({ label: q.label, run: () => apply(todo, moveToQuadrant(todo, q.id, today), today) })),
    );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {QUADRANTS.map((q) => {
        const cards = open.filter((x) => quadrant(x, today) === q.id);
        return (
          <Column key={q.id} label={q.label} hint={q.hint} color={QUADRANT_COLOR[q.id]} count={cards.length} width="48.5%">
            {cards.map((x) => <MiniCard key={x.id} todo={x} today={today} onLongPress={() => move(x)} />)}
          </Column>
        );
      })}
    </View>
  );
}
