import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useStored } from "@/lib/store";
import { WELCOMED_KEY } from "@/lib/welcome";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "@/ui/kit";
import { useTheme } from "@/ui/theme";

const icon =
  (name: IconName, active: IconName) =>
  ({ color, focused, size }: { color: unknown; focused: boolean; size: number }) => <Ionicons name={focused ? active : name} size={size} color={color as string} />;

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const welcomed = useStored<boolean>(WELCOMED_KEY, false);
  const signedIn = useStored<unknown>("prodliAccount", null);
  // First launch: say hello first (someone already signed in has clearly been here).
  if (!welcomed && !signedIn) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.dark ? t.primary : "#000",
        tabBarInactiveTintColor: t.mutedFg,
        tabBarActiveBackgroundColor: t.dark ? "#1C1C1C" : t.primary,
        // The heavy top border needs a little more height than the default bar.
        tabBarStyle: { backgroundColor: t.dark ? "#000" : t.card, borderTopWidth: 3, borderTopColor: t.border, height: 62 + insets.bottom, paddingBottom: insets.bottom },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontWeight: "800", fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: icon("sunny-outline", "sunny") }} />
      <Tabs.Screen name="todos" options={{ title: "To-dos", tabBarIcon: icon("checkbox-outline", "checkbox") }} />
      <Tabs.Screen name="notes" options={{ title: "Notes", tabBarIcon: icon("document-text-outline", "document-text") }} />
      <Tabs.Screen name="habits" options={{ title: "Habits", tabBarIcon: icon("flame-outline", "flame") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("grid-outline", "grid") }} />
    </Tabs>
  );
}
