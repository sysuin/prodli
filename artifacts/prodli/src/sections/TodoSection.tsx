import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { storageSet } from "../lib/storage";
import { useSyncedList } from "../lib/syncedList";
import { generateId, getDayKey } from "../lib/utils";
import { parseTask } from "../lib/taskParse";
import type { Todo } from "../types";

type Priority = "high" | "medium" | "low" | "none";
type Filter = "all" | "active" | "completed" | "high" | "medium" | "low";

// Badge colours with WCAG AA contrast against their text colour (PRIORITY_TEXT).
const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#C62828",
  medium: "#FF9800",
  low: "#2E7D32",
  none: "#aaa",
};
const PRIORITY_TEXT: Record<Priority, string> = { high: "#fff", medium: "#000", low: "#fff", none: "#000" };
const PRIORITY_LABELS: Record<Priority, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  none: "—",
};

/** "Today", "Tomorrow", "Yesterday", "Fri", or "Nov 20". */
function dueLabel(due: string, today: string): string {
  const days = Math.round((new Date(`${due}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type View = "date" | "order";
const VIEW_KEY = "prodli_todo_view";
type Group = { id: string; label: string; items: Todo[]; tone?: "warn" };

/** Pure: open tasks grouped by when they're due (planned-for-today counts as today). */
export function groupByDate(todos: Todo[], today: string): Group[] {
  const add = (n: number) => getDayKey(new Date(new Date(`${today}T12:00:00`).getTime() + n * 86_400_000));
  const tomorrow = add(1);
  const weekEnd = add(7);
  const groups: Group[] = [
    { id: "overdue", label: "Overdue", items: [], tone: "warn" },
    { id: "today", label: "Today", items: [] },
    { id: "tomorrow", label: "Tomorrow", items: [] },
    { id: "week", label: "Next 7 days", items: [] },
    { id: "later", label: "Later", items: [] },
    { id: "none", label: "No date", items: [] },
  ];
  const rank = { high: 0, medium: 1, low: 2 } as const;
  for (const t of todos) {
    const due = t.dueDate;
    const planned = !!t.plannedFor && t.plannedFor <= today;
    const id = due && due < today ? "overdue" : planned || due === today ? "today" : due === tomorrow ? "tomorrow" : due && due <= weekEnd ? "week" : due ? "later" : "none";
    groups.find((x) => x.id === id)!.items.push(t);
  }
  for (const g of groups) g.items.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || (a.priority ? rank[a.priority] : 3) - (b.priority ? rank[b.priority] : 3));
  return groups.filter((g) => g.items.length);
}

function SortableTodo({ todo, onToggle, onDelete, onEdit, onAddSubtask, onToggleSubtask, onDeleteSubtask, onTogglePlan, draggable = true }: {
  todo: Todo;
  onTogglePlan: (id: string) => void;
  draggable?: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, title: string) => void;
  onAddSubtask: (parentId: string) => void;
  onToggleSubtask: (parentId: string, subId: string) => void;
  onDeleteSubtask: (parentId: string, subId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id, disabled: !draggable });
  const today = getDayKey();
  const planned = !!todo.plannedFor && todo.plannedFor <= today && !todo.completed;
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.title);
  const [justCompleted, setJustCompleted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (!todo.completed) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 600);
    }
    onToggle(todo.id);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityColor = todo.priority ? PRIORITY_COLORS[todo.priority] : PRIORITY_COLORS.none;

  return (
    <div ref={setNodeRef} style={style} className="slide-in">
      <div style={{
        border: "var(--nb-border)",
        boxShadow: "var(--nb-shadow-sm)",
        marginBottom: 8,
        background: todo.completed ? "hsl(var(--muted))" : "hsl(var(--card))",
        animation: justCompleted ? "todo-pop 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)" : undefined,
      }}>
        <div className="todo-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
          {/* Drag handle */}
          {draggable ? (
            <span {...attributes} {...listeners} style={{ cursor: "grab", fontSize: 16, color: "hsl(var(--muted-foreground))", userSelect: "none", flexShrink: 0 }}>⠿</span>
          ) : (
            <span style={{ width: 9, flexShrink: 0 }} aria-hidden />
          )}
          {/* Checkbox */}
          <button
            onClick={handleToggle}
            role="checkbox"
            aria-checked={todo.completed}
            aria-label={`${todo.completed ? "Mark not done" : "Mark done"}: ${todo.title}`}
            style={{
              width: 22,
              height: 22,
              border: "var(--nb-border)",
              background: todo.completed ? "#000" : "hsl(var(--card))",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {todo.completed && <span style={{ color: "#FFD700", fontWeight: 900, fontSize: 14 }}>✓</span>}
          </button>
          {/* Title */}
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onBlur={() => { onEdit(todo.id, editText); setEditing(false); }}
              onKeyDown={e => { if (e.key === "Enter") { onEdit(todo.id, editText); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
              style={{ flex: 1, border: "var(--nb-border)", padding: "2px 6px", fontSize: 14, fontWeight: 600, fontFamily: "inherit", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
            />
          ) : (
            <span
              onDoubleClick={() => { setEditing(true); setEditText(todo.title); }}
              className="todo-title"
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: todo.completed ? "line-through" : "none",
                opacity: todo.completed ? 0.5 : 1,
                cursor: "text",
              }}
            >{todo.title}</span>
          )}
          {/* Priority badge */}
          <span style={{
            border: `2px solid ${priorityColor}`,
            background: todo.priority ? priorityColor : "transparent",
            color: todo.priority ? PRIORITY_TEXT[todo.priority] : "hsl(var(--muted-foreground))",
            fontSize: 9,
            fontWeight: 900,
            padding: "1px 5px",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}>{todo.priority ? PRIORITY_LABELS[todo.priority] : PRIORITY_LABELS.none}</span>
          {/* Due date */}
          {todo.dueDate && (
            <span style={{ fontSize: 10, fontWeight: 700, color: todo.dueDate < today && !todo.completed ? "#C62828" : "hsl(var(--muted-foreground))", flexShrink: 0 }} title={todo.dueDate}>
              📅 {dueLabel(todo.dueDate, today)}
            </span>
          )}
          {!todo.completed && (
            <button
              onClick={() => onTogglePlan(todo.id)}
              aria-pressed={planned}
              aria-label={planned ? `Remove from today: ${todo.title}` : `Plan for today: ${todo.title}`}
              title={planned ? "Planned for today — click to remove" : "Plan for today"}
              style={{ border: planned ? "2px solid #F59E0B" : "1px dashed var(--nb-section-border)", background: planned ? "#F59E0B" : "transparent", width: 22, height: 20, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: planned ? 1 : 0.6 }}
            >☀️</button>
          )}
          {/* Expand subtasks */}
          {todo.subtasks && todo.subtasks.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
              {expanded ? "▲" : "▼"}
            </button>
          )}
          {/* Add subtask */}
          <button onClick={() => onAddSubtask(todo.id)} style={{ border: "var(--nb-border)", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", width: 20, height: 20, cursor: "pointer", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title="Add subtask" aria-label={`Add subtask to ${todo.title}`}>+</button>
          {/* Delete */}
          <button onClick={() => onDelete(todo.id)} aria-label={`Delete task: ${todo.title}`} title="Delete task" style={{ border: "1px solid #C62828", background: "#C62828", color: "white", width: 20, height: 20, cursor: "pointer", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
        </div>
        {/* Subtasks */}
        {expanded && todo.subtasks && todo.subtasks.length > 0 && (
          <div style={{ borderTop: "var(--nb-border)", background: "hsl(var(--muted))" }}>
            {todo.subtasks.map(sub => (
              <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 40px", borderBottom: "1px dashed var(--nb-section-border)" }}>
                <button
                  onClick={() => onToggleSubtask(todo.id, sub.id)}
                  style={{ width: 16, height: 16, border: "var(--nb-border)", background: sub.completed ? "hsl(var(--foreground))" : "hsl(var(--card))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {sub.completed && <span style={{ color: "#FFD700", fontSize: 10, fontWeight: 900 }}>✓</span>}
                </button>
                <span style={{ flex: 1, fontSize: 12, textDecoration: sub.completed ? "line-through" : "none", opacity: sub.completed ? 0.5 : 1 }}>{sub.title}</span>
                <button onClick={() => onDeleteSubtask(todo.id, sub.id)} aria-label={`Delete subtask: ${sub.title}`} style={{ border: "none", background: "none", cursor: "pointer", color: "#C62828", fontSize: 14, fontWeight: 900 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TodoSection() {
  const [filter, setFilter] = useState<Filter>("all");
  const [input, setInput] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [dueDate, setDueDate] = useState("");
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "order" ? "order" : "date";
    } catch {
      return "date";
    }
  });
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore
    }
  };
  const parsed = parseTask(input);

  // Synced across ProdLi tabs: edits in one tab never overwrite another's.
  const { items: todos, setItems: save, loaded } = useSyncedList<Todo>("todos");

  const addTodo = () => {
    if (!input.trim()) return;
    // Smart add: words like "tomorrow" or "!high" set the date and priority; the pickers win if used.
    const p = parseTask(input);
    const todo: Todo = {
      id: generateId(),
      title: p.title,
      completed: false,
      priority: priority === "none" ? p.priority : priority,
      dueDate: dueDate || p.dueDate,
      plannedFor: p.planToday ? getDayKey() : undefined,
      subtasks: [],
      createdAt: new Date().toISOString(),
    };
    save([todo, ...todos]);
    setInput("");
    setDueDate("");
    setPriority("none");
  };

  const toggle = (id: string) => save(todos.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: t.completed ? undefined : new Date().toISOString() } : t));
  const del = (id: string) => save(todos.filter(t => t.id !== id));
  const edit = (id: string, title: string) => save(todos.map(t => t.id === id ? { ...t, title } : t));
  const clearCompleted = () => save(todos.filter(t => !t.completed));
  const togglePlan = (id: string) => {
    const today = getDayKey();
    save(todos.map(t => t.id === id ? { ...t, plannedFor: t.plannedFor && t.plannedFor <= today ? undefined : today } : t));
  };

  const addSubtask = (parentId: string) => {
    const title = window.prompt("Subtask title:");
    if (!title) return;
    save(todos.map(t => t.id === parentId ? {
      ...t,
      subtasks: [...(t.subtasks ?? []), { id: generateId(), title, completed: false }]
    } : t));
  };

  const toggleSubtask = (parentId: string, subId: string) => {
    save(todos.map(t => t.id === parentId ? {
      ...t,
      subtasks: (t.subtasks ?? []).map(s => s.id === subId ? { ...s, completed: !s.completed } : s)
    } : t));
  };

  const deleteSubtask = (parentId: string, subId: string) => {
    save(todos.map(t => t.id === parentId ? {
      ...t,
      subtasks: (t.subtasks ?? []).filter(s => s.id !== subId)
    } : t));
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (filter !== "all" || view !== "order" || search) return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = todos.findIndex(t => t.id === active.id);
      const newIndex = todos.findIndex(t => t.id === over.id);
      save(arrayMove(todos, oldIndex, newIndex));
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = todos.filter(t => {
    if (q && !t.title.toLowerCase().includes(q) && !(t.subtasks ?? []).some(st => st.title.toLowerCase().includes(q))) return false;
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    if (filter === "high") return t.priority === "high";
    if (filter === "medium") return t.priority === "medium";
    if (filter === "low") return t.priority === "low";
    return true;
  });

  const completedCount = todos.filter(t => t.completed).length;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "completed", label: "Done" },
    { key: "high", label: "🔴 High" },
    { key: "medium", label: "🟡 Med" },
    { key: "low", label: "🟢 Low" },
  ];

  const row = (todo: Todo, draggable: boolean) => (
    <SortableTodo key={todo.id} todo={todo} onToggle={toggle} onDelete={del} onEdit={edit} onAddSubtask={addSubtask} onToggleSubtask={toggleSubtask} onDeleteSubtask={deleteSubtask} onTogglePlan={togglePlan} draggable={draggable} />
  );
  const heading = (label: string, count: number, tone?: "warn") => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "14px 0 6px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: tone === "warn" ? "#C62828" : "hsl(var(--muted-foreground))" }}>
      {label} <span style={{ fontWeight: 700 }}>{count}</span>
    </div>
  );
  const renderList = (): ReactNode => {
    const open = filtered.filter((t) => !t.completed);
    const done = filtered.filter((t) => t.completed);
    if (filter === "completed") return done.map((t) => row(t, false));
    const doneList = done.length > 0 ? (
      <div>
        <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} style={{ border: "none", background: "none", padding: 0, margin: "14px 0 6px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", cursor: "pointer", fontFamily: "inherit" }}>
          {showDone ? "▾" : "▸"} Done {done.length}
        </button>
        {showDone && done.map((t) => row(t, false))}
      </div>
    ) : null;
    if (view === "date") {
      return (
        <>
          {groupByDate(open, getDayKey()).map((g) => (
            <div key={g.id} data-testid={`todo-group-${g.id}`}>
              {heading(g.label, g.items.length, g.tone)}
              {g.items.map((t) => row(t, false))}
            </div>
          ))}
          {doneList}
        </>
      );
    }
    const canDrag = filter === "all" && !search;
    return (
      <SortableContext items={open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {open.map((t) => row(t, canDrag))}
        {doneList}
      </SortableContext>
    );
  };

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))" }}>
        <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
          To-Do List
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, background: "#000", color: "#FFD700", padding: "2px 8px", verticalAlign: "middle" }}>
            {completedCount}/{todos.length} done
          </span>
        </div>
      </div>

      {/* Input area */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "12px 24px", background: "hsl(var(--card))", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="todo-add-row" style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTodo()}
            placeholder="Add a new task..."
            style={{
              flex: 1, border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "8px 12px",
              fontFamily: "inherit", fontSize: 14, outline: "none", fontWeight: 600,
              background: "hsl(var(--card))", color: "hsl(var(--foreground))",
            }}
          />
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowPriorityPicker(!showPriorityPicker)}
              style={{
                border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "0 12px",
                height: "38px", boxSizing: "border-box" as const,
                background: priority !== "none" ? PRIORITY_COLORS[priority] : "hsl(var(--card))",
                color: priority !== "none" ? PRIORITY_TEXT[priority] : "hsl(var(--foreground))",
                fontWeight: 700, cursor: "pointer", fontSize: 12, textTransform: "uppercase",
                fontFamily: "inherit",
              }}
            >
              {priority === "none" ? "Priority" : PRIORITY_LABELS[priority]}
            </button>
            {showPriorityPicker && (
              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 10, border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", background: "hsl(var(--card))", minWidth: 100 }}>
                {(["high", "medium", "low", "none"] as Priority[]).map(p => (
                  <button key={p} onClick={() => { setPriority(p); setShowPriorityPicker(false); }}
                    style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", borderBottom: p !== "none" ? "1px solid var(--nb-section-border)" : "none", background: priority === p ? "hsl(var(--muted))" : "hsl(var(--card))", cursor: "pointer", fontWeight: 700, fontSize: 11, textAlign: "left", fontFamily: "inherit", color: "hsl(var(--foreground))" }}>
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="date" aria-label="Due date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            style={{ border: "var(--nb-border)", padding: "0 8px", height: "38px", boxSizing: "border-box" as const, fontFamily: "inherit", fontSize: 12, boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
          />
          <button
            onClick={addTodo}
            style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "0 18px", height: "38px", boxSizing: "border-box" as const, background: "#FFD700", fontWeight: 800, cursor: "pointer", fontSize: 13, textTransform: "uppercase", fontFamily: "inherit", color: "#000" }}
          >Add</button>
        </div>
        {input.trim() && parsed.matched.length > 0 && (
          <div aria-live="polite" data-testid="smart-add-preview" style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 700 }}>
            <span style={{ opacity: 0.8 }}>Will add “{parsed.title}”:</span>
            {parsed.matched.map((m) => (
              <span key={m} style={{ border: "var(--nb-border)", padding: "1px 6px", background: "hsl(var(--muted))" }}>{m}</span>
            ))}
          </div>
        )}
        {!input && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Tip: type “tomorrow”, “friday”, “Nov 20”, “!high” or “#today” — e.g. <em>Pay rent friday !high</em></div>
        )}
      </div>

      {/* Filters */}
      <div style={{ borderBottom: "var(--nb-border)", display: "flex", gap: 0, background: "hsl(var(--muted))", overflowX: "auto" }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              border: "none", borderRight: "var(--nb-border)", padding: "8px 16px",
              background: filter === f.key ? "#000" : "transparent",
              color: filter === f.key ? "#FFD700" : "hsl(var(--foreground))",
              fontWeight: 800, cursor: "pointer", fontSize: 11, textTransform: "uppercase",
              letterSpacing: "0.06em", whiteSpace: "nowrap", fontFamily: "inherit",
            }}
          >{f.label}</button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          style={{ border: "none", borderRight: "var(--nb-border)", padding: "6px 10px", fontFamily: "inherit", fontSize: 12, minWidth: 120, flex: "0 1 180px", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
        />
        <div role="radiogroup" aria-label="Arrange tasks" style={{ display: "flex", marginLeft: "auto" }}>
          <ViewButton current={view} value="date" label="📅 By date" onPick={changeView} />
          <ViewButton current={view} value="order" label="↕ My order" onPick={changeView} />
        </div>
        {completedCount > 0 && (
          <button
            onClick={clearCompleted}
            style={{ border: "none", borderLeft: "var(--nb-border)", padding: "8px 16px", background: "transparent", color: "#C62828", fontWeight: 800, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "inherit" }}
          >Clear Done</button>
        )}
      </div>

      {/* Todo list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "hsl(var(--muted-foreground))", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {todos.length === 0 ? "No tasks yet. Add one above!" : "No tasks match this filter."}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {renderList()}
          </DndContext>
        )}
      </div>
    </div>
  );
}

function ViewButton({ current, value, label, onPick }: { current: View; value: View; label: string; onPick: (v: View) => void }) {
  const on = current === value;
  return (
    <button role="radio" aria-checked={on} onClick={() => onPick(value)}
      style={{ border: "none", borderLeft: "var(--nb-border)", padding: "8px 12px", background: on ? "hsl(var(--foreground))" : "transparent", color: on ? "hsl(var(--background))" : "hsl(var(--foreground))", fontWeight: 800, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", fontFamily: "inherit" }}>
      {label}
    </button>
  );
}
