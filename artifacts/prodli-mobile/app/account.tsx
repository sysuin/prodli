// Account: sign in with Google, sync status, plan and allowances, devices, sign out, delete.
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Text, View } from "react-native";
import { deleteAccount, getAiUsage, getBilling, listDevices, refreshAccount, signInForDevelopment, signInWithGoogle, signOut, signOutDevice, signOutEverywhere, type AiUsage, type BillingInfo, type Device } from "@/lib/account";
import { ACCOUNT_KEY, apiBase, errorText, type ProdliUser } from "@/lib/api";
import { isLocalServer } from "@/lib/config";
import { googleAvailable } from "@/lib/google";
import { useStored } from "@/lib/store";
import { syncNow, useSyncStatus } from "@/lib/syncRunner";
import { Banner, Button, Card, H2, Input, ListRow, LogoMark, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, b / 1024 ** 2).toFixed(1)} MB`);
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function SignIn() {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState("dev@example.com");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      void syncNow();
    } catch (e) {
      if (!(e as { cancelled?: boolean }).cancelled) setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
        <LogoMark size={48} />
        <Text style={{ fontWeight: "900", fontSize: font.h2, color: t.fg, textAlign: "center" }}>Your ProdLi, everywhere</Text>
        <P muted style={{ textAlign: "center" }}>Sign in with the Google account you use in the ProdLi extension or at app.prodli.com. Your notes, to-dos, habits and meetings sync both ways; what's on this phone is added to your account.</P>
        {googleAvailable() ? <Button title="Sign in with Google" icon="logo-google" busy={busy} onPress={() => run(signInWithGoogle)} style={{ alignSelf: "stretch" }} /> : <Banner text={Platform.OS === "web" ? "Google sign-in works in the iOS and Android apps." : "Google sign-in isn't set up in this build (see docs/MOBILE.md)."} />}
      </Card>
      {isLocalServer() || __DEV__ ? (
        <Card>
          <P muted style={{ fontSize: font.small }}>Developer sign-in — only accepted by a local server started with DEV_FAKE_GOOGLE=true ({apiBase()}).</P>
          <Input value={devEmail} onChangeText={setDevEmail} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Developer email" />
          <Button variant="ghost" small title="Developer sign-in" busy={busy} onPress={() => run(() => signInForDevelopment(devEmail))} />
        </Card>
      ) : null}
      {err ? <Banner tone="error" text={err} /> : null}
      <P muted style={{ fontSize: font.small }}>Everything works without an account; your data then stays on this phone.</P>
    </>
  );
}

export default function AccountScreen() {
  const t = useTheme();
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  const status = useSyncStatus();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [confirm, setConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    void refreshAccount();
    listDevices().then(setDevices, () => {});
    getAiUsage().then(setUsage, () => {});
    getBilling().then(setBilling, () => {});
  }, [user?.id]);
  useEffect(load, [load]);

  if (!user) return <Screen edges={[]}><SignIn /></Screen>;

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const plan = billing?.plan ?? (user.plan === "pro" ? "pro" : "free");
  const limits = billing?.limits[plan];

  return (
    <Screen edges={[]}>
      <Card>
        <Text style={{ fontWeight: "900", fontSize: font.h2, color: t.fg }}>{user.name || user.email}</Text>
        <P muted>{user.email}</P>
        <Row>
          <Text style={{ backgroundColor: plan === "pro" ? t.primary : t.muted, color: plan === "pro" ? "#000" : t.fg, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 2, borderWidth: 2, borderColor: t.border }}>{plan === "pro" ? "ProdLi Pro" : "Free plan"}</Text>
        </Row>
      </Card>

      <H2>Sync</H2>
      <Card>
        <P>
          {status.state === "syncing" ? "Syncing…" : status.state === "offline" ? "Offline — changes sync when you're back online." : status.state === "error" ? `Sync problem: ${status.error}` : status.lastSyncAt ? `Synced ${ago(status.lastSyncAt)}.` : "Not synced yet."}
        </P>
        {status.usage ? <P muted style={{ fontSize: font.small }}>{mb(status.usage.bytes)} of {mb(status.usage.quota)} used</P> : null}
        {status.tooLarge ? <P muted style={{ fontSize: font.small }}>{status.tooLarge} item(s) are too large to sync.</P> : null}
        <Button small variant="ghost" icon="sync" title="Sync now" onPress={() => void syncNow()} busy={status.state === "syncing"} />
      </Card>

      {usage || limits ? (
        <>
          <H2>This month's AI</H2>
          <Card>
            {usage ? <P>Meeting summaries: {usage.used} of {usage.limit}</P> : null}
            {usage?.briefs ? <P>Daily briefs: {usage.briefs.used} of {usage.briefs.limit}</P> : null}
            {usage?.asks ? <P>Ask ProdLi: {usage.asks.used} of {usage.asks.limit}</P> : null}
            {usage?.transcribeSeconds ? <P>Transcription: {Math.round(usage.transcribeSeconds.used / 60)} of {Math.round(usage.transcribeSeconds.limit / 60)} minutes</P> : null}
            <P muted style={{ fontSize: font.small }}>Allowances reset on the 1st.{billing?.subscription?.renewsAt ? ` Pro renews ${new Date(billing.subscription.renewsAt).toLocaleDateString()}.` : ""}</P>
          </Card>
        </>
      ) : null}

      <H2>Signed-in devices</H2>
      <Card style={{ padding: 0, gap: 0 }}>
        {(devices ?? []).map((d) => (
          <ListRow
            key={d.id}
            icon={d.client === "mobile" ? "phone-portrait-outline" : d.client === "extension" ? "extension-puzzle-outline" : "globe-outline"}
            title={`${d.device || "Unknown device"}${d.current ? " (this phone)" : ""}`}
            subtitle={`${d.client === "mobile" ? "Phone app" : d.client === "extension" ? "Extension" : "Web"} · ${ago(d.lastUsedAt)}`}
            right={d.current ? <View /> : <Button small variant="ghost" title="Sign out" onPress={() => act(async () => (await signOutDevice(d.id), setDevices((cur) => cur?.filter((x) => x.id !== d.id) ?? null)))} />}
          />
        ))}
        {!devices ? <P muted style={{ padding: 12 }}>Loading…</P> : null}
      </Card>
      {err ? <Banner tone="error" text={err} /> : null}

      <Button variant="ghost" icon="log-out-outline" title="Sign out on this phone" onPress={() => Alert.alert("Sign out?", "Your data stays on this phone; it stops syncing until you sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", onPress: () => void signOut() }])} />
      <Button variant="ghost" icon="exit-outline" title="Sign out everywhere" onPress={() => Alert.alert("Sign out everywhere?", "Every computer, browser and phone signed in to this account is signed out.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out everywhere", style: "destructive", onPress: () => void act(signOutEverywhere) }])} />
      <ListRow icon="download-outline" title="Download a copy of your data" subtitle="At app.prodli.com → Account → Export" onPress={() => void Linking.openURL("https://app.prodli.com/")} />

      <H2>Delete account</H2>
      {showDelete ? (
        <Card>
          <P>This permanently deletes your ProdLi account and everything stored on ProdLi's servers (backups age out within 30 days). Data on this phone stays until you delete the app.{plan === "pro" ? " Your Pro subscription is cancelled." : ""}</P>
          <Input label={`Type ${user.email} to confirm`} value={confirm} onChangeText={setConfirm} autoCapitalize="none" keyboardType="email-address" />
          <Button variant="danger" icon="trash" title="Delete my account" disabled={confirm.trim().toLowerCase() !== user.email.toLowerCase()} onPress={() => void act(() => deleteAccount(confirm))} />
        </Card>
      ) : (
        <Button variant="ghost" small title="Delete account…" onPress={() => setShowDelete(true)} />
      )}
    </Screen>
  );
}
