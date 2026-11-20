// One note: title + the rich editor. Saves as you type; syncs shortly after.
import { goBack } from "@/lib/nav";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Share, View } from "react-native";
import { type Note } from "@/shared";
import { deleteNote, saveNote, togglePin, useList } from "@/lib/data";
import { deriveTitle, htmlToText, readOnlyReason } from "@/lib/html";
import { Empty, IconButton, Input, Screen } from "@/ui/kit";
import { NoteEditor } from "@/ui/NoteEditor";
import { useTheme } from "@/ui/theme";

export default function NoteScreen() {
  const t = useTheme();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const notes = useList<Note>("notes");
  const note = notes.find((n) => n.id === id);
  const [title, setTitle] = useState(note?.autoTitle ? "" : (note?.title ?? ""));
  const flush = useRef<() => Promise<void>>(async () => {});
  const [readOnly] = useState(() => (note ? readOnlyReason(note.content) : null));

  useEffect(() => {
    if (note && !note.autoTitle) setTitle(note.title);
  }, [note?.title, note?.autoTitle]);

  // Leaving: save what was just typed; an untouched new note isn't kept.
  const latest = useRef(notes);
  latest.current = notes;
  useFocusEffect(
    useCallback(
      () => () => {
        void flush.current().then(() => {
          const cur = latest.current.find((n) => n.id === id);
          if (fresh && cur && !htmlToText(cur.content) && cur.autoTitle) deleteNote(id);
        });
      },
      [id, fresh],
    ),
  );

  if (!note) return <Screen edges={[]}><Empty icon="document-outline" title="This note is gone" hint="It may have been deleted on another device." /></Screen>;

  const menu = () => {
    const share = () => void Share.share({ title: note.title, message: `${note.title}\n\n${htmlToText(note.content)}` });
    const del = () =>
      Alert.alert("Delete this note?", "It's deleted on all your devices.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => (deleteNote(note.id), goBack()) },
      ]);
    const options = [note.pinned ? "Unpin" : "Pin to top", "Share as text", "Delete", "Cancel"];
    const run = (i: number) => (i === 0 ? togglePin(note.id) : i === 1 ? share() : i === 2 ? del() : undefined);
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 2, cancelButtonIndex: 3 }, run);
    else Alert.alert(note.title || "Note", undefined, [{ text: options[0], onPress: () => run(0) }, { text: options[1], onPress: () => run(1) }, { text: options[2], style: "destructive", onPress: () => run(2) }, { text: "Cancel", style: "cancel" }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: "", headerRight: () => <IconButton icon="ellipsis-horizontal" label="Note options" onPress={menu} /> }} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <Input
          placeholder={note.autoTitle ? note.title || "Title" : "Title"}
          value={title}
          onChangeText={setTitle}
          editable={!readOnly}
          onEndEditing={() => {
            const v = title.trim();
            if (!v && !note.autoTitle) saveNote(note.id, { autoTitle: true, title: deriveTitle(note.content) });
            else if (v && v !== note.title) saveNote(note.id, { title: v.slice(0, 200), autoTitle: false });
          }}
          style={{ fontSize: 20, fontWeight: "900", borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 }}
          accessibilityLabel="Note title"
        />
      </View>
      <NoteEditor
        noteId={note.id}
        html={note.content}
        readOnly={readOnly}
        dark={t.dark}
        onChangeHtml={(html) => saveNote(note.id, { content: html, ...(note.autoTitle ? { title: deriveTitle(html) } : {}) })}
        registerFlush={(f) => (flush.current = f)}
      />
    </View>
  );
}
