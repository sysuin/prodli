// A hash of everything the phone's note editor bundle is built from, stamped into
// src/ui/noteEditorHtml.js by build.mjs. tests/unit/noteEditorBundle.test.ts
// recomputes it, so changing a note block without rebuilding fails the tests.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ["main.tsx", "build.mjs", "../../prodli/src/sections/editor/phoneExtensions.ts", "../../prodli/src/sections/editor/noteSchema.ts"];

export function editorSourceHash() {
  const h = createHash("sha256");
  for (const f of SOURCES) h.update(readFileSync(path.join(here, f), "utf8").replace(/\r\n/g, "\n"));
  const require = createRequire(path.join(here, "..", "package.json"));
  h.update(require("@10play/tentap-editor/package.json").version);
  return h.digest("hex").slice(0, 16);
}
