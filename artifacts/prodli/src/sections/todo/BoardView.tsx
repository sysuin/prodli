// To-dos → ▦ Board and ⊞ Matrix: cards in columns (No date / Upcoming / Today /
// Done) or in an Eisenhower matrix. Drag a card, or use its "Move to" menu.
// Rules: lib/todoBoards.ts.

import { useState, type CSSProperties } from "react";
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { BOARD_COLUMNS, QUADRANTS, boardColumn, describeMove, moveToColumn, moveToQuadrant, quadrant, type BoardColumn, type Quadrant } from "../../lib/todoBoards";
import type { Todo } from "../../types";

type Mode = "board" | "matrix";
const PRIORITY: Record<string, { label: string; bg: string; fg: string }> = { high: { label: "HIGH", bg: "#DC2626", fg: "#fff" }, medium: { label: "MED", bg: "#FFD700", fg: "#000" }, low: { label: "LOW", bg: "#15803D", fg: "#fff" } };
const QUAD_COLOR: Record<Quadrant, string> = { do: "#DC2626", schedule: "#2563EB", quick: "#D97706", later: "#6B7280" };

function Card({ t, mode, today, listName, places, onMove, onToggle }: { t: Todo; mode: Mode; today: string; listName?: string; places: { id: string; label: string }[]; onMove: (t: Todo, to: string) => void; onToggle: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id });
  const at = mode === "board" ? boardColumn(t, today) : quadrant(t, today);
  const style: CSSProperties = {
    border: "var(--nb-border)",
    background: t.completed ? "hsl(var(--muted))" : "hsl(var(--card))",
    padding: "8px 10px",
    boxShadow: isDragging ? "4px 4px 0 #000" : "var(--nb-shadow-sm)",
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
    touchAction: "none",
  };
  const due = t.dueDate ? (t.dueDate === today ? "Today" : t.dueDate < today ? "Overdue" : new Date(`${t.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : null;
  return (
    <li ref={setNodeRef} style={style} data-testid="board-card" data-id={t.id}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={t.completed} onChange={() => onToggle(t.id)} aria-label={`${t.completed ? "Not done" : "Done"}: ${t.title}`} style={{ marginTop: 3 }} />
        <span {...listeners} {...attributes} aria-roledescription="draggable task" aria-label={`${t.title}. Drag to move, or use Move to.`} style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, cursor: "grab", textDecoration: t.completed ? "line-through" : "none", overflowWrap: "anywhere" }}>
          {t.title}
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingLeft: 22, fontSize: 10, fontWeight: 800 }}>
        {t.priority && PRIORITY[t.priority] && <span style={{ background: PRIORITY[t.priority].bg, color: PRIORITY[t.priority].fg, padding: "0 4px" }}>{PRIORITY[t.priority].label}</span>}
        {due && <span style={{ color: due === "Overdue" ? "var(--danger-text)" : "hsl(var(--muted-foreground))" }}>📅 {due}</span>}
        {listName && <span style={{ border: "1px solid var(--nb-section-border)", padding: "0 4px", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{listName}</span>}
        <select
          value={at}
          onChange={(e) => onMove(t, e.target.value)}
          aria-label={`Move ${t.title} to`}
          style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, fontFamily: "inherit", border: "1px solid var(--nb-section-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", padding: "0 2px" }}
        >
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === at ? `In ${p.label}` : `Move to ${p.label}`}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

function Zone({ id, label, hint, count, color, children }: { id: string; label: string; hint: string; count: number; color?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} data-testid={`board-zone-${id}`} aria-label={`${label}, ${count} task${count === 1 ? "" : "s"}`} style={{ border: `2px ${isOver ? "solid" : "dashed"} ${isOver ? "#000" : "var(--nb-section-border)"}`, background: isOver ? "hsl(var(--muted))" : "transparent", padding: 8, minHeight: 120, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ borderLeft: color ? `4px solid ${color}` : undefined, paddingLeft: color ? 6 : 0 }}>
        <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label} <span style={{ fontWeight: 700, opacity: 0.7 }}>{count}</span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{hint}</div>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>{children}</ul>
    </section>
  );
}

export function BoardView({ mode, todos, today, listNames, onPatch, onToggle }: { mode: Mode; todos: Todo[]; today: string; listNames: Map<string, string>; onPatch: (id: string, patch: Partial<Todo>) => void; onToggle: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const zones = mode === "board" ? BOARD_COLUMNS : QUADRANTS;
  // The board shows recent done tasks only; the matrix shows open tasks.
  const shown = mode === "board" ? todos.filter((t) => !t.completed || (t.completedAt && t.completedAt.slice(0, 10) >= new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))) : todos.filter((t) => !t.completed);
  const where = (t: Todo) => (mode === "board" ? boardColumn(t, today) : quadrant(t, today));

  const move = (t: Todo, to: string) => {
    if (mode === "board") {
      const col = to as BoardColumn;
      if (col === "done") {
        // The normal complete, so repeating tasks repeat.
        if (!t.completed) onToggle(t.id);
        return setStatus(`${t.title}: done.`);
      }
      // Out of Done: not done again, and moved, in one update.
      const open = t.completed ? { ...t, completed: false } : t;
      const patch = { ...(t.completed ? { completed: false, completedAt: undefined } : {}), ...(moveToColumn(open, col, today) ?? {}) };
      if (!Object.keys(patch).length) return;
      onPatch(t.id, patch);
      return setStatus(t.completed ? `${t.title}: not done, in ${BOARD_COLUMNS.find((c) => c.id === col)?.label}.` : describeMove(t, patch, today));
    }
    const patch = moveToQuadrant(t, to as Quadrant, today);
    if (!patch) return;
    onPatch(t.id, patch);
    setStatus(describeMove(t, patch, today));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const t = shown.find((x) => x.id === e.active.id);
    if (t && e.over && e.over.id !== where(t)) move(t, String(e.over.id));
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div data-testid={`todo-${mode}`} style={{ display: "grid", gridTemplateColumns: mode === "board" ? "repeat(auto-fit, minmax(200px, 1fr))" : "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {zones.map((z) => {
          const items = shown.filter((t) => where(t) === z.id);
          return (
            <Zone key={z.id} id={z.id} label={z.label} hint={z.hint} count={items.length} color={mode === "matrix" ? QUAD_COLOR[z.id as Quadrant] : undefined}>
              {items.map((t) => (
                <Card key={t.id} t={t} mode={mode} today={today} listName={t.listId ? listNames.get(t.listId) : undefined} places={zones} onMove={move} onToggle={onToggle} />
              ))}
            </Zone>
          );
        })}
      </div>
      <div role="status" aria-live="polite" style={{ fontSize: 12, fontWeight: 700, minHeight: 16, marginTop: 8 }}>
        {status}
      </div>
    </DndContext>
  );
}
