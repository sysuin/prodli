import { describe, expect, it } from "vitest";
import { meetingCodeFromUrl, notACallReason } from "../../src/recorder/controller";

describe("recognising a Google Meet call", () => {
  it.each([
    ["https://meet.google.com/abc-defg-hij", "abc-defg-hij"],
    ["https://meet.google.com/abc-defg-hij?authuser=1&pli=1", "abc-defg-hij"],
    ["https://meet.google.com/abc-defg-hij/", "abc-defg-hij"],
    ["https://meet.google.com/u/1/abc-defg-hij", "abc-defg-hij"],
    ["https://meet.google.com/_meet/abc-defg-hij?ijlm=1", "abc-defg-hij"],
    ["https://meet.google.com/", null],
    ["https://meet.google.com/landing", null],
    ["https://evil.example/abc-defg-hij", null],
    ["https://meet.google.com.evil.example/abc-defg-hij", null],
    [undefined, null],
  ])("%s → %s", (url, code) => {
    expect(meetingCodeFromUrl(url)).toBe(code);
  });

  it("says why recording can't start, in plain words", () => {
    expect(notACallReason("https://meet.google.com/abc-defg-hij")).toBeNull();
    expect(notACallReason("https://meet.google.com/landing")).toMatch(/Join the call first/);
    expect(notACallReason("https://mail.google.com/mail/u/0/#inbox")).toMatch(/inside Gmail or Calendar/);
    expect(notACallReason("https://example.com/")).toMatch(/records Google Meet calls/);
    expect(notACallReason(undefined)).toMatch(/couldn't read this tab's address/);
  });
});
