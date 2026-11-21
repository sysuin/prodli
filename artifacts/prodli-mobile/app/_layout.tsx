import { Stack } from "expo-router";
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
        <Stack.Screen name="note/[id]" options={{ title: "" }} />
        <Stack.Screen name="todo/[id]" options={{ title: "To-do" }} />
        <Stack.Screen name="habit/edit" options={{ title: "Habit", presentation: "modal" }} />
        <Stack.Screen name="meetings/index" options={{ title: "Meetings" }} />
        <Stack.Screen name="meetings/[id]" options={{ title: "Meeting" }} />
        <Stack.Screen name="ask" options={{ title: "Ask ProdLi" }} />
        <Stack.Screen name="record" options={{ title: "Record in person" }} />
        <Stack.Screen name="pomodoro" options={{ title: "Pomodoro" }} />
        <Stack.Screen name="read-later" options={{ title: "Read later" }} />
        <Stack.Screen name="tracker" options={{ title: "Time Tracker" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="help" options={{ title: "Help" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
