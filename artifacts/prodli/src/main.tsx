import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// The web app (app.prodli.com) works offline: scripts/build-app.mjs generates /sw.js.
if (import.meta.env.VITE_PRODLI_API === "same-origin" && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
