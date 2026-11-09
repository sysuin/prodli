import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveTranscriber, mergeSpeechEntries, speechAvailability } from "../../src/recorder/speech";

// A fake on-device recogniser: emits results we push, ends when stop() is called or on demand.
class FakeRecognition extends EventTarget {
  static instances: FakeRecognition[] = [];
  static available = vi.fn(async () => "available");
  lang = "";
  continuous = false;
  interimResults = false;
  processLocally = false;
  track: MediaStreamTrack | undefined;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    super();
    FakeRecognition.instances.push(this);
  }
  start(track?: MediaStreamTrack) {
    this.track = track;
  }
  stop() {
    setTimeout(() => this.onend?.(), 0);
  }
  abort() {}
  emit(results: string[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results: results.map((t) => ({ isFinal: false, 0: { transcript: t } })) });
  }
}

const liveTrack = { readyState: "live" } as unknown as MediaStreamTrack;

afterEach(() => {
  delete (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition;
  FakeRecognition.instances = [];
  vi.useRealTimers();
});

describe("on-device transcription", () => {
  it("reports unsupported when the browser has no on-device API", async () => {
    expect(await speechAvailability("en-US")).toBe("unsupported");
    (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    expect(await speechAvailability("en-US")).toBe("available");
  });

  it("transcribes a track locally, keeping the latest text of each result", async () => {
    (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    const t = new LiveTranscriber(liveTrack, "Others", "en-US", Date.now());
    expect(t.start()).toBe(true);
    const rec = FakeRecognition.instances[0];
    expect(rec).toMatchObject({ lang: "en-US", continuous: true, interimResults: true, processLocally: true, track: liveTrack });
    rec.emit(["Hello"]);
    rec.emit(["Hello team"]);
    rec.emit(["Hello team", "Let's ship"], 1);
    const entries = await t.stop();
    expect(entries.map((e) => `${e.speaker}: ${e.text}`)).toEqual(["Others: Hello team", "Others: Let's ship"]);
  });

  it("restarts after Chrome ends a session, until stopped", async () => {
    vi.useFakeTimers();
    (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    const t = new LiveTranscriber(liveTrack, "You", "en-US", Date.now());
    t.start();
    FakeRecognition.instances[0].emit(["first part"]);
    FakeRecognition.instances[0].onend?.(); // e.g. after a long silence
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeRecognition.instances).toHaveLength(2);
    FakeRecognition.instances[1].emit(["second part"]);
    const stopping = t.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await stopping).map((e) => e.text)).toEqual(["first part", "second part"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeRecognition.instances).toHaveLength(2); // no restart after stop
  });

  it("merges You and Others in time order", () => {
    const merged = mergeSpeechEntries(
      [{ id: "a", speaker: "Others", text: "Hi", startMs: 1000, endMs: 1500 }],
      [{ id: "b", speaker: "You", text: "Hello", startMs: 500, endMs: 900 }],
    );
    expect(merged.map((e) => e.speaker)).toEqual(["You", "Others"]);
  });
});
