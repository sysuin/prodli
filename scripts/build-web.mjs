#!/usr/bin/env node
// Builds everything served at prodli.com into ./site-dist:
//   /            marketing site      (artifacts/prodli-site)
//   /privacy     privacy policy      (same app)
//   /extension/  live web preview    (artifacts/prodli, web build)
//
// site-dist is a plain static folder: it can be hosted for free on
// Cloudflare Pages (recommended), GitHub Pages or Netlify.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "site-dist");
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", ...env } });

console.log("==> Building marketing site");
run("pnpm --filter @workspace/prodli-site run build", { BASE_PATH: "/" });

console.log("\n==> Building web preview (/extension/)");
run("pnpm --filter @workspace/prodli run build", { BASE_PATH: "/extension/" });

console.log("\n==> Assembling site-dist/");
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "artifacts/prodli-site/dist/public"), out, { recursive: true });
cpSync(path.join(root, "artifacts/prodli/dist/public"), path.join(out, "extension"), { recursive: true });

// Cloudflare Pages / Netlify routing rules.
writeFileSync(
  path.join(out, "_redirects"),
  [
    "/extension   /extension/   301",
    "/extension/* /extension/index.html 200",
    "/*           /index.html   200",
    "",
  ].join("\n"),
);

// Security + caching headers (Cloudflare Pages / Netlify).
writeFileSync(
  path.join(out, "_headers"),
  [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/extension/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"),
);

console.log(`\n✓ Website ready in ${path.relative(root, out)}/`);
