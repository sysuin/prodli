// Notes: search, pinned first, newest first. Tap to edit; long-press to pin.
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { newNote, useNotes } from "@/lib/data";
import { htmlToText, preview } from "@/lib/html";
import { Button, Card, Empty, Input, P, Row, Screen, Title } from "@/ui/kit";
import { SyncPill } from "@/ui/SyncPill";
import { font, useTheme } from "@/ui/theme";

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days < 1 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : days < 7 ? d.toLocaleDateString("en-US", { weekday: "short" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function NotesScreen() {
  const t = useTheme();
  const notes = useNotes();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? notes.filter((n) => n.title.toLowerCase().includes(s) || htmlToText(n.content).toLowerCase().includes(s)) : notes;
  }, [notes, q]);

  return (
    <Screen>
      <Title right={<SyncPill />}>Notes</Title>
      <Row>
        <View style={{ flex: 1 }}>
          <Input placeholder="Search notes" value={q} onChangeText={setQ} returnKeyType="search" clearButtonMode="while-editing" />
        </View>
        <Button title="New" icon="add" onPress={() => router.push({ pathname: "/note/[id]", params: { id: newNote().id, fresh: "1" } })} />
      </Row>
      {shown.length ? (
        shown.map((n) => (
          <Card
            key={n.id}
            onPress={() => router.push({ pathname: "/note/[id]", params: { id: n.id } })}
            accessibilityLabel={`${n.pinned ? "Pinned. " : ""}${n.title}`}
          >
            <View>
              <Row style={{ justifyContent: "space-between" }}>
                <Text numberOfLines={1} style={{ flex: 1, fontWeight: "900", fontSize: font.body, color: t.fg }}>
                  {n.pinned ? "📌 " : ""}
                  {n.title || "Untitled"}
                </Text>
                <Text style={{ color: t.mutedFg, fontSize: font.small }}>{when(n.updatedAt)}</Text>
              </Row>
              {n.content ? <P muted numberOfLines={2} style={{ fontSize: font.small }}>{preview(n.content)}</P> : null}
            </View>
          </Card>
        ))
      ) : (
        <Empty icon="document-text-outline" title={q ? "No matching notes" : "No notes yet"} hint={q ? "Try another word." : "Tap New to write one. Notes from your computer show up here when you're signed in."} />
      )}
      {shown.length > 1 ? <P muted style={{ fontSize: font.tiny, textAlign: "center" }}>Pin or unpin a note from its ⋯ menu.</P> : null}
    </Screen>
  );
}
