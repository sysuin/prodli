import { createRoot } from "react-dom/client";
import App from "./App";
import { QuickAddWindow } from "./components/QuickAdd";
import { DesktopHandoff } from "./components/DesktopHandoff";
import { captureFromUrl } from "./lib/capture";
import { desktop, isDesktop } from "./lib/desktop";
import { parseDesktopHandoff } from "./lib/desktopHandoff";
import "./index.css";

// Web app: app.prodli.com/?desktop=signin&… signs in the desktop app (lib/desktopHandoff.ts).
const handoff = !isDesktop() && import.meta.env.VITE_PRODLI_API === "same-origin" ? parseDesktopHandoff(location.search) : null;
// Desktop app: index.html#quick-add is the Quick add window (global shortcut, tray menu).
const quickAdd = isDesktop() && location.hash.startsWith("#quick-add");
// First paint in the right theme (App applies the saved theme again once loaded).
try {
  const saved = isDesktop() ? desktop()!.initialTheme : JSON.parse(localStorage.getItem("prodli_theme") ?? "null");
  if (saved === "dark" || ((handoff || quickAdd) && saved == null && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch {
  // ignore
}

createRoot(document.getElementById("root")!).render(
  handoff ? <DesktopHandoff handoff={handoff} /> : quickAdd ? <QuickAddWindow initial={captureFromUrl(location.hash.slice(location.hash.indexOf("?") + 1)) ?? undefined} /> : <App />,
);

// The web app (app.prodli.com) works offline: scripts/build-app.mjs generates /sw.js.
// (The desktop app ships its files with it, so it needs no service worker.)
if (import.meta.env.VITE_PRODLI_API === "same-origin" && import.meta.env.PROD && "serviceWorker" in navigator && !handoff) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
