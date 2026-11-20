import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export function haptic(kind: "light" | "success" | "warning" = "light"): void {
  if (Platform.OS === "web") return;
  if (kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else void Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
