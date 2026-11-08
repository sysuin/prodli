import { describe, expect, it } from "vitest";
import { buildBackup, restoreBackup } from "../../src/lib/backupRestore";
import { storageGet, storageSet } from "../../src/lib/storage";
import { getMeeting, listMeetings, putMeeting } from "../../src/recorder/db";
import type { Meeting } from "../../src/recorder/types";

function meeting(id: string, extra: Partial<Meeting> = {}): Meeting {
  return {
    id,
    platform: "google-meet",
    title: `Meeting ${id}`,
    meetingCode: "abc-defg-hij",
    url: "https://meet.google.com/abc-defg-hij",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationSec: 60,
    status: "ready",
    transcript: [{ id: "1", speaker: "You", text: "Hello", startMs: 0, endMs: 1000 }],
    summary: null,
    error: null,
    notice: null,
    hasAudio: true,
    micIncluded: false,
    audioMimeType: "audio/webm",
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

describe("backup", () => {
  it("includes time tracking, settings and meetings, but never the Claude API key", async () => {
    await storageSet("todos", [{ id: "t1", title: "Task", completed: false, createdAt: "" }]);
    await storageSet("tt_2026-11-07", { "github.com": 120 });
    await storageSet("tt_settings", { idleThreshold: 60, notifyEnabled: false, notifyTime: "20:00", focusList: [], excludedDomains: [] });
    await storageSet("claudeApiKey", "sk-ant-secret");
    await putMeeting(meeting("m1"));

    const backup = await buildBackup();
    expect(backup.version).toBe("1.1");
    expect(backup.data.todos).toHaveLength(1);
    expect(backup.timeTracking).toEqual({ "2026-11-07": { "github.com": 120 } });
    expect(backup.data.tt_settings).toMatchObject({ notifyEnabled: false });
    expect(backup.meetings?.map((m) => m.id)).toContain("m1");
    expect(backup.meetings?.[0].hasAudio).toBe(false); // audio isn't exported
    expect(JSON.stringify(backup)).not.toContain("sk-ant-secret");
  });

  it("restores a 1.1 backup, replacing tracking days and meetings", async () => {
    await storageSet("tt_2026-01-01", { "old.com": 5 });
    await putMeeting(meeting("stale"));
    const result = await restoreBackup({
      version: "1.1",
      exportedAt: "",
      data: { todos: [{ id: "a", title: "Restored", completed: false, createdAt: "" }] },
      timeTracking: { "2026-11-07": { "github.com": 120 } },
      meetings: [meeting("restored", { status: "recording" }), { not: "a meeting" }],
    });
    expect(result).toEqual({ ok: true });
    expect(await storageGet("todos", [])).toHaveLength(1);
    expect(await storageGet("tt_2026-11-07", {})).toEqual({ "github.com": 120 });
    expect(await storageGet("tt_2026-01-01", null)).toBeNull();
    const ids = (await listMeetings()).map((m) => m.id);
    expect(ids).toContain("restored");
    expect(ids).not.toContain("stale");
    expect((await getMeeting("restored"))?.status).toBe("ready");
  });

  it("restores a 1.0 backup without touching tracking data or meetings", async () => {
    await storageSet("tt_2026-11-07", { "github.com": 120 });
    await putMeeting(meeting("keep"));
    const result = await restoreBackup({ version: "1.0", exportedAt: "", data: { notes: [] } });
    expect(result.ok).toBe(true);
    expect(await storageGet("tt_2026-11-07", {})).toEqual({ "github.com": 120 });
    expect((await listMeetings()).map((m) => m.id)).toContain("keep");
  });

  it("rejects files that aren't ProdLi backups or are from a newer version", async () => {
    expect((await restoreBackup({ foo: 1 })).ok).toBe(false);
    expect((await restoreBackup({ version: "9.0", data: {} })).error).toMatch(/newer version/);
  });
});
