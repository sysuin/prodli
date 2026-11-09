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
import "./index.css";

// index.html#quick-add?title=…&url=… is the Quick add window (Alt+Shift+A).
const quickAdd = location.hash.startsWith("#quick-add");
if (quickAdd) {
  try {
    if (localStorage.getItem("prodli_theme_hint") === "dark") document.documentElement.classList.add("dark");
  } catch {
    // ignore
  }
}
createRoot(document.getElementById("root")!).render(quickAdd ? <QuickAddWindow initial={captureFromUrl(location.hash.slice(location.hash.indexOf("?") + 1)) ?? undefined} /> : <App />);
