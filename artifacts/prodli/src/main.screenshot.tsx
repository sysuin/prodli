// The extension's screenshot window (screenshot.html#<capture id>), opened by
// the background after "Screenshot to ProdLi" (src/lib/screenshotBackground.ts).
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import { createRoot } from "react-dom/client";
import { ScreenshotAnnotator } from "./components/ScreenshotAnnotator";
import "./index.css";

try {
  if (localStorage.getItem("prodli_theme_hint") === "dark") document.documentElement.classList.add("dark");
} catch {
  // ignore
}
createRoot(document.getElementById("root")!).render(<ScreenshotAnnotator shotId={location.hash.slice(1)} />);
