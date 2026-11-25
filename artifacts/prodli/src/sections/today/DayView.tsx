// Today → Agenda → Day: a timeline of the day you can plan by dragging.
//  - Drag a task from "To place" onto the timeline to block time for it.
//  - Drag a block to move it; drag its bottom edge to change its length.
//  - Drag a block back to "To place" to unblock it.
// Keyboard: Enter on a task places it in the next free time; on a block,
// ↑/↓ move it 15 minutes, Shift+↑/↓ change its length, Delete unblocks it.
// Blocks are the same Todo.block as "⏱ Block time" (lib/timeBlocks.ts).

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { blockMinutes, blockOf, clampStart, columns, conflicts, dayRange, MIN_BLOCK_MIN, nextFreeStart, snap, SNAP_MIN, toHM, toMin, type Slot } from "../../lib/timeBlocks";
import type { CalendarEvent } from "../../lib/calendar";
import type { Todo } from "../../types";

const PX = 1.1; // pixels per minute
const ACCENT = "#F59E0B";
const EVENT = "#FF4FA3";

type Drag =
  | { mode: "move" | "resize"; id: string; y0: number; start: number; minutes: number; origStart: number; origMinutes: number; moved: boolean; overTray: boolean }
  | { mode: "new"; id: string; y0: number; start: number | null; minutes: number; moved: boolean; overTray: boolean };

type Item = (Slot & { kind: "event"; event: CalendarEvent }) | (Slot & { kind: "block"; todo: Todo });

export function DayView(props: {
  day: string;
  events: CalendarEvent[];
  todos: Todo[];
  /** Today's planned tasks without a block. */
  unblocked: Todo[];
  workStart: string;
  workEnd: string;
  nowMin: number;
  onBlock: (id: string, start: string | undefined) => void;
  onLength: (id: string, minutes: number) => void;
}) {
  const { day, events, todos, unblocked, workStart, workEnd, nowMin, onBlock, onLength } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [status, setStatus] = useState("");
  const trayHelp = useId();
  const blockHelp = useId();

  const blocks: Item[] = todos.flatMap((t) => {
    const s = blockOf(t, day);
    return s ? [{ kind: "block" as const, ...s, todo: t }] : [];
  });
  const timed: Item[] = events.filter((e) => !e.allDay && e.start && e.end).map((e) => ({ kind: "event" as const, start: toMin(e.start!), end: Math.max(toMin(e.end!), toMin(e.start!) + 10), event: e }));
  const range = dayRange([...timed, ...blocks], workStart, workEnd);
  const clash = conflicts(todos, events, day);
  const height = (range.end - range.start) * PX;

  // While dragging, show the block where it would land.
  const shown: Item[] = [
    ...timed,
    ...blocks.map((b) => (drag && drag.mode !== "new" && b.kind === "block" && b.todo.id === drag.id ? { ...b, start: drag.start, end: drag.start + drag.minutes } : b)),
  ];
  const ghostTodo = drag?.mode === "new" ? unblocked.find((t) => t.id === drag.id) : undefined;
  if (drag?.mode === "new" && ghostTodo && drag.start !== null) shown.push({ kind: "block", start: drag.start, end: drag.start + drag.minutes, todo: ghostTodo });
  const laid = columns(shown);

  const minuteAtY = (clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    return range.start + (clientY - r.top) / PX;
  };
  const over = (el: HTMLElement | null, x: number, y: number) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const title = (id: string) => todos.find((t) => t.id === id)?.title ?? "Task";

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(d);
  };
  /** Where the drag is at this pointer position. */
  const follow = (d: Drag, e: { clientX: number; clientY: number }): Drag => {
    const moved = d.moved || Math.abs(e.clientY - d.y0) > 3;
    const overTray = over(trayRef.current, e.clientX, e.clientY);
    if (d.mode === "new") {
      const start = over(gridRef.current, e.clientX, e.clientY) ? clampStart(minuteAtY(e.clientY) - d.minutes / 2, d.minutes, range) : null;
      return { ...d, start, moved, overTray };
    }
    if (d.mode === "move") return { ...d, start: clampStart(d.origStart + (e.clientY - d.y0) / PX, d.minutes, range), moved, overTray };
    return { ...d, minutes: Math.max(MIN_BLOCK_MIN, Math.min(snap(d.origMinutes + (e.clientY - d.y0) / PX), range.end - d.start)), moved, overTray };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (dragRef.current) setDrag(follow(dragRef.current, e));
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    // Use the release point itself: the last move may not have rendered yet.
    const d = follow(dragRef.current, e);
    setDrag(null);
    if (!d.moved) return;
    const name = title(d.id);
    if (d.mode === "new") {
      if (d.start === null) return;
      onBlock(d.id, toHM(d.start));
      setStatus(`${name}: blocked ${toHM(d.start)}–${toHM(d.start + d.minutes)}.`);
    } else if (d.overTray && d.mode === "move") {
      onBlock(d.id, undefined);
      setStatus(`${name}: unblocked.`);
    } else if (d.mode === "move" && d.start !== d.origStart) {
      onBlock(d.id, toHM(d.start));
      setStatus(`${name}: moved to ${toHM(d.start)}–${toHM(d.start + d.minutes)}.`);
    } else if (d.mode === "resize" && d.minutes !== d.origMinutes) {
      onLength(d.id, d.minutes);
      setStatus(`${name}: ${d.minutes} minutes, until ${toHM(d.start + d.minutes)}.`);
    }
  };

  const placeNext = (t: Todo) => {
    const at = nextFreeStart(t, todos, events, day, workStart, workEnd, nowMin);
    if (!at) return setStatus(`${t.title}: no free time left today that fits.`);
    onBlock(t.id, at);
    setStatus(`${t.title}: blocked ${at}–${toHM(toMin(at) + blockMinutes(t))}.`);
  };
  const blockKeys = (e: ReactKeyboardEvent, t: Todo, s: Slot) => {
    const minutes = s.end - s.start;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      if (e.shiftKey) {
        const next = Math.max(MIN_BLOCK_MIN, Math.min(minutes + dir * SNAP_MIN, range.end - s.start));
        onLength(t.id, next);
        setStatus(`${t.title}: ${next} minutes, until ${toHM(s.start + next)}.`);
      } else {
        const start = clampStart(s.start + dir * SNAP_MIN, minutes, { start: 0, end: 24 * 60 });
        onBlock(t.id, toHM(start));
        setStatus(`${t.title}: moved to ${toHM(start)}–${toHM(start + minutes)}.`);
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onBlock(t.id, undefined);
      setStatus(`${t.title}: unblocked.`);
    }
  };

  // Keep the current time in view when the day view opens.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nowMin > range.start && nowMin < range.end) el.scrollTop = Math.max(0, (nowMin - range.start) * PX - 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chip: CSSProperties = { border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "4px 8px", fontSize: 12, fontWeight: 700, cursor: "grab", fontFamily: "inherit", touchAction: "none", userSelect: "none", textAlign: "left" };

  return (
    <div data-testid="day-view" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} style={{ display: "grid", gap: 8 }}>
      <div
        ref={trayRef}
        data-testid="day-tray"
        aria-label="Tasks to place"
        style={{ border: `2px dashed ${drag && drag.mode === "move" && drag.overTray ? ACCENT : "var(--nb-section-border)"}`, padding: 8, background: drag?.mode === "move" && drag.overTray ? "hsl(var(--muted))" : "transparent" }}
      >
        <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: unblocked.length ? 6 : 0 }}>
          To place {unblocked.length ? `(${unblocked.length})` : ""}
        </div>
        {unblocked.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.75 }}>{drag?.mode === "move" ? "Drop here to unblock." : "Plan tasks for today, then drag them onto the timeline. Drag a block here to unblock it."}</div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {unblocked.map((t) => (
              <button
                key={t.id}
                data-testid="tray-task"
                onPointerDown={(e) => startDrag(e, { mode: "new", id: t.id, y0: e.clientY, start: null, minutes: blockMinutes(t), moved: false, overTray: true })}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), placeNext(t))}
                aria-label={`${t.title} · ${blockMinutes(t)} min`}
                aria-describedby={trayHelp}
                style={{ ...chip, opacity: drag?.mode === "new" && drag.id === t.id ? 0.4 : 1 }}
              >
                {t.title} <span style={{ fontWeight: 400, opacity: 0.75 }}>· {blockMinutes(t)} min</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={scrollRef} tabIndex={0} role="region" aria-label="Day timeline" style={{ maxHeight: 520, overflowY: "auto", border: "var(--nb-border)" }}>
        <div ref={gridRef} data-testid="day-grid" style={{ position: "relative", height, marginLeft: 44, borderLeft: "1px solid var(--nb-section-border)" }}>
          {Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60).map((m) => (
            <div key={m} aria-hidden style={{ position: "absolute", top: (m - range.start) * PX, left: 0, right: 0, borderTop: "1px solid var(--nb-section-border)" }}>
              <span style={{ position: "absolute", left: -44, top: -7, width: 40, textAlign: "right", fontSize: 10, fontFamily: "Space Mono, monospace", opacity: 0.75 }}>{toHM(m % (24 * 60))}</span>
            </div>
          ))}
          {/* The current-time line sits above the blocks but lets clicks and drags through to them. */}
          {nowMin > range.start && nowMin < range.end && <div aria-hidden data-testid="now-line" style={{ position: "absolute", top: (nowMin - range.start) * PX, left: 0, right: 0, borderTop: "2px solid #E53935", zIndex: 3, pointerEvents: "none" }} />}
          {laid.map(({ item, col, cols }) => {
            const top = (item.start - range.start) * PX;
            const h = Math.max(18, (item.end - item.start) * PX - 2);
            const box: CSSProperties = { position: "absolute", top, height: h, left: `calc(${(col / cols) * 100}% + 3px)`, width: `calc(${100 / cols}% - 6px)`, boxSizing: "border-box", overflow: "hidden", fontSize: 11, lineHeight: 1.25, padding: "2px 6px", border: "2px solid #000" };
            if (item.kind === "event")
              return (
                <div key={`e-${item.event.id}`} data-testid="day-event" style={{ ...box, background: EVENT, color: "#000", zIndex: 1 }}>
                  <strong>{item.event.title}</strong> <span>{item.event.start}–{item.event.end}</span>
                </div>
              );
            const t = item.todo;
            const minutes = item.end - item.start;
            const isGhost = drag?.mode === "new" && drag.id === t.id;
            const dragging = drag && drag.mode !== "new" && drag.id === t.id;
            const bad = clash.has(t.id) && !dragging;
            return (
              <div
                key={`b-${t.id}`}
                role="button"
                tabIndex={isGhost ? -1 : 0}
                data-testid="day-block"
                data-id={t.id}
                aria-label={`${t.title} ${toHM(item.start)}–${toHM(item.end)}${bad ? " (overlaps)" : ""}`}
                aria-describedby={blockHelp}
                onPointerDown={(e) => !isGhost && startDrag(e, { mode: "move", id: t.id, y0: e.clientY, start: item.start, minutes, origStart: item.start, origMinutes: minutes, moved: false, overTray: false })}
                onKeyDown={(e) => blockKeys(e, t, item)}
                style={{ ...box, background: ACCENT, color: "#000", zIndex: dragging || isGhost ? 4 : 2, cursor: dragging ? "grabbing" : "grab", opacity: isGhost ? 0.75 : 1, borderColor: bad ? "#C62828" : "#000", borderStyle: isGhost ? "dashed" : "solid", touchAction: "none", userSelect: "none", boxShadow: dragging ? "3px 3px 0 #000" : undefined }}
              >
                <strong>{t.title}</strong> <span>{toHM(item.start)}–{toHM(item.end)}</span>
                {!isGhost && (
                  <div
                    aria-hidden
                    data-testid="block-resize"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startDrag(e, { mode: "resize", id: t.id, y0: e.clientY, start: item.start, minutes, origStart: item.start, origMinutes: minutes, moved: false, overTray: false });
                    }}
                    style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 7, cursor: "ns-resize", background: "rgba(0,0,0,0.18)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <span id={trayHelp} hidden>
        Drag onto the timeline, or press Enter to place it in the next free time.
      </span>
      <span id={blockHelp} hidden>
        Drag to move it, or use the up and down arrow keys. Shift with the arrows changes its length. Delete unblocks it.
      </span>
      <div role="status" aria-live="polite" style={{ fontSize: 12, fontWeight: 700, minHeight: 16 }}>
        {status}
      </div>
    </div>
  );
}
