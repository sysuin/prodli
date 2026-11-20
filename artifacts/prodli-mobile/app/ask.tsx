// Ask ProdLi: a chat about the user's own day, notes and meetings.
import { router } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ask, briefContext, pickSnippets, type AskAction, type AskTurn, type Snippet } from "@/lib/ai";
import { ACCOUNT_KEY, errorText, type ProdliUser } from "@/lib/api";
import { addTodoFromText, newNote, setList, useList, useNotes } from "@/lib/data";
import { textToHtml } from "@/lib/html";
import { useMeetings } from "@/lib/meetings";
import { useStored } from "@/lib/store";
import { getDayKey, type DayRecord, type Habit, type Todo } from "@/shared";
import { Banner, Button, Chip, Empty, Input, P, Row } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

interface Turn extends AskTurn {
  actions?: AskAction[];
  sources?: Snippet[];
  applied?: number[];
}

const STARTERS = ["What should I do next?", "What's overdue?", "Summarize this week's meetings", "What did we decide about…"];

export default function AskScreen() {
  const t = useTheme();
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  const todos = useList<Todo>("todos");
  const habits = useList<Habit>("habits");
  const days = useList<DayRecord>("days");
  const notes = useNotes();
  const meetings = useMeetings();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setErr(null);
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((cur) => [...cur, { role: "user", text }]);
    setBusy(true);
    try {
      const snippets = pickSnippets(text, notes, meetings);
      const r = await ask(text, history, briefContext({ now: new Date(), todos, habits, meetings, days }), snippets);
      setTurns((cur) => [...cur, { role: "assistant", text: r.answer, actions: r.actions, sources: r.sources.map((n) => snippets[n - 1]).filter(Boolean) }]);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const apply = (turn: number, i: number, a: AskAction) => {
    if (a.type === "add_task") addTodoFromText(a.title);
    else if (a.type === "plan_today") {
      const found = todos.find((x) => !x.completed && x.title.trim().toLowerCase() === a.title.trim().toLowerCase());
      if (found) setList<Todo>("todos", (all) => all.map((x) => (x.id === found.id ? { ...x, plannedFor: getDayKey() } : x)));
      else addTodoFromText(a.title, { planToday: true });
    } else newNote({ title: a.title.slice(0, 200), autoTitle: false, content: textToHtml(a.details || a.title) });
    setTurns((cur) => cur.map((x, j) => (j === turn ? { ...x, applied: [...(x.applied ?? []), i] } : x)));
  };

  if (!user) {
    return (
      <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: t.bg, padding: 16 }}>
        <Empty icon="chatbubble-ellipses-outline" title="Sign in to ask ProdLi" hint="Ask about your to-dos, notes and meetings. Answers come from your own data." />
        <Button title="Sign in" icon="person-circle-outline" onPress={() => router.push("/account")} />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={100}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        {!turns.length ? (
          <>
            <P muted>Ask about your day, to-dos, notes and meetings. ProdLi answers from your own data and can add to-dos or notes when you tap.</P>
            <Row style={{ flexWrap: "wrap" }}>
              {STARTERS.map((s) => (
                <Chip key={s} label={s} onPress={() => (s.endsWith("…") ? setQ(s.replace("…", " ")) : void send(s))} />
              ))}
            </Row>
          </>
        ) : null}
        {turns.map((turn, ti) => (
          <View key={ti} style={{ alignSelf: turn.role === "user" ? "flex-end" : "stretch", maxWidth: turn.role === "user" ? "85%" : "100%", backgroundColor: turn.role === "user" ? t.primary : t.card, borderWidth: 2, borderColor: t.border, padding: 12, gap: 8 }}>
            <Text selectable style={{ color: turn.role === "user" ? "#000" : t.fg, fontSize: font.body, lineHeight: 22 }}>{turn.text}</Text>
            {turn.sources?.length ? <P muted style={{ fontSize: font.tiny }}>From: {turn.sources.map((s) => `${s.kind === "note" ? "📝" : "👥"} ${s.title}`).join(", ")}</P> : null}
            {turn.actions?.map((a, i) => {
              const done = turn.applied?.includes(i);
              return <Button key={i} small variant={done ? "ghost" : "secondary"} disabled={done} icon={done ? "checkmark" : a.type === "add_note" ? "document-text-outline" : "add"} title={`${done ? "Done: " : ""}${a.type === "add_note" ? "Save note" : a.type === "plan_today" ? "Plan for today" : "Add to-do"}: ${a.title}`} onPress={() => apply(ti, i, a)} />;
            })}
          </View>
        ))}
        {busy ? <P muted>Thinking…</P> : null}
        {err ? <Banner tone="error" text={err} /> : null}
      </ScrollView>
      <SafeAreaView edges={["bottom"]} style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 2, borderTopColor: t.border, backgroundColor: t.bg }}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Ask anything about your day…" value={q} onChangeText={setQ} onSubmitEditing={() => void send(q)} returnKeyType="send" maxLength={2000} />
        </View>
        <Button title="Ask" icon="send" variant="ask" onPress={() => void send(q)} busy={busy} disabled={!q.trim()} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
