import { router } from "expo-router";
import { View } from "react-native";
import { ACCOUNT_KEY, type ProdliUser } from "@/lib/api";
import { useStored } from "@/lib/store";
import { Card, ListRow, Screen, Title } from "@/ui/kit";

export default function MoreScreen() {
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  return (
    <Screen>
      <Title>More</Title>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="chatbubble-ellipses-outline" title="Ask ProdLi" subtitle="Questions about your day, notes and meetings" onPress={() => router.push("/ask")} />
        <ListRow icon="people-outline" title="Meetings" subtitle="Transcripts, summaries and action items" onPress={() => router.push("/meetings")} />
        <ListRow icon="timer-outline" title="Pomodoro" subtitle="Focus sessions" onPress={() => router.push("/pomodoro")} />
        <ListRow icon="stats-chart-outline" title="Time Tracker" subtitle="Where your computer time went" onPress={() => router.push("/tracker")} />
      </Card>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="person-circle-outline" title={user ? user.name || user.email : "Sign in"} subtitle={user ? "Account, devices and plan" : "Sync with the extension and app.prodli.com"} onPress={() => router.push("/account")} />
        <ListRow icon="settings-outline" title="Settings" onPress={() => router.push("/settings")} />
        <ListRow icon="help-circle-outline" title="Help" onPress={() => router.push("/help")} />
      </Card>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
