#!/usr/bin/env node
// Builds the ProdLi web app (same React code as the extension, web storage)
// for app.prodli.com into artifacts/prodli-api/app-dist, which the prodli-api
// Worker serves next to /api.

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/prodli-api/app-dist");

execSync(`pnpm exec vite build --config vite.config.ts --outDir "${outDir}" --emptyOutDir`, {
  cwd: path.join(root, "artifacts/prodli"),
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", BASE_PATH: "/", VITE_PRODLI_API: "same-origin" },
});
console.log(`\n✓ Web app ready in ${path.relative(root, outDir)}/`);
