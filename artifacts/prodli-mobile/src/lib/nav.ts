import { router } from "expo-router";

/** Back to the previous screen, or Today when there's none (e.g. opened from a link). */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
