import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import type { Note, ReadLaterItem, Todo } from "@/shared";
import { useList } from "@/lib/data";
import { useMeetings } from "@/lib/meetings";
import { search, type SearchHit } from "@/lib/search";
import { Card, Empty, Input, ListRow, Screen } from "@/ui/kit";

const ICON = { note: "document-text-outline", todo: "checkbox-outline", meeting: "people-outline", readLater: "bookmark-outline" } as const;

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const notes = useList<Note>("notes");
  const todos = useList<Todo>("todos");
  const readLater = useList<ReadLaterItem>("readLater");
  const meetings = useMeetings();
  const hits = useMemo(() => search(q, { notes, todos, meetings, readLater }), [q, notes, todos, meetings, readLater]);
  const open = (h: SearchHit) => {
    if (h.kind === "note") router.push({ pathname: "/note/[id]", params: { id: h.id } });
    else if (h.kind === "todo") router.push({ pathname: "/todo/[id]", params: { id: h.id } });
    else if (h.kind === "meeting") router.push({ pathname: "/meetings/[id]", params: { id: h.id } });
    else void WebBrowser.openBrowserAsync(h.snippet);
  };
  return (
    <Screen edges={[]}>
      <Input autoFocus placeholder="Search notes, to-dos, meetings, Read later" value={q} onChangeText={setQ} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} />
      {hits.length ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {hits.map((h) => <ListRow key={`${h.kind}:${h.id}`} icon={ICON[h.kind]} title={h.title} subtitle={h.snippet} onPress={() => open(h)} />)}
        </Card>
      ) : q.trim() ? (
        <Empty icon="search-outline" title="Nothing found" hint="Try fewer or different words." />
      ) : null}
    </Screen>
  );
}
