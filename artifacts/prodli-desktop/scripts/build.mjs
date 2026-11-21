#!/usr/bin/env node
// Builds the desktop app into dist/:
//   dist/renderer/  ProdLi's pages (artifacts/prodli, vite.desktop.config.ts)
//   dist/main/      the main process (esbuild, one CommonJS file)
//   dist/preload/   the preload bridge (esbuild, one CommonJS file)
//
// Environment:
//   PRODLI_API   account server (default https://app.prodli.com; http://localhost:8787 for a local one)
//   PRODLI_DEV=1 development build (dev tools, Reload in the View menu)
//   PRODLI_UPDATE_URL  where updates are published (latest.yml etc.); unset = no automatic updates
//   SKIP_RENDERER=1  rebuild only main + preload (quick, when only they changed)

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const api = (process.env.PRODLI_API ?? "https://app.prodli.com").replace(/\/+$/, "");
const dev = process.env.PRODLI_DEV === "1";

if (!process.env.SKIP_RENDERER) {
  console.log(`==> Pages (server: ${api})`);
  execSync(`pnpm exec vite build --config vite.desktop.config.ts --logLevel warn`, {
    cwd: path.resolve(pkg, "../prodli"),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", PRODLI_API: api, PRODLI_OUT_DIR: path.join(pkg, "dist/renderer") },
  });
}

console.log("==> Main process + preload");
rmSync(path.join(pkg, "dist/main"), { recursive: true, force: true });
rmSync(path.join(pkg, "dist/preload"), { recursive: true, force: true });
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "warning",
  define: { __PRODLI_API__: JSON.stringify(api), __PRODLI_DEV__: JSON.stringify(dev), __PRODLI_UPDATE_URL__: JSON.stringify((process.env.PRODLI_UPDATE_URL ?? "").replace(/\/+$/, "")) },
};
await Promise.all([
  build({ ...common, entryPoints: [path.join(pkg, "src/main/index.ts")], outfile: path.join(pkg, "dist/main/index.cjs") }),
  build({ ...common, entryPoints: [path.join(pkg, "src/preload/index.ts")], outfile: path.join(pkg, "dist/preload/index.cjs") }),
]);
console.log(`✓ Built into ${path.relative(process.cwd(), path.join(pkg, "dist")) || "dist"}/${dev ? " (development)" : ""}`);
