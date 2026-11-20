// Shows the account / sync state in a corner; taps open Account.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text } from "react-native";
import { ACCOUNT_KEY, type ProdliUser } from "../lib/api";
import { useStored } from "../lib/store";
import { syncNow, useSyncStatus } from "../lib/syncRunner";
import { useTheme } from "./theme";

export function SyncPill() {
  const t = useTheme();
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  const status = useSyncStatus();
  if (!user) {
    return (
      <Pressable onPress={() => router.push("/account")} accessibilityRole="button" accessibilityLabel="Sign in to sync" style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 2, borderColor: t.border, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: t.primary }}>
        <Ionicons name="person-circle-outline" size={16} color="#000" />
        <Text style={{ fontWeight: "900", fontSize: 12, color: "#000" }}>Sign in</Text>
      </Pressable>
    );
  }
  const map = {
    idle: { icon: "cloud-done-outline", label: "Synced" },
    syncing: { icon: "sync-outline", label: "Syncing" },
    offline: { icon: "cloud-offline-outline", label: "Offline" },
    error: { icon: "alert-circle-outline", label: "Sync error" },
  } as const;
  const s = map[status.state];
  return (
    <Pressable onPress={() => (status.state === "error" ? router.push("/account") : void syncNow())} accessibilityRole="button" accessibilityLabel={`${s.label}. Tap to sync now.`} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 2, borderColor: t.border, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Ionicons name={s.icon} size={15} color={status.state === "error" ? t.danger : t.fg} />
      <Text style={{ fontWeight: "800", fontSize: 12, color: t.fg }}>{s.label}</Text>
    </Pressable>
  );
}
