// A meeting: summary, decisions, action items (add them as to-dos), transcript.
import { goBack } from "@/lib/nav";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { SUMMARIZING_KEY } from "@/lib/inPerson";
import { useStored } from "@/lib/store";
import { Alert, Share, Text, View } from "react-native";
import { summarizeMeeting } from "@/lib/ai";
import { errorText } from "@/lib/api";
import { addTodoFromText, useList } from "@/lib/data";
import { deleteMeeting, durationLabel, formatTimestamp, updateMeeting, useMeeting } from "@/lib/meetings";
import { haptic } from "@/lib/haptics";
import type { Todo } from "@/shared";
import { Banner, Button, Card, Chip, Empty, H2, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

export default function MeetingScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const m = useMeeting(id);
  const todos = useList<Todo>("todos");
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [busyHere, setBusy] = useState(false);
  const summarizing = useStored<string[]>(SUMMARIZING_KEY, []);
  const busy = busyHere || summarizing.includes(id);
  const [err, setErr] = useState<string | null>(null);
  if (!m) return <Screen edges={[]}><Empty icon="people-outline" title="This meeting is gone" hint="It may have been deleted on another device." /></Screen>;

  const s = m.summary;
  const titles = new Set(todos.map((x) => x.title.trim().toLowerCase()));
  const summarize = async () => {
    setBusy(true);
    setErr(null);
    try {
      const summary = await summarizeMeeting(m);
      updateMeeting(m.id, { summary, status: "ready", error: null });
      haptic("success");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const shareText = () => {
    const lines = [s?.title || m.title, "", s?.overview ?? "", ...(s?.decisions.length ? ["", "Decisions:", ...s.decisions.map((d) => `- ${d}`)] : []), ...(s?.actionItems.length ? ["", "Action items:", ...s.actionItems.map((a) => `- ${a.task}${a.owner ? ` (${a.owner})` : ""}${a.dueDate ? ` — due ${a.dueDate}` : ""}`)] : [])];
    void Share.share({ title: s?.title || m.title, message: lines.join("\n").trim() });
  };

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "900", color: t.fg }}>{s?.title || m.title || "Meeting"}</Text>
      <P muted style={{ fontSize: font.small }}>
        {new Date(m.startedAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        {m.durationSec ? ` · ${durationLabel(m.durationSec)}` : ""}
      </P>
      <Row>
        <Chip label="Summary" active={tab === "summary"} onPress={() => setTab("summary")} />
        <Chip label={`Transcript (${m.transcript?.length ?? 0})`} active={tab === "transcript"} onPress={() => setTab("transcript")} />
      </Row>
      {err ? <Banner tone="error" text={err} /> : null}

      {tab === "summary" ? (
        s ? (
          <>
            <Card>
              <P selectable>{s.overview}</P>
            </Card>
            {s.keyPoints.length ? (
              <>
                <H2>Key points</H2>
                {s.keyPoints.map((k, i) => <P key={i} selectable>• {k}</P>)}
              </>
            ) : null}
            {s.decisions.length ? (
              <>
                <H2>Decisions</H2>
                {s.decisions.map((k, i) => <P key={i} selectable>✓ {k}</P>)}
              </>
            ) : null}
            {s.actionItems.length ? (
              <>
                <H2>Action items</H2>
                {s.actionItems.map((a, i) => {
                  const added = titles.has(a.task.trim().toLowerCase());
                  return (
                    <Card key={i}>
                      <P selectable style={{ fontWeight: "800" }}>{a.task}</P>
                      <Row style={{ justifyContent: "space-between" }}>
                        <P muted style={{ fontSize: font.small, flex: 1 }}>{[a.owner, a.dueDate ? `due ${a.dueDate}` : "", a.priority].filter(Boolean).join(" · ")}</P>
                        <Button small variant={added ? "ghost" : "secondary"} disabled={added} title={added ? "Added" : "Add to-do"} icon={added ? "checkmark" : "add"} onPress={() => (addTodoFromText(a.task + (a.priority === "high" ? " !high" : ""), {}), haptic("success"))} />
                      </Row>
                    </Card>
                  );
                })}
              </>
            ) : null}
            {s.openQuestions.length ? (
              <>
                <H2>Open questions</H2>
                {s.openQuestions.map((k, i) => <P key={i} selectable>? {k}</P>)}
              </>
            ) : null}
            <Row>
              <Button style={{ flex: 1 }} variant="ghost" icon="share-outline" title="Share" onPress={shareText} />
              <Button style={{ flex: 1 }} variant="ghost" icon="refresh" title="Summarize again" busy={busy} onPress={summarize} />
            </Row>
          </>
        ) : m.transcript?.length ? (
          <Card>
            <P>{busy ? "Writing the summary…" : m.error ? `Summarizing didn't work: ${m.error}` : "This meeting hasn't been summarized yet."}</P>
            <Button variant="ask" icon="sparkles" title="Summarize with AI" busy={busy} onPress={summarize} />
          </Card>
        ) : (
          <Empty icon="mic-off-outline" title="No transcript" hint={m.error || m.notice || "Nothing was captured for this meeting."} />
        )
      ) : (
        <View style={{ gap: 10 }}>
          {(m.transcript ?? []).map((e) => (
            <View key={e.id}>
              <Text style={{ fontSize: font.small, color: t.mutedFg, fontWeight: "800" }}>
                {formatTimestamp(e.startMs)} · {e.speaker}
                {e.source === "device" ? " · on device" : ""}
              </Text>
              <P selectable>{e.text}</P>
            </View>
          ))}
          {!m.transcript?.length ? <P muted>No transcript.</P> : null}
        </View>
      )}

      <View style={{ height: 12 }} />
      <Button
        variant="danger"
        small
        icon="trash-outline"
        title="Delete meeting"
        onPress={() =>
          Alert.alert("Delete this meeting?", "Its transcript and summary are deleted on all your devices.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => (deleteMeeting(m.id), goBack()) },
          ])
        }
      />
    </Screen>
  );
}
