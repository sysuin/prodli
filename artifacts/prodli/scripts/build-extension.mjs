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
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, createWriteStream, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const workspaceRoot = resolve(root, "..", "..");

// PRODLI_OUT_DIR: build somewhere other than dist-extension (tests use
// dist-extension-test so they never touch the copy loaded in your Chrome).
const outName = process.env.PRODLI_OUT_DIR?.trim() || "dist-extension";
const isMainBuild = outName === "dist-extension";
const finalDir = resolve(root, outName);
// Build into a staging folder and swap it in at the end. Chrome may have the
// final folder loaded unpacked; if it reloads while the folder is half-written
// it can drop the extension *and its data*, so the folder is never half-written.
const distDir = `${finalDir}.staging`;
const zipPath = resolve(workspaceRoot, "prodli-extension.zip");
rmSync(distDir, { recursive: true, force: true });

console.log(`==> Building extension with Vite (${outName})...`);
execSync(`pnpm vite build --config vite.extension.config.ts --outDir "${distDir}" --emptyOutDir`, {
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

console.log("==> Applying build settings to manifest...");
{
  // Optional, from environment variables (never committed):
  //   PRODLI_GOOGLE_CLIENT_ID  — OAuth client ID ("Chrome extension" type) for Google sign-in
  //   PRODLI_EXTENSION_KEY     — the Web Store item's public key, so unpacked builds get the same ID
  const manifestPath = resolve(distDir, "manifest.json");
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  const clientId = process.env.PRODLI_GOOGLE_CLIENT_ID?.trim();
  if (clientId) {
    m.oauth2 = { client_id: clientId, scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.appdata"] };
    console.log("    Google sign-in: enabled");
  } else {
    console.log("    Google sign-in: not configured (set PRODLI_GOOGLE_CLIENT_ID to enable)");
  }
  const key = process.env.PRODLI_EXTENSION_KEY?.trim();
  if (key) m.key = key;
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}

console.log("==> Removing website-only files from the extension...");
// public/ is shared with the web preview; these files are only used by the website.
for (const f of ["store-assets", "promo.html", "opengraph.jpg", "favicon.svg", "icon-16.png", "icon-48.png", "icon-128.png", "icon-192.png", "icon-512.png"]) {
  rmSync(resolve(distDir, f), { recursive: true, force: true });
}

console.log("==> Verifying manifest...");
const manifest = JSON.parse(readFileSync(resolve(distDir, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (!manifest.chrome_url_overrides?.newtab) throw new Error("Missing chrome_url_overrides.newtab");
console.log(`    name: ${manifest.name}, version: ${manifest.version}, manifest_version: ${manifest.manifest_version}`);

console.log(`==> Swapping the new build into ${outName}/...`);
rmSync(finalDir, { recursive: true, force: true });
renameSync(distDir, finalDir);

if (!isMainBuild) {
  console.log(`\n✓ Done! Test build: ${finalDir} (no zip)`);
  process.exit(0);
}

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
  // The Web Store rejects uploads whose manifest has a "key", so the zip gets
  // the manifest without it (the unpacked dist-extension folder keeps it).
  archive.directory(finalDir, false, (entry) => (entry.name === "manifest.json" ? false : entry));
  const { key: _unpackedOnly, ...storeManifest } = manifest;
  archive.append(JSON.stringify(storeManifest, null, 2), { name: "manifest.json" });
  archive.finalize();
});

console.log(`\n✓ Done! Extension zip: ${zipPath}`);
console.log("  Upload this file at: https://chrome.google.com/webstore/devconsole");
