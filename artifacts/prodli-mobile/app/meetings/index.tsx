import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { ACCOUNT_KEY, type ProdliUser } from "@/lib/api";
import { durationLabel, useMeetings } from "@/lib/meetings";
import { useStored } from "@/lib/store";
import { Button, Card, Empty, Input, P, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

export default function MeetingsScreen() {
  const t = useTheme();
  const meetings = useMeetings();
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return meetings;
    return meetings.filter((m) => [m.title, m.summary?.title, m.summary?.overview, ...(m.transcript ?? []).map((e) => e.text)].some((x) => x?.toLowerCase().includes(s)));
  }, [meetings, q]);
  return (
    <Screen edges={[]}>
      <Button title="Record in person" icon="mic" onPress={() => router.push("/record")} />
      <Input placeholder="Search titles, summaries and transcripts" value={q} onChangeText={setQ} returnKeyType="search" />
      {shown.length ? (
        shown.map((m) => (
          <Card key={m.id} onPress={() => router.push({ pathname: "/meetings/[id]", params: { id: m.id } })} accessibilityLabel={m.summary?.title || m.title}>
            <Text style={{ fontWeight: "900", fontSize: font.body, color: t.fg }} numberOfLines={2}>
              {m.summary?.title || m.title || "Meeting"}
            </Text>
            <P muted style={{ fontSize: font.small }}>
              {new Date(m.startedAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {m.durationSec ? ` · ${durationLabel(m.durationSec)}` : ""}
              {m.summary ? ` · ${m.summary.actionItems.length} action item${m.summary.actionItems.length === 1 ? "" : "s"}` : m.transcript?.length ? " · not summarized" : ""}
            </P>
            {m.summary?.overview ? <P numberOfLines={2} style={{ fontSize: font.small }}>{m.summary.overview}</P> : null}
          </Card>
        ))
      ) : (
        <Empty icon="people-outline" title={q ? "No matching meetings" : "No meetings yet"} hint={user ? "Tap Record in person, or record Google Meet, Zoom or Teams calls with the ProdLi extension on your computer; they show up here." : "Sign in (More → Sign in) to record in person and to see meetings recorded with the ProdLi extension."} />
      )}
    </Screen>
  );
}
