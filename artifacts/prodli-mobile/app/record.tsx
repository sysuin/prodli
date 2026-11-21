// Record an in-person meeting on the phone: live transcript while you talk,
// then a synced meeting with an AI summary.
import { useAudioStream, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, Text, View } from "react-native";
import { retryable, transcribePiece } from "@/lib/ai";
import { ACCOUNT_KEY, errorText, type ProdliUser } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { clearProgress, saveMeeting, saveProgress, summarizeInBackground } from "@/lib/inPerson";
import { LiveTranscriber, type TranscriberState } from "@/lib/liveTranscriber";
import { formatTimestamp } from "@/lib/meetings";
import { useStored } from "@/lib/store";
import { Banner, Button, Card, Empty, Input, P, Row, Screen } from "@/ui/kit";
import { font, useTheme } from "@/ui/theme";

type Phase = "ready" | "recording" | "finishing";

export default function RecordScreen() {
  const t = useTheme();
  const user = useStored<ProdliUser | null>(ACCOUNT_KEY, null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [title, setTitle] = useState("");
  const [state, setState] = useState<TranscriberState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(0);
  const transcriber = useRef<LiveTranscriber | null>(null);

  const { stream } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: "int16",
    onBuffer: (b) => transcriber.current?.push(b.data, b.sampleRate, b.channels),
  });

  // Keep the transcript so far on the phone, so closing the app doesn't lose it.
  useEffect(() => {
    if (phase === "recording" && state) saveProgress({ title, startedAt: startedAt.current, lastAt: Date.now(), entries: state.entries, failed: state.failed });
  }, [state, phase, title]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Android back button: don't leave by accident while recording.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => (clearInterval(id), sub.remove());
  }, [phase]);

  const start = async () => {
    setErr(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setErr("ProdLi needs the microphone to record. Allow it in your phone's Settings → ProdLi.");
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      transcriber.current = new LiveTranscriber(transcribePiece, setState, { isRetryable: retryable });
      setState(transcriber.current.snapshot);
      startedAt.current = Date.now();
      await stream.start();
      void activateKeepAwakeAsync("prodli-recording").catch(() => {});
      haptic("success");
      setPhase("recording");
    } catch (e) {
      transcriber.current = null;
      setErr(`Couldn't start recording: ${errorText(e)}`);
    }
  };

  const stop = async () => {
    stream.stop();
    deactivateKeepAwake("prodli-recording");
    void setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
    haptic();
    setPhase("finishing");
    const done = await transcriber.current!.finish();
    const m = saveMeeting({ title, startedAt: startedAt.current, endedAt: Date.now(), entries: done.entries, failed: done.failed });
    transcriber.current = null;
    void summarizeInBackground(m);
    router.replace({ pathname: "/meetings/[id]", params: { id: m.id } });
  };

  const discard = () => {
    stream.stop();
    deactivateKeepAwake("prodli-recording");
    transcriber.current = null;
    clearProgress();
    setPhase("ready");
    setState(null);
  };

  const elapsed = phase === "recording" ? now - startedAt.current : 0;
  const lines = useMemo(() => (state?.entries ?? []).slice(-30), [state?.entries]);

  if (!user) {
    return (
      <Screen edges={[]}>
        <Empty icon="mic-outline" title="Sign in to record" hint="In-person meetings are transcribed with ProdLi's AI, which needs your (free) ProdLi account." />
        <Button title="Sign in" icon="person-circle-outline" onPress={() => router.push("/account")} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: "Record in person", gestureEnabled: phase === "ready", headerBackVisible: phase === "ready" }} />
      <Input label="Title (optional)" placeholder="e.g. Coffee with Priya" value={title} onChangeText={setTitle} editable={phase !== "finishing"} maxLength={200} />
      {phase === "ready" ? (
        <>
          <Banner text="Tell everyone you're recording before you start. Speech is sent to ProdLi's AI to transcribe in short pieces while you talk; the audio isn't kept, only the text." />
          <Button title="Start recording" icon="mic" onPress={() => void start()} style={{ minHeight: 64 }} />
          <P muted style={{ fontSize: font.small }}>Recording continues with the screen locked. Transcription uses your monthly AI minutes (Account shows how many are left).</P>
        </>
      ) : (
        <Card color={phase === "recording" ? "#FF6B6B" : t.muted} style={{ alignItems: "center", paddingVertical: 20 }}>
          <Text style={{ fontWeight: "900", color: phase === "recording" ? "#000" : t.fg }}>{phase === "recording" ? "● Recording" : "Finishing the transcript…"}</Text>
          <Text accessibilityRole="timer" style={{ fontSize: 48, fontWeight: "900", color: phase === "recording" ? "#000" : t.fg, fontVariant: ["tabular-nums"] }}>{formatTimestamp(elapsed)}</Text>
          {state?.pending ? <Text style={{ color: phase === "recording" ? "#000" : t.mutedFg, fontSize: font.small }}>Transcribing {state.pending} part{state.pending > 1 ? "s" : ""}…</Text> : null}
        </Card>
      )}
      {phase === "recording" ? (
        <Row>
          <Button style={{ flex: 2 }} title="Stop and save" icon="stop" onPress={() => void stop()} />
          <Button style={{ flex: 1 }} variant="ghost" title="Discard" icon="trash-outline" onPress={discard} />
        </Row>
      ) : null}
      {err ? <Banner tone="error" text={err} action={/Settings/.test(err) ? <Button small variant="ghost" title="Open Settings" onPress={() => void Linking.openSettings()} /> : undefined} /> : null}
      {state?.error && state.failed ? <Banner tone="error" text={`Some speech couldn't be transcribed: ${state.error}`} /> : null}
      {lines.length ? (
        <View style={{ gap: 8 }}>
          {lines.map((e) => (
            <View key={e.id}>
              <Text style={{ fontSize: font.small, color: t.mutedFg, fontWeight: "800" }}>{formatTimestamp(e.startMs)}</Text>
              <P selectable>{e.text}</P>
            </View>
          ))}
        </View>
      ) : phase === "recording" ? (
        <P muted>The transcript appears here after each pause.</P>
      ) : null}
    </Screen>
  );
}
