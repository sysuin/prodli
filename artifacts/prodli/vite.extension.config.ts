import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-extension"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.extension.html"),
        background: path.resolve(import.meta.dirname, "src/background.ts"),
        offscreen: path.resolve(import.meta.dirname, "offscreen.html"),
        // Screenshot to ProdLi: crop, mark up and save (opened in its own small window).
        screenshot: path.resolve(import.meta.dirname, "screenshot.html"),
        // Injected into meet.google.com with chrome.scripting — must stay
        // self-contained (type-only imports), since content scripts can't use ES imports.
        "meet-captions": path.resolve(import.meta.dirname, "src/recorder/meetCaptions.ts"),
        // Voice dictation's pill, injected into the page the user is typing in (same rule).
        "dictate-pill": path.resolve(import.meta.dirname, "src/dictation/pill.ts"),
        // The snippet picker, injected into the page the user is typing in (same rule).
        "snippet-picker": path.resolve(import.meta.dirname, "src/snippets/picker.ts"),
        // The writing check, injected into the page the user is typing in (same rule).
        "writing-check": path.resolve(import.meta.dirname, "src/writing/checker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : chunk.name === "meet-captions"
              ? "meet-captions.js"
              : chunk.name === "dictate-pill"
                ? "dictate-pill.js"
                : chunk.name === "snippet-picker"
                  ? "snippet-picker.js"
                  : chunk.name === "writing-check"
                    ? "writing-check.js"
                    : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
