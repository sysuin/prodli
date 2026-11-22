import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root")!;
// Pages are pre-rendered at build time (scripts/prerender.mjs); take over that
// HTML instead of drawing it again. The dev server serves an empty root.
if (root.hasChildNodes()) hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
