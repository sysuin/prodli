// Build-time rendering of each page to HTML (scripts/prerender.mjs), so search
// engines, AI crawlers and link previews see the real content of prodli.com.
import { renderToString } from "react-dom/server";
import App from "./App";

export { PAGES, NOT_FOUND } from "./seo";

export function render(path: string): string {
  return renderToString(<App ssrPath={path} />);
}
