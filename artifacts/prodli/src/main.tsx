import { createRoot } from "react-dom/client";
import App from "./App";
import { QuickAddWindow } from "./components/QuickAdd";
import { DesktopHandoff } from "./components/DesktopHandoff";
import { captureFromUrl } from "./lib/capture";
import { desktop, isDesktop } from "./lib/desktop";
import { parseDesktopHandoff, parseExtensionHandoff } from "./lib/desktopHandoff";
import "./index.css";
import { lazy, Suspense } from "react";
import { RECORD_HASH } from "./screenrec/open";

const DesktopDictationPill = lazy(() => import("./components/DesktopDictationPill").then((m) => ({ default: m.DesktopDictationPill })));
const RecorderPage = lazy(() => import("./screenrec/RecorderPage").then((m) => ({ default: m.RecorderPage })));

// Web app: app.prodli.com/?desktop=signin&… signs in the desktop app, ?extension=signin&… the
// extension in a browser without Chrome's own Google sign-in (lib/desktopHandoff.ts).
const webApp = !isDesktop() && import.meta.env.VITE_PRODLI_API === "same-origin";
const desktopHandoff = webApp ? parseDesktopHandoff(location.search) : null;
const extensionHandoff = webApp && !desktopHandoff ? parseExtensionHandoff(location.search) : null;
const handoff = desktopHandoff ?? extensionHandoff;
// Desktop app: index.html#quick-add is the Quick add window (global shortcut, tray menu).
const quickAdd = isDesktop() && location.hash.startsWith("#quick-add");
// Desktop app: index.html#dictate-pill is the pill for dictation into any app.
const dictatePill = isDesktop() && location.hash === "#dictate-pill";
// #record is the screen recorder (🎥 Record a video).
const recorder = !handoff && location.hash === RECORD_HASH;
// First paint in the right theme (App applies the saved theme again once loaded).
try {
  const saved = isDesktop() ? desktop()!.initialTheme : JSON.parse(localStorage.getItem("prodli_theme") ?? "null");
  if (saved === "dark" || ((handoff || quickAdd) && saved == null && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch {
  // ignore
}

createRoot(document.getElementById("root")!).render(
  dictatePill ? (
    <Suspense fallback={null}>
      <DesktopDictationPill />
    </Suspense>
  ) : recorder ? (
    <Suspense fallback={null}>
      <RecorderPage />
    </Suspense>
  ) : desktopHandoff ? <DesktopHandoff handoff={desktopHandoff} /> : extensionHandoff ? <DesktopHandoff target={{ kind: "extension", handoff: extensionHandoff }} /> : quickAdd ? <QuickAddWindow initial={captureFromUrl(location.hash.slice(location.hash.indexOf("?") + 1)) ?? undefined} /> : <App />,
);

// The web app (app.prodli.com) works offline: scripts/build-app.mjs generates /sw.js.
// (The desktop app ships its files with it, so it needs no service worker.)
if (import.meta.env.VITE_PRODLI_API === "same-origin" && import.meta.env.PROD && "serviceWorker" in navigator && !handoff) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
