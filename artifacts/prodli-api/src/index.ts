// Worker entry point. Keep this file to the default export and Durable Object
// classes: every named export of the entry module is treated as a Worker
// entrypoint, so constants and helpers live in ./app.ts.

import { app, type Env } from "./app";
import { runBackups } from "./backup";

export { UserStore } from "./userStore";

export default {
  fetch: app.fetch,
  /** Cron (wrangler.jsonc "triggers"): nightly backups to R2. */
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBackups(env, Date.now()));
  },
} satisfies ExportedHandler<Env>;
