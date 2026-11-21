import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { applyConfig } from "@/lib/config";
import { recoverInterruptedRecording } from "@/lib/inPerson";
import { startReminders } from "@/lib/reminders";
import { startSync } from "@/lib/syncRunner";
import { useTheme } from "@/ui/theme";

applyConfig();
startSync();
startReminders();
recoverInterruptedRecording();

/** Shown instead of a blank screen if a screen crashes; data on the phone is untouched. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "900", color: t.fg }}>Something went wrong</Text>
      <Text style={{ color: t.fg, lineHeight: 21 }}>ProdLi hit a problem showing this screen. Your notes and to-dos are safe on this phone.</Text>
      <Text selectable style={{ color: t.mutedFg, fontSize: 12 }}>{error.message}</Text>
      <Text onPress={() => void retry()} accessibilityRole="button" style={{ alignSelf: "flex-start", backgroundColor: t.primary, color: "#000", fontWeight: "900", paddingHorizontal: 16, paddingVertical: 10, borderWidth: 2, borderColor: "#000" }}>
        Try again
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.fg,
          headerTitleStyle: { fontWeight: "900" },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="note/[id]" options={{ title: "" }} />
        <Stack.Screen name="todo/[id]" options={{ title: "To-do" }} />
        <Stack.Screen name="habit/edit" options={{ title: "Habit", presentation: "modal" }} />
        <Stack.Screen name="meetings/index" options={{ title: "Meetings" }} />
        <Stack.Screen name="meetings/[id]" options={{ title: "Meeting" }} />
        <Stack.Screen name="ask" options={{ title: "Ask ProdLi" }} />
        <Stack.Screen name="record" options={{ title: "Record in person" }} />
        <Stack.Screen name="pomodoro" options={{ title: "Pomodoro" }} />
        <Stack.Screen name="read-later" options={{ title: "Read later" }} />
        <Stack.Screen name="review" options={{ title: "Weekly review" }} />
        <Stack.Screen name="search" options={{ title: "Search" }} />
        <Stack.Screen name="tracker" options={{ title: "Time Tracker" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="help" options={{ title: "Help" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
