import { router } from "expo-router";
import { Button, Empty, Screen } from "@/ui/kit";

export default function NotFound() {
  return (
    <Screen>
      <Empty icon="compass-outline" title="Nothing here" hint="This link doesn't lead to anything in ProdLi." />
      <Button title="Go to Today" icon="sunny-outline" onPress={() => router.replace("/")} />
    </Screen>
  );
}
