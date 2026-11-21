import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The ProdLi desktop app's pages (artifacts/prodli-desktop): the same React app as
// the web app, served by the app itself from app://prodli/ (no web server, works
// offline). Built by artifacts/prodli-desktop/scripts/build.mjs.
//   PRODLI_API     account server (default https://app.prodli.com)
//   PRODLI_OUT_DIR where to write (default ../prodli-desktop/dist/renderer)
const api = process.env.PRODLI_API ?? "https://app.prodli.com";
const port = Number(process.env.PORT ?? 5180);

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_PRODLI_API": JSON.stringify(api),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  publicDir: false,
  build: {
    outDir: process.env.PRODLI_OUT_DIR ?? path.resolve(import.meta.dirname, "../prodli-desktop/dist/renderer"),
    emptyOutDir: true,
    target: "chrome130",
    rollupOptions: {
      input: { index: path.resolve(import.meta.dirname, "index.desktop.html") },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "127.0.0.1",
    fs: { strict: true },
  },
});
