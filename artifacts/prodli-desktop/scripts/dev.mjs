#!/usr/bin/env node
// Development: build (development mode: dev tools, View → Reload) and start the app.
//   pnpm --filter @workspace/prodli-desktop dev
//   PRODLI_API=http://localhost:8787 pnpm --filter @workspace/prodli-desktop dev   (local server)
// After changing the pages, run it again (or View → Reload after `SKIP_MAIN=1` rebuilds).
// Your development data lives in a separate folder (ProdLi Dev), not your real ProdLi data.

import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [path.join(pkg, "scripts/build.mjs")], { stdio: "inherit", env: { ...process.env, PRODLI_DEV: "1" } });

const base = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.platform === "win32" ? (process.env.APPDATA ?? os.homedir()) : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
const electron = path.join(pkg, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const child = spawn(electron, ["."], {
  cwd: pkg,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, PRODLI_USER_DATA: process.env.PRODLI_USER_DATA ?? path.join(base, "ProdLi Dev") },
});
child.on("exit", (code) => process.exit(code ?? 0));
