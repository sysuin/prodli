#!/usr/bin/env node
/**
 * Builds the ProdLi Chrome extension and packages it into prodli-extension.zip.
 *
 * Usage (from artifacts/prodli/):
 *   node scripts/build-extension.mjs
 * Or via npm script:
 *   pnpm build:extension
 */

import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, createWriteStream, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const workspaceRoot = resolve(root, "..", "..");

const distDir = resolve(root, "dist-extension");
const zipPath = resolve(workspaceRoot, "prodli-extension.zip");

console.log("==> Building extension with Vite...");
execSync("pnpm vite build --config vite.extension.config.ts", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

console.log("\n==> Copying manifest.json...");
cpSync(resolve(root, "extension", "manifest.json"), resolve(distDir, "manifest.json"));

console.log("==> Renaming index.extension.html → index.html...");
renameSync(resolve(distDir, "index.extension.html"), resolve(distDir, "index.html"));

console.log("==> Copying icons/...");
const iconsDir = resolve(distDir, "icons");
mkdirSync(iconsDir, { recursive: true });
cpSync(resolve(root, "extension", "icons"), iconsDir, { recursive: true });

console.log("==> Removing website-only files from the extension...");
// public/ is shared with the web preview; these files are only used by the website.
for (const f of ["store-assets", "promo.html", "opengraph.jpg", "favicon.svg", "icon-16.png", "icon-48.png", "icon-128.png"]) {
  rmSync(resolve(distDir, f), { recursive: true, force: true });
}

console.log("==> Verifying manifest...");
const manifest = JSON.parse(readFileSync(resolve(distDir, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (!manifest.chrome_url_overrides?.newtab) throw new Error("Missing chrome_url_overrides.newtab");
console.log(`    name: ${manifest.name}, version: ${manifest.version}, manifest_version: ${manifest.manifest_version}`);

console.log("\n==> Packaging into prodli-extension.zip...");
if (existsSync(zipPath)) rmSync(zipPath);

await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    console.log(`    Archived ${archive.pointer()} bytes`);
    resolvePromise();
  });
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(distDir, false);
  archive.finalize();
});

console.log(`\n✓ Done! Extension zip: ${zipPath}`);
console.log("  Upload this file at: https://chrome.google.com/webstore/devconsole");
