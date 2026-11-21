// First launch: what ProdLi is, and the choice to sign in or start right away.
import { router } from "expo-router";
import { Text, View } from "react-native";
import { write } from "@/lib/store";
import { WELCOMED_KEY } from "@/lib/welcome";
import { Button, Card, LogoMark, P, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";


const POINTS: [string, string][] = [
  ["☀️", "Today: your focus, to-dos, habits and a daily brief"],
  ["✅", "To-dos with smart add — “Call Sam tomorrow 3pm !high”"],
  ["📝", "Notes, habits, Pomodoro and a weekly review"],
  ["🎙", "Meetings: record in person, or see calls recorded on your computer"],
  ["🔄", "The same data as the ProdLi extension and app.prodli.com"],
];

export default function Welcome() {
  const t = useTheme();
  const done = (to: "/" | "/account") => {
    write(WELCOMED_KEY, true);
    router.replace("/");
    if (to === "/account") router.push("/account");
  };
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ alignItems: "center", gap: 12, marginTop: 24 }}>
        <LogoMark size={64} />
        <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: "900", color: t.fg }}>Welcome to ProdLi</Text>
        <P muted style={{ textAlign: "center" }}>Your productivity workspace, now on your phone.</P>
      </View>
      <Card>
        {POINTS.map(([icon, text]) => (
          <P key={text}>
            {icon} {text}
          </P>
        ))}
      </Card>
      <Button title="Sign in with your ProdLi account" icon="person-circle-outline" onPress={() => done("/account")} />
      <Button variant="ghost" title="Start without an account" onPress={() => done("/")} />
      <P muted style={{ fontSize: font.small, textAlign: "center" }}>Without an account, everything stays on this phone. You can sign in any time from More.</P>
    </Screen>
  );
}
