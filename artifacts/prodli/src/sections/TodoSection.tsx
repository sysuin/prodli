import { useState, useEffect, useRef } from "react";
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
import { generateId } from "../lib/utils";
import type { Todo } from "../types";

type Priority = "high" | "medium" | "low" | "none";
type Filter = "all" | "active" | "completed" | "high" | "medium" | "low";

const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#ff4444",
  medium: "#FF9800",
  low: "#4CAF50",
  none: "#aaa",
};
const PRIORITY_LABELS: Record<Priority, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  none: "—",
};

function SortableTodo({ todo, onToggle, onDelete, onEdit, onAddSubtask, onToggleSubtask, onDeleteSubtask }: {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, title: string) => void;
  onAddSubtask: (parentId: string) => void;
  onToggleSubtask: (parentId: string, subId: string) => void;
  onDeleteSubtask: (parentId: string, subId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
          {/* Drag handle */}
          <span {...attributes} {...listeners} style={{ cursor: "grab", fontSize: 16, color: "hsl(var(--muted-foreground))", userSelect: "none", flexShrink: 0 }}>⠿</span>
          {/* Checkbox */}
          <button
            onClick={handleToggle}
            style={{
              width: 22,
              height: 22,
              border: "var(--nb-border)",
              background: todo.completed ? "hsl(var(--foreground))" : "hsl(var(--card))",
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
            color: todo.priority ? "white" : "hsl(var(--muted-foreground))",
            fontSize: 9,
            fontWeight: 900,
            padding: "1px 5px",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}>{todo.priority ? PRIORITY_LABELS[todo.priority] : PRIORITY_LABELS.none}</span>
          {/* Due date */}
          {todo.dueDate && (
            <span style={{ fontSize: 10, fontWeight: 700, color: new Date(todo.dueDate) < new Date() && !todo.completed ? "#ff4444" : "hsl(var(--muted-foreground))", flexShrink: 0 }}>
              📅 {new Date(todo.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {/* Expand subtasks */}
          {todo.subtasks && todo.subtasks.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>
              {expanded ? "▲" : "▼"}
            </button>
          )}
          {/* Add subtask */}
          <button onClick={() => onAddSubtask(todo.id)} style={{ border: "var(--nb-border)", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", width: 20, height: 20, cursor: "pointer", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title="Add subtask">+</button>
          {/* Delete */}
          <button onClick={() => onDelete(todo.id)} style={{ border: "1px solid #ff4444", background: "#ff4444", color: "white", width: 20, height: 20, cursor: "pointer", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
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
                <button onClick={() => onDeleteSubtask(todo.id, sub.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ff4444", fontSize: 14, fontWeight: 900 }}>×</button>
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

  // Synced across ProdLi tabs: edits in one tab never overwrite another's.
  const { items: todos, setItems: save, loaded } = useSyncedList<Todo>("todos");

  const addTodo = () => {
    if (!input.trim()) return;
    const todo: Todo = {
      id: generateId(),
      title: input.trim(),
      completed: false,
      priority: priority === "none" ? undefined : priority,
      dueDate: dueDate || undefined,
      subtasks: [],
      createdAt: new Date().toISOString(),
    };
    save([todo, ...todos]);
    setInput("");
    setDueDate("");
    setPriority("none");
  };

  const toggle = (id: string) => save(todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  const del = (id: string) => save(todos.filter(t => t.id !== id));
  const edit = (id: string, title: string) => save(todos.map(t => t.id === id ? { ...t, title } : t));
  const clearCompleted = () => save(todos.filter(t => !t.completed));

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
    if (filter !== "all") return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = todos.findIndex(t => t.id === active.id);
      const newIndex = todos.findIndex(t => t.id === over.id);
      save(arrayMove(todos, oldIndex, newIndex));
    }
  };

  const filtered = todos.filter(t => {
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

  if (!loaded) return <div style={{ padding: 24, fontWeight: 700 }}>Loading...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "16px 24px", background: "hsl(var(--muted))" }}>
        <div style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.02em" }}>
          To-Do List
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, background: "hsl(var(--foreground))", color: "#FFD700", padding: "2px 8px", verticalAlign: "middle" }}>
            {completedCount}/{todos.length} done
          </span>
        </div>
      </div>

      {/* Input area */}
      <div style={{ borderBottom: "var(--nb-border)", padding: "12px 24px", background: "hsl(var(--card))", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
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
                color: priority !== "none" ? "white" : "hsl(var(--foreground))",
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
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            style={{ border: "var(--nb-border)", padding: "0 8px", height: "38px", boxSizing: "border-box" as const, fontFamily: "inherit", fontSize: 12, boxShadow: "var(--nb-shadow-sm)", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
          />
          <button
            onClick={addTodo}
            style={{ border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)", padding: "0 18px", height: "38px", boxSizing: "border-box" as const, background: "#FFD700", fontWeight: 800, cursor: "pointer", fontSize: 13, textTransform: "uppercase", fontFamily: "inherit", color: "#000" }}
          >Add</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ borderBottom: "var(--nb-border)", display: "flex", gap: 0, background: "hsl(var(--muted))", overflowX: "auto" }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              border: "none", borderRight: "var(--nb-border)", padding: "8px 16px",
              background: filter === f.key ? "hsl(var(--foreground))" : "transparent",
              color: filter === f.key ? "#FFD700" : "hsl(var(--foreground))",
              fontWeight: 800, cursor: "pointer", fontSize: 11, textTransform: "uppercase",
              letterSpacing: "0.06em", whiteSpace: "nowrap", fontFamily: "inherit",
            }}
          >{f.label}</button>
        ))}
        {completedCount > 0 && (
          <button
            onClick={clearCompleted}
            style={{ border: "none", borderLeft: "var(--nb-border)", padding: "8px 16px", marginLeft: "auto", background: "transparent", color: "#ff4444", fontWeight: 800, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "inherit" }}
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
            <SortableContext items={filtered.map(t => t.id)} strategy={verticalListSortingStrategy}>
              {filtered.map(todo => (
                <SortableTodo
                  key={todo.id}
                  todo={todo}
                  onToggle={toggle}
                  onDelete={del}
                  onEdit={edit}
                  onAddSubtask={addSubtask}
                  onToggleSubtask={toggleSubtask}
                  onDeleteSubtask={deleteSubtask}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
