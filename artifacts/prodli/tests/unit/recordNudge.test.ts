import { describe, expect, it } from "vitest";
import { markNudged, nudgeKey, nudgeMessage } from "../../src/lib/recordNudge";

describe("nudgeKey", () => {
  it("is set for meeting links that mean you're in that meeting", () => {
    expect(nudgeKey("https://meet.google.com/abc-defg-hij?authuser=0")).toBe("google-meet:abc-defg-hij");
    expect(nudgeKey("https://app.zoom.us/wc/86012345678/join")).toBe("zoom:86012345678");
    expect(nudgeKey("https://meet.jit.si/TeamStandup")).toBe("jitsi:teamstandup");
  });
  it("is null for app tabs that stay open all day and for other pages", () => {
    expect(nudgeKey("https://teams.microsoft.com/v2/")).toBeNull();
    expect(nudgeKey("https://app.slack.com/client/T1/C1")).toBeNull();
    expect(nudgeKey("https://meet.google.com/")).toBeNull();
    expect(nudgeKey("https://example.com/")).toBeNull();
    expect(nudgeKey(undefined)).toBeNull();
  });
});

describe("markNudged", () => {
  it("adds today's reminder and keeps the newest 50", () => {
    const old = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, `2026-10-${String((i % 28) + 1).padStart(2, "0")}`]));
    const r = markNudged(old, "google-meet:abc-defg-hij", "2026-11-20");
    expect(Object.keys(r)).toHaveLength(50);
    expect(r["google-meet:abc-defg-hij"]).toBe("2026-11-20");
  });
});

describe("nudgeMessage", () => {
  it("names the app and the shortcut", () => {
    expect(nudgeMessage("zoom:1", "Ctrl+Shift+9").message).toBe("You're in a Zoom call. Click the ProdLi icon or press Ctrl+Shift+9 to record it and get AI notes.");
  });
});
