// Worker entry point. Keep this file to the default export (and, from phase 2,
// Durable Object classes): every named export of the entry module is treated as
// a Worker entrypoint, so constants and helpers live in ./app.ts.

import { app } from "./app";

export default app;
