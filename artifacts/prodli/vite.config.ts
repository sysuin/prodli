import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Web preview of the ProdLi new tab (served at prodli.com/extension/). The Chrome extension itself builds with vite.extension.config.ts.
// PORT and BASE_PATH are optional: `pnpm dev` works with the defaults below.
const port = Number(process.env.PORT ?? 5173);
const basePath = process.env.BASE_PATH ?? "/extension/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    fs: { strict: true },
  },
  preview: {
    port,
    host: "0.0.0.0",
  },
});
