// Today → Agenda: "Show my blocks in Google Calendar" (two-way, lib/calendarSync.ts).
// The web app has no background, so this also syncs while Today is open.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { onStorageChange, storageGet } from "../../lib/storage";
import { calendarBlocksAvailable, CALENDAR_SYNC_KEY, setCalendarSync, syncCalendarBlocks, type CalendarSyncSettings } from "../../lib/calendarSync";
import type { Todo } from "../../types";

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.alarms;

export function CalendarBlocksToggle({ todos, style }: { todos: Todo[]; style: CSSProperties }) {
  const [s, setS] = useState<CalendarSyncSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const first = useRef(true);

  useEffect(() => {
    void storageGet<CalendarSyncSettings>(CALENDAR_SYNC_KEY, { enabled: false }).then(setS);
    return onStorageChange<CalendarSyncSettings>(CALENDAR_SYNC_KEY, (v) => setS(v ?? { enabled: false }));
  }, []);

  // Web app: sync when Today opens and a few seconds after blocks change (the extension's background does this itself).
  useEffect(() => {
    if (!s?.enabled || isExtension()) return;
    const t = setTimeout(() => void syncCalendarBlocks(false), first.current ? 0 : 4000);
    first.current = false;
    return () => clearTimeout(t);
  }, [s?.enabled, todos]);

  if (!s || !calendarBlocksAvailable()) return null;
  const toggle = async () => {
    setBusy(true);
    setNote("");
    const r = await setCalendarSync(!s.enabled);
    if (!r.ok) setNote(r.error ?? "Couldn't connect.");
    setBusy(false);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        style={style}
        disabled={busy}
        aria-pressed={s.enabled}
        data-testid="calendar-blocks-toggle"
        title="Put your time blocks in a “ProdLi” calendar in Google Calendar. Move or resize them there and ProdLi follows. ProdLi can only change the calendar it creates."
        onClick={() => void toggle()}
      >
        {busy ? "Connecting…" : s.enabled ? "✓ Blocks in Google Calendar" : "📅 Show blocks in Google Calendar"}
      </button>
      {note && <span role="alert" style={{ fontSize: 11, color: "#B91C1C", fontWeight: 700 }}>{note}</span>}
    </span>
  );
}
