import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run in Node; the real UserStore runs on a stand-in for the Workers runtime.
    alias: { "cloudflare:workers": path.join(here, "test/stubs/cloudflare-workers.ts") },
  },
});
