// The To-do side panel: views (All, Inbox, Today), lists, labels and saved
// filters, each with its number of open tasks. On narrow screens it becomes a
// scrolling row above the list (index.css: .todo-nav).

import type { ReactNode } from "react";
import { isFilter, isList, labelsInUse, matchesQuery, describeQuery } from "../../lib/taskLists";
import type { ListItem, TaskQuery, Todo } from "../../types";

export type Selection = { kind: "all" } | { kind: "inbox" } | { kind: "today" } | { kind: "list"; id: string } | { kind: "label"; name: string } | { kind: "filter"; id: string };

export const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

/** The query a selection stands for (saved filters bring their own). */
export function selectionQuery(sel: Selection, lists: ListItem[]): TaskQuery {
  switch (sel.kind) {
    case "all":
      return {};
    case "inbox":
      return { list: "inbox" };
    case "today":
      return { due: "today" };
    case "list":
      return { list: sel.id };
    case "label":
      return { label: sel.name };
    case "filter": {
      const f = lists.find((l) => l.id === sel.id);
      return f && isFilter(f) ? f.query : {};
    }
  }
}

export function selectionTitle(sel: Selection, lists: ListItem[]): string {
  switch (sel.kind) {
    case "all":
      return "All tasks";
    case "inbox":
      return "Inbox";
    case "today":
      return "Today";
    case "list": {
      const l = lists.find((x) => x.id === sel.id);
      return l && isList(l) ? `${l.emoji ?? "📁"} ${l.name}` : "List";
    }
    case "label":
      return `@${sel.name}`;
    case "filter": {
      const f = lists.find((x) => x.id === sel.id);
      return f ? `☆ ${f.name}` : "Filter";
    }
  }
}

function Item({ active, onClick, children, count, testId, menu }: { active: boolean; onClick: () => void; children: ReactNode; count?: number; testId?: string; menu?: ReactNode }) {
  return (
    <div className="todo-nav-item" style={{ display: "flex", alignItems: "stretch" }}>
      <button
        data-testid={testId}
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          textAlign: "left",
          border: "none",
          background: active ? "hsl(var(--foreground))" : "transparent",
          color: active ? "hsl(var(--background))" : "hsl(var(--foreground))",
          padding: "6px 10px",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: active ? 800 : 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
        {count !== undefined && count > 0 && <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>{count}</span>}
      </button>
      {menu}
    </div>
  );
}

const heading: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", padding: "12px 10px 4px" };
const smallBtn: React.CSSProperties = { border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer", fontWeight: 900, fontSize: 14, padding: "0 6px", fontFamily: "inherit" };

export function TodoNav({
  todos,
  lists,
  selection,
  onSelect,
  onAddList,
  onListMenu,
  onDeleteFilter,
}: {
  todos: Todo[];
  lists: ListItem[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAddList: () => void;
  onListMenu: (id: string) => void;
  onDeleteFilter: (id: string) => void;
}) {
  const open = todos.filter((t) => !t.completed);
  const count = (q: TaskQuery) => open.filter((t) => matchesQuery(t, q)).length;
  const taskLists = lists.filter(isList);
  const filters = lists.filter(isFilter);
  const labels = labelsInUse(todos);
  const is = (s: Selection) => sameSelection(s, selection);
  return (
    <nav aria-label="Task lists" className="todo-nav" style={{ width: 210, flexShrink: 0, borderRight: "var(--nb-border)", background: "hsl(var(--muted))", overflowY: "auto", paddingBottom: 12 }}>
      <div className="todo-nav-group" style={{ paddingTop: 8 }}>
        <Item testId="nav-all" active={is({ kind: "all" })} onClick={() => onSelect({ kind: "all" })} count={open.length}>☰ All tasks</Item>
        <Item testId="nav-inbox" active={is({ kind: "inbox" })} onClick={() => onSelect({ kind: "inbox" })} count={count({ list: "inbox" })}>📥 Inbox</Item>
        <Item testId="nav-today" active={is({ kind: "today" })} onClick={() => onSelect({ kind: "today" })} count={count({ due: "today" })}>☀️ Today</Item>
      </div>
      <div className="todo-nav-group">
        <div style={heading}>
          Lists
          <button onClick={onAddList} aria-label="New list" title="New list" style={smallBtn}>+</button>
        </div>
        {taskLists.length === 0 && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", padding: "2px 10px" }}>Add one with + or type #Name</div>}
        {taskLists.map((l) => (
          <Item
            key={l.id}
            testId={`nav-list-${l.name}`}
            active={is({ kind: "list", id: l.id })}
            onClick={() => onSelect({ kind: "list", id: l.id })}
            count={count({ list: l.id })}
            menu={<button onClick={() => onListMenu(l.id)} aria-label={`Rename or delete list ${l.name}`} title="Rename or delete" style={smallBtn}>⋯</button>}
          >
            {l.emoji ?? "📁"} {l.name}
          </Item>
        ))}
      </div>
      {labels.length > 0 && (
        <div className="todo-nav-group">
          <div style={heading}>Labels</div>
          {labels.map((l) => (
            <Item key={l.name} testId={`nav-label-${l.name}`} active={is({ kind: "label", name: l.name })} onClick={() => onSelect({ kind: "label", name: l.name })} count={l.open}>
              @{l.name}
            </Item>
          ))}
        </div>
      )}
      {filters.length > 0 && (
        <div className="todo-nav-group">
          <div style={heading}>Saved filters</div>
          {filters.map((f) => (
            <Item
              key={f.id}
              testId={`nav-filter-${f.name}`}
              active={is({ kind: "filter", id: f.id })}
              onClick={() => onSelect({ kind: "filter", id: f.id })}
              count={count(f.query)}
              menu={<button onClick={() => onDeleteFilter(f.id)} aria-label={`Delete filter ${f.name}`} title={`${describeQuery(f.query, lists)} — delete`} style={smallBtn}>×</button>}
            >
              ☆ {f.name}
            </Item>
          ))}
        </div>
      )}
    </nav>
  );
}
