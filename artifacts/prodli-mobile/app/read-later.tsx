// Read later: pages saved with the extension (or added here), synced. Tap to read in the browser.
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { ReadLaterItem } from "@/shared";
import { addReadLater, deleteReadLater, markRead, useList } from "@/lib/data";
import { haptic } from "@/lib/haptics";
import { Banner, Button, Card, Chip, Empty, IconButton, Input, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default function ReadLaterScreen() {
  const t = useTheme();
  const items = useList<ReadLaterItem>("readLater");
  const [tab, setTab] = useState<"unread" | "read">("unread");
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState(false);
  const shown = useMemo(() => items.filter((i) => (tab === "unread" ? !i.readAt : !!i.readAt)).sort((a, b) => (tab === "unread" ? b.createdAt.localeCompare(a.createdAt) : (b.readAt ?? "").localeCompare(a.readAt ?? ""))), [items, tab]);
  const unread = items.filter((i) => !i.readAt).length;

  const open = async (i: ReadLaterItem) => {
    await WebBrowser.openBrowserAsync(i.url);
    if (!i.readAt) markRead(i.id);
  };
  const add = () => {
    if (addReadLater(url)) {
      haptic("success");
      setUrl("");
      setBad(false);
    } else setBad(true);
  };

  return (
    <Screen edges={[]}>
      <Row>
        <View style={{ flex: 1 }}>
          <Input placeholder="Paste a link to read later" value={url} onChangeText={(v) => (setUrl(v), setBad(false))} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={add} />
        </View>
        <Button title="Save" icon="bookmark" onPress={add} disabled={!url.trim()} />
      </Row>
      {bad ? <Banner tone="error" text="That doesn't look like a web address." /> : null}
      <Row>
        <Chip label={`Unread (${unread})`} active={tab === "unread"} onPress={() => setTab("unread")} />
        <Chip label="Read" active={tab === "read"} onPress={() => setTab("read")} />
      </Row>
      {shown.length ? (
        shown.map((i) => (
          <Card key={i.id}>
            <Row style={{ alignItems: "flex-start" }}>
              <Pressable style={{ flex: 1, gap: 2 }} onPress={() => void open(i)} accessibilityRole="link" accessibilityLabel={`Open ${i.title}`}>
                <Text style={{ fontWeight: "900", fontSize: font.body, color: t.fg }} numberOfLines={2}>{i.title}</Text>
                <P muted style={{ fontSize: font.small }}>{host(i.url)} · saved {new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</P>
              </Pressable>
              <IconButton icon={i.readAt ? "mail-unread-outline" : "checkmark-done-outline"} label={i.readAt ? "Mark unread" : "Mark read"} onPress={() => markRead(i.id, !i.readAt)} />
              <IconButton icon="trash-outline" label={`Delete ${i.title}`} onPress={() => Alert.alert("Delete this page?", "It's removed from Read later on all your devices.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteReadLater(i.id) }])} />
            </Row>
          </Card>
        ))
      ) : (
        <Empty icon="bookmark-outline" title={tab === "unread" ? "Nothing to read" : "Nothing read yet"} hint="Save pages here, or with “Read later” in the ProdLi extension on your computer." />
      )}
    </Screen>
  );
}
