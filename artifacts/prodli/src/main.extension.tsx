import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import { QuickAddWindow } from "./components/QuickAdd";
import { captureFromUrl } from "./lib/capture";
import { parsePausePage } from "./lib/focusBlock";
import { PausePage } from "./components/PausePage";
import { lazy, Suspense } from "react";
import { RECORD_HASH } from "./screenrec/open";

const RecorderPage = lazy(() => import("./screenrec/RecorderPage").then((m) => ({ default: m.RecorderPage })));
import "./index.css";

// Voice dictation (Alt+Shift+D) types into ProdLi's own pages too: load its pill here
// (websites get it injected by the background).
void import(/* @vite-ignore */ chrome.runtime.getURL("dictate-pill.js")).catch(() => {});

// index.html#quick-add?title=…&url=… is the Quick add window (Alt+Shift+A).
const quickAdd = location.hash.startsWith("#quick-add");
// index.html#blocked?u=…&r=… is the focus-blocking pause page.
const paused = parsePausePage(location.hash);
// index.html#record is the screen recorder (🎥 Record a video).
const recorder = location.hash === RECORD_HASH;
if (quickAdd || paused || recorder) {
  try {
    if (localStorage.getItem("prodli_theme_hint") === "dark") document.documentElement.classList.add("dark");
  } catch {
    // ignore
  }
}
createRoot(document.getElementById("root")!).render(
  recorder ? (
    <Suspense fallback={null}>
      <RecorderPage />
    </Suspense>
  ) : paused ? <PausePage {...paused} /> : quickAdd ? <QuickAddWindow initial={captureFromUrl(location.hash.slice(location.hash.indexOf("?") + 1)) ?? undefined} /> : <App />,
);
