#!/usr/bin/env node
// Builds everything served at prodli.com into ./site-dist:
//   /            marketing site      (artifacts/prodli-site)
//   /privacy     privacy policy      (same app)
//   /terms       terms               (same app)
// The app itself lives at app.prodli.com; prodli.com/extension (an old web
// preview) redirects there (artifacts/prodli-site/worker/index.js).
//
// site-dist is a plain static folder, served on Cloudflare Workers by
// artifacts/prodli-site (see its wrangler.jsonc).

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "site-dist");
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", ...env } });

console.log("==> Building marketing site");
run("pnpm --filter @workspace/prodli-site run build", { BASE_PATH: "/" });

console.log("\n==> Assembling site-dist/");
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "artifacts/prodli-site/dist/public"), out, { recursive: true });

// Routing (www → apex, app routes) and security/caching headers are handled by
// the Worker in artifacts/prodli-site/worker/index.js, which serves this folder.

console.log(`\n✓ Website ready in ${path.relative(root, out)}/`);
