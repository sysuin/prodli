// Saving an import, and Undo. Writes straight to storage (like quick add), so
// open ProdLi tabs and sync pick the changes up. Undo removes exactly what
// the import added — its to-dos and the lists it created — and records the
// deletions so sync doesn't bring them back from another device.

import { storageGet, storageSet } from "../storage";
import { recordDeletions } from "../tombstones";
import { buildImport, type ParsedImport } from "./core";
import type { ListItem, Todo } from "../../types";

export interface ImportUndo {
  todoIds: string[];
  listIds: string[];
}

export interface ImportOutcome {
  added: number;
  skipped: number;
  newLists: number;
  undo: ImportUndo;
}

export async function applyImport(parsed: ParsedImport, includeDone: boolean, now = new Date()): Promise<ImportOutcome> {
  const [todos, lists] = await Promise.all([storageGet<Todo[]>("todos", []), storageGet<ListItem[]>("lists", [])]);
  const built = buildImport(parsed, { includeDone, existingTodos: todos, existingLists: lists, now });
  if (built.newLists.length) await storageSet("lists", [...lists, ...built.newLists]);
  // To-dos are stored newest first; the import goes on top, in the file's order.
  if (built.todos.length) await storageSet("todos", [...built.todos, ...todos]);
  return {
    added: built.todos.length,
    skipped: built.skipped,
    newLists: built.newLists.length,
    undo: { todoIds: built.todos.map((t) => t.id), listIds: built.newLists.map((l) => l.id) },
  };
}

export async function undoImport(u: ImportUndo): Promise<void> {
  const todoIds = new Set(u.todoIds);
  const listIds = new Set(u.listIds);
  const todos = await storageGet<Todo[]>("todos", []);
  // Tasks moved into an imported list since then go back to the Inbox rather than pointing at nothing.
  await storageSet(
    "todos",
    todos.filter((t) => !todoIds.has(t.id)).map((t) => (t.listId && listIds.has(t.listId) ? { ...t, listId: undefined, updatedAt: new Date().toISOString() } : t)),
  );
  if (listIds.size) {
    const lists = await storageGet<ListItem[]>("lists", []);
    await storageSet("lists", lists.filter((l) => !listIds.has(l.id)));
  }
  await recordDeletions("todos", u.todoIds);
  await recordDeletions("lists", u.listIds);
}
