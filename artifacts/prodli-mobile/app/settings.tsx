import Constants from "expo-constants";
import { Linking } from "react-native";
import { apiBase } from "@/lib/api";
import { useState } from "react";
import { REMINDERS_KEY } from "@/lib/reminderPlan";
import { enableReminders, remindersSupported, setPhoneReminders } from "@/lib/reminders";
import { useStored, write } from "@/lib/store";
import { Card, Chip, H2, ListRow, P, Row, Screen } from "@/ui/kit";
import { THEME_KEY, type ThemePref } from "@/ui/theme";
import { font } from "@/ui/theme";

export default function SettingsScreen() {
  const theme = useStored<ThemePref>(THEME_KEY, "system");
  const reminders = useStored<boolean>(REMINDERS_KEY, false);
  const [denied, setDenied] = useState(false);
  return (
    <Screen edges={[]}>
      <H2>Appearance</H2>
      <Row>
        {(["system", "light", "dark"] as ThemePref[]).map((p) => (
          <Chip key={p} label={p === "system" ? "Match phone" : p === "light" ? "Light" : "Dark"} active={theme === p} onPress={() => write(THEME_KEY, p)} />
        ))}
      </Row>
      {remindersSupported() ? (
        <>
          <H2>Reminders</H2>
          <Row>
            <Chip label="Remind me on this phone" active={reminders} onPress={() => void setPhoneReminders(!reminders).then((ok) => setDenied(!ok && !reminders))} />
          </Row>
          <P muted style={{ fontSize: font.small }}>Notifications at a to-do's time. Off by default because the extension reminds you on your computer. Pomodoro always notifies when a session ends (if notifications are allowed).</P>
          {denied ? <P style={{ fontSize: font.small }}>Notifications are off for ProdLi. Turn them on in your phone's Settings → ProdLi → Notifications.</P> : null}
          <Row>
            <Chip label="Allow Pomodoro notifications" onPress={() => void enableReminders().then((ok) => setDenied(!ok))} />
          </Row>
        </>
      ) : null}
      <H2>About</H2>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="shield-checkmark-outline" title="Privacy policy" onPress={() => void Linking.openURL("https://prodli.com/privacy")} />
        <ListRow icon="document-outline" title="Terms" onPress={() => void Linking.openURL("https://prodli.com/terms")} />
        <ListRow icon="extension-puzzle-outline" title="Get the Chrome extension" subtitle="Meeting recording, new tab, time tracking" onPress={() => void Linking.openURL("https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp")} />
      </Card>
      <P muted style={{ fontSize: font.small }}>
        ProdLi {Constants.expoConfig?.version ?? ""} · {apiBase().replace(/^https?:\/\//, "")}
      </P>
    </Screen>
  );
}
