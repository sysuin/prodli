// A real UserStore (src/userStore.ts) running on Node's built-in SQLite, plus a
// fake Durable Object namespace that gives each user name its own instance.

import { DatabaseSync } from "node:sqlite";
import type { Sql } from "../src/syncStore";
import { UserStore } from "../src/userStore";

(globalThis as Record<string, unknown>).WebSocketRequestResponsePair ??= class {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
};

export function nodeSql(db = new DatabaseSync(":memory:")): Sql & { db: DatabaseSync } {
  return {
    db,
    exec(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...(bindings as never[])) as Record<string, never>[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
          return rows[0];
        },
      };
    },
  } as Sql & { db: DatabaseSync };
}

function fakeState() {
  let sql = nodeSql();
  const state = {
    get storage() {
      return {
        sql,
        deleteAll: async () => {
          sql.db.close();
          sql = nodeSql();
        },
      };
    },
    setWebSocketAutoResponse() {},
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket() {},
  };
  return state as unknown as DurableObjectState;
}

export function fakeUserStoreNamespace() {
  const stores = new Map<string, UserStore>();
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      let s = stores.get(id);
      if (!s) stores.set(id, (s = new UserStore(fakeState(), {} as never)));
      return s;
    },
    stores,
  };
  return ns as unknown as DurableObjectNamespace<UserStore> & { stores: Map<string, UserStore> };
}
