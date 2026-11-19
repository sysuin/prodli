import { describe, expect, it } from "vitest";
import { callFromUrl, formatZoomId, isPlaceholderTitle, notACallReason, placeholderTitle, stillInCall, titleFromTab, zoomMeetingId } from "../../src/recorder/calls";
import { base64ToBytes, bytesToBase64 } from "../../src/recorder/format";

describe("calls ProdLi can record", () => {
  it.each([
    ["https://meet.google.com/abc-defg-hij?authuser=0", { platform: "google-meet", code: "abc-defg-hij" }],
    ["https://app.zoom.us/wc/86012345678/join?fromPWA=1&pwd=x", { platform: "zoom", code: "86012345678" }],
    ["https://zoom.us/wc/join/123456789", { platform: "zoom", code: "123456789" }],
    ["https://acme.zoom.us/wc/9876543210/start", { platform: "zoom", code: "9876543210" }],
    ["https://teams.microsoft.com/v2/", { platform: "teams", code: null }],
    ["https://teams.live.com/v2/?meetingjoin=true", { platform: "teams", code: null }],
    ["https://teams.cloud.microsoft/", { platform: "teams", code: null }],
  ])("%s", (url, call) => {
    expect(callFromUrl(url)).toEqual(call);
  });

  it("ignores pages that aren't calls", () => {
    expect(callFromUrl("https://zoom.us/j/86012345678")).toBeNull(); // the desktop-app launcher page
    expect(callFromUrl("https://zoom.us/signin")).toBeNull();
    expect(callFromUrl("https://notzoom.us/wc/86012345678/join")).toBeNull();
    expect(callFromUrl("https://microsoft.com/teams")).toBeNull();
    expect(callFromUrl("https://evilteams.microsoft.com.example/")).toBeNull();
    expect(zoomMeetingId("https://app.zoom.us/wc/123/join")).toBeNull(); // too short for a meeting ID
  });

  it("explains what to do on a Zoom page that isn't the web client", () => {
    expect(notACallReason("https://zoom.us/j/86012345678")).toMatch(/Join from your browser/);
    expect(notACallReason("https://app.zoom.us/wc/86012345678/join")).toBeNull();
  });

  it("names meetings from the tab title, or a placeholder", () => {
    expect(titleFromTab("teams", "Weekly product sync | Microsoft Teams")).toBe("Weekly product sync");
    expect(titleFromTab("teams", "(3) Chat | Microsoft Teams")).toBeNull();
    expect(titleFromTab("teams", "Microsoft Teams")).toBeNull();
    expect(titleFromTab("zoom", "Zoom Meeting")).toBeNull();
    expect(titleFromTab("zoom", "Acme pilot review - Zoom")).toBe("Acme pilot review");
    expect(titleFromTab("google-meet", "Meet - Weekly sync")).toBeNull(); // Meet titles come from the page
    expect(placeholderTitle({ platform: "zoom", code: "86012345678" })).toBe("Zoom · 860 1234 5678");
    expect(placeholderTitle({ platform: "teams", code: null })).toBe("Teams · meeting");
    expect(placeholderTitle({ platform: "google-meet", code: "abc-defg-hij" })).toBe("Google Meet · abc-defg-hij");
    expect([isPlaceholderTitle("Zoom · 860 1234 5678"), isPlaceholderTitle("Teams · meeting"), isPlaceholderTitle("Weekly sync")]).toEqual([true, true, false]);
    expect(formatZoomId("1234567890")).toBe("123 456 7890");
  });

  it("knows when you've left the call", () => {
    expect(stillInCall("zoom", "https://app.zoom.us/wc/86012345678/leave")).toBe(true);
    expect(stillInCall("zoom", "https://zoom.us/postattendee")).toBe(false);
    expect(stillInCall("teams", "https://teams.microsoft.com/v2/")).toBe(true);
    expect(stillInCall("teams", "https://example.com/")).toBe(false);
    expect(stillInCall("google-meet", "https://meet.google.com/landing")).toBe(false);
  });

  it("moves audio bytes through messages intact", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
